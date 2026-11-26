-- The board's Admin page (js/views/admin.js, ported from Facilities
-- 1735000039_admin_page + pb_hooks/admin.pb.js): what only Studio could
-- change before. Admins only - editors and viewers get nothing new.
--
--   * Accounts go through the api Edge Function (/admin/users), which needs
--     the server key to make and change sign-ins. Nothing here for them,
--     except taking a deleted person off the sessions they were on.
--   * sites: admins change a site's details - not its code (public links
--     are built on it), not its Eventbrite settings (site_secrets and the
--     eventbrite_* columns stay Studio only), and not adding or deleting one.
--   * rooms, departments: admins add, rename, reorder and delete, on any
--     site. A rename carries through to the sessions and courses that hold
--     the name as text; one still in use can't be deleted from the board.

-- ---------------------------------------------------------------- sites

grant update (name, full_name, colour, logo, ref_prefix, views, sort) on public.sites to authenticated;
create policy upd on public.sites for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------- rooms, departments

grant insert, update (name, sort), delete on public.rooms, public.departments to authenticated;
create policy ins on public.rooms for insert to authenticated with check (app.is_admin());
create policy upd on public.rooms for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy del on public.rooms for delete to authenticated using (app.is_admin());
create policy ins on public.departments for insert to authenticated with check (app.is_admin());
create policy upd on public.departments for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy del on public.departments for delete to authenticated using (app.is_admin());

-- A rename carries through, whoever makes it (the board or Studio).
-- security definer: the sessions and courses may be in a site the person
-- renaming can't otherwise write to (Studio has no auth.uid()).
create function app.list_item_renamed() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name then
    if tg_table_name = 'rooms' then
      update public.sessions set room = new.name where site = new.site and room = old.name;
    else
      update public.courses set department = new.name where site = new.site and department = old.name;
    end if;
  end if;
  return new;
end $$;
create trigger renamed after update on public.rooms       for each row execute function app.list_item_renamed();
create trigger renamed after update on public.departments for each row execute function app.list_item_renamed();

-- Who's using one: counted as the owner, so nothing can hide a use.
create function app.list_item_uses(tbl text, s text, n text) returns int language sql stable security definer set search_path = '' as $$
  select case when tbl = 'rooms'
    then (select count(*)::int from public.sessions where site = s and room = n)
    else (select count(*)::int from public.courses  where site = s and department = n) end
$$;

-- One in use can't be deleted from the board. Studio can, as ever.
create function app.list_item_deleting() returns trigger language plpgsql set search_path = '' as $$
declare
  n int;
  thing text := case when tg_table_name = 'rooms' then 'session' else 'course' end;
  what text := case when tg_table_name = 'rooms' then 'room' else 'department' end;
begin
  if app.from_board() then
    n := app.list_item_uses(tg_table_name, old.site, old.name);
    if n > 0 then
      raise exception '% still use% this %. Move % to another % first.',
        case when n = 1 then '1 ' || thing else n || ' ' || thing || 's' end,
        case when n = 1 then 's' else '' end, what,
        case when n = 1 then 'it' else 'them' end, what
        using errcode = 'P0001';
    end if;
  end if;
  return old;
end $$;
create trigger in_use before delete on public.rooms       for each row execute function app.list_item_deleting();
create trigger in_use before delete on public.departments for each row execute function app.list_item_deleting();

-- ---------------------------------------------------------------- accounts

-- A deleted account comes off every session it was allocated to (staff is
-- a plain array, so nothing else would). Leave and prefs go by cascade;
-- notes keep their author_name.
create function app.profile_deleted() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.sessions set staff = array_remove(staff, old.id) where old.id = any(staff);
  return old;
end $$;
create trigger profile_deleted before delete on public.profiles for each row execute function app.profile_deleted();

grant execute on all functions in schema app to authenticated, anon, service_role;
