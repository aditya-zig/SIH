-- E05/E06 — WebAR authoring + organization ownership.
-- Do not edit old migrations. No UPDATE/DELETE of existing module_versions rows.
-- Adds nullable organization_id to training_modules for legacy-safe migration;
-- new WebAR modules require it non-null through publish RPC validation.
-- Adds nullable WebAR publication metadata to module_versions.
-- Creates training_drafts with approval invariant fields + deterministic
-- package/scenario projections used by the publish RPC.
-- Replaces module/version read policy with organization scoping.

-- 1. training_modules.organization_id (nullable for legacy rows)
alter table public.training_modules
  add column if not exists organization_id uuid references public.organizations(id);

-- 2. module_versions WebAR publication metadata (all nullable for legacy rows)
alter table public.module_versions
  add column if not exists package_json jsonb,
  add column if not exists approved_by uuid references public.profiles(id),
  add column if not exists approved_at timestamptz,
  add column if not exists source_draft_id uuid,
  add column if not exists source_draft_revision integer check (source_draft_revision is null or source_draft_revision > 0),
  add column if not exists approval_hash text;

-- One immutable published version per exact reviewed draft revision. Legacy rows
-- remain unaffected because their source_draft_id/source_draft_revision are NULL.
create unique index if not exists module_versions_source_draft_revision_unique
  on public.module_versions (source_draft_id, source_draft_revision)
  where source_draft_id is not null and source_draft_revision is not null;

-- 3. training_drafts
create table if not exists public.training_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  trainer_id uuid not null references public.profiles(id),
  template_id text not null,
  template_version integer not null check (template_version > 0),
  revision integer not null default 1 check (revision > 0),
  status text not null check (status in ('AI_DRAFT','REVIEWED')),
  draft_json jsonb not null,
  package_json jsonb,
  scenario_json jsonb,
  content_hash text not null,
  approved_hash text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotent when an earlier development environment already created the table
-- from the first draft of this migration.
alter table public.training_drafts
  add column if not exists package_json jsonb,
  add column if not exists scenario_json jsonb;

alter table public.training_drafts enable row level security;

-- Trainer/admin may SELECT/INSERT/UPDATE only own-org rows. Workers get no draft access.
drop policy if exists "trainers manage own org drafts" on public.training_drafts;
create policy "trainers manage own org drafts"
  on public.training_drafts for select to authenticated using (
    organization_id = public.current_organization_id()
    and public.current_profile_role() in ('trainer','admin')
  );

drop policy if exists "trainers insert own org drafts" on public.training_drafts;
create policy "trainers insert own org drafts"
  on public.training_drafts for insert to authenticated with check (
    organization_id = public.current_organization_id()
    and trainer_id = auth.uid()
    and public.current_profile_role() in ('trainer','admin')
  );

drop policy if exists "trainers update own org drafts" on public.training_drafts;
create policy "trainers update own org drafts"
  on public.training_drafts for update to authenticated using (
    organization_id = public.current_organization_id()
    and public.current_profile_role() in ('trainer','admin')
  ) with check (
    organization_id = public.current_organization_id()
    and trainer_id = auth.uid()
    and public.current_profile_role() in ('trainer','admin')
  );

-- 4. Organization-scoped module/version reads.
-- Legacy rows with NULL organization_id are NOT readable by the new policy;
-- they remain only for explicit admin migration tooling via service_role (bypasses RLS).
drop policy if exists "published modules are readable" on public.training_modules;
create policy "org members read own org modules"
  on public.training_modules for select to authenticated using (
    active
    and organization_id = public.current_organization_id()
  );

drop policy if exists "published module versions are readable" on public.module_versions;
create policy "org members read own org module versions"
  on public.module_versions for select to authenticated using (
    exists (
      select 1 from public.training_modules module
      where module.id = module_id
        and module.active
        and module.organization_id = public.current_organization_id()
    )
  );

-- Approval invariant:
-- content_hash = SHA-256(canonical draft_json).
-- package_json/scenario_json are deterministic projections of that same draft.
-- Approval sets approved_hash = content_hash + approved_by/at + status REVIEWED.
-- Every edit/regeneration increments revision, recomputes content_hash and both
-- projections, clears approved_hash/approved_by/approved_at, and returns status
-- to AI_DRAFT. Publication requires REVIEWED + approved_hash = content_hash.
