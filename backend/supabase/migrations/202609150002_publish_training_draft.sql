-- E06 — publish_training_draft RPC (transactional, immutable versions only).
-- Derives caller from auth.uid(), requires trainer/admin + same org + valid
-- approval hash, creates/gets module lineage, allocates a version under a row
-- lock, and inserts immutable package_json + evaluator scenario_json.
-- Re-publishing the exact same reviewed draft revision is idempotent.
-- Never UPDATEs a published version (immutable trigger still enforced).

create or replace function public.publish_training_draft(p_draft_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_caller_org uuid;
  v_draft public.training_drafts%rowtype;
  v_module_id uuid;
  v_slug text;
  v_next_version integer;
  v_existing_version integer;
  v_existing_hash text;
  v_package jsonb;
  v_scenario jsonb;
  v_content_hash text;
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select role, organization_id into v_role, v_caller_org
  from public.profiles where id = v_caller;

  if v_role not in ('trainer','admin') then
    raise exception 'Trainer role required' using errcode = '42501';
  end if;

  select * into v_draft from public.training_drafts where id = p_draft_id;
  if not found then
    raise exception 'Unknown draft' using errcode = 'P0002';
  end if;

  if v_draft.organization_id <> v_caller_org then
    raise exception 'Cross-organization draft access denied' using errcode = '42501';
  end if;

  if v_draft.status <> 'REVIEWED' or v_draft.approved_hash is null
     or v_draft.approved_hash <> v_draft.content_hash then
    raise exception 'Draft approval is invalid or stale; re-approval required' using errcode = '23514';
  end if;

  -- Projections are stored separately from draft_json so content_hash continues
  -- to pin the exact trainer-reviewed TrainingDraft rather than an envelope.
  v_package := v_draft.package_json;
  v_scenario := v_draft.scenario_json;
  if v_package is null or v_scenario is null then
    raise exception 'Draft is missing package/scenario projection' using errcode = '23514';
  end if;

  -- Lineage: one training_modules row per (org, template). The full org UUID is
  -- embedded in the globally unique slug to avoid cross-org prefix collisions.
  v_slug := 'webar-' || left(v_draft.template_id, 40) || '-' || replace(v_draft.organization_id::text, '-', '');

  insert into public.training_modules (slug, title_key, active, organization_id)
  values (v_slug, v_draft.template_id, true, v_draft.organization_id)
  on conflict (slug) do nothing;

  -- Serialize every publication for this lineage. A second request for the same
  -- draft revision waits here, then observes and returns the version inserted by
  -- the first request instead of creating an identical duplicate version.
  select id into v_module_id from public.training_modules
  where slug = v_slug and organization_id = v_draft.organization_id
  for update;

  if not found then
    raise exception 'Module lineage could not be established' using errcode = 'P0002';
  end if;

  select version, content_hash
  into v_existing_version, v_existing_hash
  from public.module_versions
  where source_draft_id = v_draft.id
    and source_draft_revision = v_draft.revision;

  if found then
    return jsonb_build_object(
      'moduleId', v_module_id,
      'slug', v_slug,
      'version', v_existing_version,
      'contentHash', v_existing_hash,
      'idempotent', true
    );
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.module_versions where module_id = v_module_id;

  -- The stored package must identify the immutable version actually allocated by
  -- the database, not the preview placeholder version from the draft projection.
  v_package := jsonb_set(v_package, '{version}', to_jsonb(v_next_version), true);
  v_content_hash := encode(digest(v_package::text, 'sha256'), 'hex');

  insert into public.module_versions (
    module_id, version, scenario_json, content_hash,
    package_json, approved_by, approved_at,
    source_draft_id, source_draft_revision, approval_hash
  ) values (
    v_module_id, v_next_version, v_scenario, v_content_hash,
    v_package, v_draft.approved_by, v_draft.approved_at,
    v_draft.id, v_draft.revision, v_draft.approved_hash
  );

  return jsonb_build_object(
    'moduleId', v_module_id,
    'slug', v_slug,
    'version', v_next_version,
    'contentHash', v_content_hash,
    'idempotent', false
  );
end;
$$;

revoke all on function public.publish_training_draft(uuid) from public, anon;
grant execute on function public.publish_training_draft(uuid) to authenticated;
