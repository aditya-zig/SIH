-- Live compatibility follow-up for the WebAR ownership migration.
-- Pre-WebAR training_modules are shared demo/training content used across
-- organizations and have organization_id = NULL. Keep that historical read
-- contract while tenant-scoping every new WebAR module with a non-NULL org.

alter table public.training_modules enable row level security;
alter table public.module_versions enable row level security;

drop policy if exists "org members read own org modules" on public.training_modules;
create policy "org members read own org modules"
  on public.training_modules for select to authenticated using (
    active
    and (
      organization_id is null
      or organization_id = public.current_organization_id()
    )
  );

drop policy if exists "org members read own org module versions" on public.module_versions;
create policy "org members read own org module versions"
  on public.module_versions for select to authenticated using (
    exists (
      select 1
      from public.training_modules module
      where module.id = module_id
        and module.active
        and (
          module.organization_id is null
          or module.organization_id = public.current_organization_id()
        )
    )
  );
