-- Apps edited on the board (js/views/apps.js, Edit mode): admins and
-- editors add, change and delete app cards, and upload their pictures.
--
--   * An app can be on several sites. Changing or deleting one needs write
--     access to every site it's on - admins anywhere, editors only when all
--     its sites are theirs - so an editor of one site can't change what
--     another site sees. A shared app is still shown to them, read-only.
--   * Whoever may change an app also sees it, even when its "who sees it"
--     leaves their role out, so it can't vanish from under them.
--   * Pictures go in the private "SaIL-Away" bucket under apps/, uploaded by
--     admins and editors. Nobody deletes them from the board; replaced ones
--     stay in the bucket (Studio can tidy up).

-- Admin, or an editor holding every one of these sites (and at least one).
create function app.can_write_all(s text[]) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'admin'
                       or (p.role = 'editor' and cardinality(s) > 0 and s <@ p.sites)
                   from public.profiles p where p.id = auth.uid()), false)
$$;
grant execute on function app.can_write_all(text[]) to authenticated, anon, service_role;

-- A picture is a plain file name inside apps/ - no folders, no tricks.
alter table public.apps add constraint apps_image_name
  check (image = '' or image ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$');

drop policy read on public.apps;
create policy read on public.apps for select to authenticated
  using ((app.my_role() = any(roles) and (app.is_admin() or sites && app.my_sites()))
         or app.can_write_all(sites));

grant insert, update, delete on public.apps to authenticated;
create policy ins on public.apps for insert to authenticated with check (app.can_write_all(sites));
create policy upd on public.apps for update to authenticated using (app.can_write_all(sites)) with check (app.can_write_all(sites));
create policy del on public.apps for delete to authenticated using (app.can_write_all(sites));

-- Uploading pictures: admins and editors, into apps/ only.
create policy "admins and editors upload app images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'SaIL-Away' and (storage.foldername(name))[1] = 'apps'
              and app.my_role() in ('admin', 'editor'));

-- Pictures only, and not huge (the board also checks before uploading).
update storage.buckets set file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
  where id = 'SaIL-Away';
