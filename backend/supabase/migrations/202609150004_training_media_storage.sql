-- E05 — private trainer media bucket for WebAR authoring.
-- Browser uploads use authenticated RLS; the draft-generation Edge Function
-- downloads authorized bytes with service_role. No media is public.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'training-media',
  'training-media',
  false,
  52428800,
  array['image/jpeg','image/png','image/webp','video/mp4']::text[]
)
on conflict (id) do nothing;

-- Paths are always <organization_uuid>/<draft_uuid>/<file>.
-- Trainers/admins can stage and inspect only their own organization's media.
drop policy if exists "trainers upload own org training media" on storage.objects;
create policy "trainers upload own org training media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'training-media'
    and public.current_profile_role() in ('trainer','admin')
    and split_part(name, '/', 1) = public.current_organization_id()::text
  );

drop policy if exists "trainers read own org training media" on storage.objects;
create policy "trainers read own org training media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'training-media'
    and public.current_profile_role() in ('trainer','admin')
    and split_part(name, '/', 1) = public.current_organization_id()::text
  );

-- No UPDATE policy: staged uploads are immutable (upsert=false). A new upload
-- gets a new object path instead of silently replacing evidence used by a draft.
