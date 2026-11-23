-- SaIL-Away: the whole schema, ported from the Facilities PocketBase app
-- (its 38 migrations, as they ended up) in one baseline.
--
-- How access works:
--   * Every table has row-level security. The browser talks to it with the
--     publishable key plus the signed-in person's token, so these policies
--     are the only thing standing between the internet and the data.
--   * People are auth.users + public.profiles (role, sites, home site, name).
--     Roles: admin (every site, can change anything), editor (their sites),
--     viewer (their sites, read-only). Profiles are edited in Supabase Studio.
--   * Helper and trigger functions live in schema "app", which the API does
--     not expose, so none of them can be called from outside.
--   * Column names match the old app ("group", "end", "from", ...) so the
--     front end didn't have to change; they're quoted where SQL needs it.
--   * Empty text is '' and numbers 0, never null, like PocketBase - the
--     front end relies on it. Single relations are null when empty.

create schema if not exists app;
grant usage on schema app to authenticated, anon;

-- ---------------------------------------------------------------- helpers

-- Record ids like PocketBase's: 15 characters, a-z0-9.
create function app.new_id() returns text language sql volatile as $$
  select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789', 1 + (get_byte(b, i) % 36), 1), '')
  from (select extensions.gen_random_bytes(15) b) r, generate_series(0, 14) i
$$;

-- A random string from an alphabet (form codes, staff codes, link tokens).
create function app.random_string(n int, alphabet text) returns text language sql volatile as $$
  select string_agg(substr(alphabet, 1 + (get_byte(b, i) % length(alphabet)), 1), '')
  from (select extensions.gen_random_bytes(n) b) r, generate_series(0, n - 1) i
$$;

create function app.touch_updated() returns trigger language plpgsql as $$
begin new.updated := now(); return new; end $$;

-- ---------------------------------------------------------------- sites

create table public.sites (
  id text primary key default app.new_id(),
  name text not null check (length(name) between 1 and 100),
  code text not null unique check (code ~ '^[a-z0-9-]+$' and length(code) <= 20),
  ref_prefix text not null default '' check (length(ref_prefix) <= 20),
  views text[] not null default '{}',
  logo boolean not null default false,
  colour text not null default '' check (colour ~ '^(#[0-9a-fA-F]{6})?$'),
  full_name text not null default '' check (length(full_name) <= 100),
  eventbrite_venues jsonb,
  eventbrite_organizer text not null default '' check (length(eventbrite_organizer) <= 40),
  sort double precision not null default 0
);

-- What PocketBase kept as hidden fields on sites. No policies at all: only
-- the Edge Functions (service role) and Studio can read it.
create table public.site_secrets (
  site text primary key references public.sites(id) on delete cascade,
  eventbrite_token text not null default '',
  eventbrite_org text not null default '',
  eventbrite_staff_code text not null default ''
);

-- ---------------------------------------------------------------- people

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  name text not null check (length(name) between 1 and 100),
  role text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  sites text[] not null default '{}',
  home_site text references public.sites(id) on delete set null,
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles for each row execute function app.touch_updated();

-- A new account (Studio -> Authentication -> Add user) gets a viewer
-- profile with no sites; name from the user metadata, else the email.
create function app.new_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, name, role)
  values (new.id, coalesce(new.email, ''),
          coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(coalesce(new.email, 'Someone'), '@', 1)),
          'viewer')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function app.new_profile();

-- Who is asking. security definer so they can read profiles past its RLS.
create function app.my_role() returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;
create function app.my_sites() returns text[] language sql stable security definer set search_path = '' as $$
  select sites from public.profiles where id = auth.uid()
$$;
create function app.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;
-- Read: signed in, and the record's site is one of yours (admins: any).
create function app.can_read(s text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'admin' or s = any(p.sites) from public.profiles p where p.id = auth.uid()), false)
$$;
-- Write: admins anywhere; editors in their own sites.
create function app.can_write(s text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'admin' or (p.role = 'editor' and s = any(p.sites))
                   from public.profiles p where p.id = auth.uid()), false)
$$;
grant execute on all functions in schema app to authenticated, anon;

-- ---------------------------------------------------------------- board

create table public.groups (
  id text primary key default app.new_id(),
  site text not null references public.sites(id),
  name text not null check (length(name) between 1 and 100),
  ink text not null check (length(ink) <= 20),
  tint text not null check (length(tint) <= 20),
  sort double precision not null default 0
);

create table public.courses (
  id text primary key default app.new_id(),
  site text not null references public.sites(id),
  "group" text not null references public.groups(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  lead text not null default '' check (length(lead) <= 200),
  email text not null default '' check (email = '' or email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  department text not null default '' check (length(department) <= 100),
  sort double precision not null default 0
);

create table public.sessions (
  id text primary key default app.new_id(),
  site text not null references public.sites(id),
  course text not null references public.courses(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  room text not null check (length(room) between 1 and 100),
  date text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  start text not null check (start ~ '^\d{2}:\d{2}$'),
  "end" text not null check ("end" ~ '^\d{2}:\d{2}$'),
  staff uuid[] not null default '{}',
  sort double precision not null default 0
);
create index sessions_site_date on public.sessions (site, date);
create index sessions_course on public.sessions (course);

create table public.session_notes (
  id text primary key default app.new_id(),
  site text not null references public.sites(id),
  session text not null references public.sessions(id) on delete cascade,
  title text not null default '' check (length(title) <= 200),
  body text not null default '' check (length(body) <= 50000),
  author uuid references public.profiles(id) on delete set null,
  author_name text not null default '' check (length(author_name) <= 200),
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create index session_notes_session on public.session_notes (session);

create table public.course_notes (
  id text primary key default app.new_id(),
  site text not null references public.sites(id),
  course text not null references public.courses(id) on delete cascade,
  title text not null default '' check (length(title) <= 200),
  body text not null default '' check (length(body) <= 50000),
  author uuid references public.profiles(id) on delete set null,
  author_name text not null default '' check (length(author_name) <= 200),
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create index course_notes_course on public.course_notes (course);

create table public.rooms (
  id text primary key default app.new_id(),
  site text not null references public.sites(id),
  name text not null check (length(name) between 1 and 100),
  sort double precision not null default 0,
  unique (site, name)
);

create table public.departments (
  id text primary key default app.new_id(),
  site text not null references public.sites(id),
  name text not null check (length(name) between 1 and 100),
  sort double precision not null default 0,
  unique (site, name)
);

-- ---------------------------------------------------------------- invoices

create table public.invoice_types (
  id text primary key default app.new_id(),
  site text not null references public.sites(id),
  name text not null check (length(name) between 1 and 100),
  ink text not null check (length(ink) <= 20),
  tint text not null check (length(tint) <= 20),
  sort double precision not null default 0
);

create table public.invoices (
  id text primary key default app.new_id(),
  site text not null references public.sites(id),
  type text not null references public.invoice_types(id),   -- no cascade: a type in use can't be deleted
  quote_ref text not null default '' check (length(quote_ref) <= 40),
  invoice_ref text not null default '' check (length(invoice_ref) <= 40),
  status text not null check (status in ('quoted', 'invoiced', 'paid')),
  title text not null default '' check (length(title) <= 200),
  client text not null default '' check (length(client) <= 200),
  date text not null default '' check (length(date) <= 10),
  details jsonb,
  rates jsonb,
  quote_amount double precision not null default 0,
  quote_label text not null default '' check (length(quote_label) <= 40),
  invoice_total double precision not null default 0,
  quoted_at text not null default '' check (length(quoted_at) <= 30),
  invoiced_at text not null default '' check (length(invoiced_at) <= 30),
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create unique index invoices_quote_ref on public.invoices (quote_ref) where quote_ref <> '';
create unique index invoices_invoice_ref on public.invoices (invoice_ref) where invoice_ref <> '';
create index invoices_site_date on public.invoices (site, date);
create trigger invoices_touch before update on public.invoices for each row execute function app.touch_updated();

create table public.price_list (
  id text primary key default app.new_id(),
  site text not null unique references public.sites(id),
  attendee jsonb,
  items jsonb,
  vat double precision not null default 20 check (vat between 0 and 100),
  valid_days integer not null default 30 check (valid_days between 0 and 3650)
);

-- Quote/invoice number counters: one row per prefix ("Q-2627-"), never
-- reused. Server only.
create table public.ref_counters (
  key text primary key,
  n integer not null default 0
);

-- ---------------------------------------------------------------- forms

create table public.form_groups (
  id text primary key default app.new_id(),
  site text not null references public.sites(id),
  name text not null check (length(name) between 1 and 100),
  ink text not null check (length(ink) <= 20),
  tint text not null check (length(tint) <= 20),
  sort double precision not null default 0
);

create table public.form_sets (
  id text primary key default app.new_id(),
  site text not null references public.sites(id),
  "group" text not null references public.form_groups(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  sort double precision not null default 0
);

create table public.forms (
  id text primary key default app.new_id(),
  site text not null references public.sites(id),
  "set" text not null references public.form_sets(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  sort double precision not null default 0,
  code text not null default '',                     -- set by the server only
  open boolean not null default false,
  closes text not null default '' check (closes = '' or closes ~ '^\d{4}-\d{2}-\d{2}$'),
  settings jsonb,
  questions jsonb,
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create unique index forms_code on public.forms (code) where code <> '';
create trigger forms_touch before update on public.forms for each row execute function app.touch_updated();

create table public.form_responses (
  id text primary key default app.new_id(),
  site text not null references public.sites(id),
  form text not null references public.forms(id) on delete cascade,
  answers jsonb,
  labels jsonb,
  created timestamptz not null default now()
);
create index form_responses_form on public.form_responses (form);

-- The public form route's rate limit (5 a minute per address). Server only.
create table public.form_rate (
  ip text not null,
  at timestamptz not null default now()
);
create index form_rate_ip_at on public.form_rate (ip, at);

-- ---------------------------------------------------------------- staff, leave, prefs

create table public.leave (
  id text primary key default app.new_id(),
  site text not null references public.sites(id),
  person uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('wfh', 'annual', 'sick')),
  start text not null check (start ~ '^\d{4}-\d{2}-\d{2}$'),
  "end" text not null check ("end" ~ '^\d{4}-\d{2}-\d{2}$'),
  "from" text not null default '' check ("from" ~ '^(([01]\d|2[0-3]):[0-5]\d)?$'),
  "to" text not null default '' check ("to" ~ '^(([01]\d|2[0-3]):[0-5]\d)?$'),
  note text not null default '' check (length(note) <= 500),
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create index leave_site_start on public.leave (site, start);
create trigger leave_touch before update on public.leave for each row execute function app.touch_updated();

create table public.user_prefs (
  id text primary key default app.new_id(),
  "user" uuid not null unique references public.profiles(id) on delete cascade,
  data jsonb
);

-- People as the board sees them: name and home site, never email.
-- Filters itself (a view skips the profiles table's RLS).
create view public.staff with (security_barrier) as
  select p.id, p.name, p.home_site as site
  from public.profiles p
  where p.home_site is not null and app.can_read(p.home_site);

-- ---------------------------------------------------------------- apps

create table public.apps (
  id text primary key default app.new_id(),
  title text not null check (length(title) between 1 and 80),
  description text not null default '' check (length(description) <= 300),
  url text not null check (url ~* '^https?://'),
  image text not null default '',                  -- a path in the "apps" storage bucket
  sites text[] not null default '{}',
  roles text[] not null default '{}' check (roles <@ array['admin', 'editor', 'viewer']),
  sort double precision not null default 0
);

-- ---------------------------------------------------------------- Eventbrite, public tools

create table public.eb_images (
  id text primary key default app.new_id(),
  site text not null references public.sites(id) on delete cascade,
  key text not null check (length(key) <= 80),
  media_id text not null check (length(media_id) <= 40),
  unique (site, key)
);

create table public.eb_created (
  id text primary key default app.new_id(),
  site text not null references public.sites(id) on delete cascade,
  event_id text not null unique,
  title text not null default '',
  start text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created timestamptz not null default now()
);

create table public.pub_courses_links (
  id text primary key default app.new_id(),
  label text not null default '' check (length(label) <= 120),
  token text not null unique default app.random_string(40, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')
    check (token ~ '^[A-Za-z0-9]{32,64}$'),
  active boolean not null default true,
  expires timestamptz,
  created timestamptz not null default now()
);

-- Short-lived server cache (the public course list). Server only.
create table public.cache (
  key text primary key,
  value jsonb,
  expires timestamptz not null
);

-- ================================================================ triggers

-- Keeping sites apart (was pb_hooks/sites.pb.js). A record inside another
-- always takes its parent's site, whatever was sent; a site never changes;
-- a child can't move under a parent in another site. Reads the parent as
-- the owner, so RLS can't hide a parent in someone else's site and let a
-- record be filed under the wrong one.
create function app.site_from_parent() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  parent_col text := tg_argv[0];
  parent_tbl text := tg_argv[1];
  pid text;
  ps text;
begin
  if parent_col is not null then
    pid := to_jsonb(new) ->> parent_col;
    if tg_op = 'INSERT' or pid is distinct from (to_jsonb(old) ->> parent_col) then
      execute format('select site from public.%I where id = $1', parent_tbl) into ps using pid;
      if ps is not null then
        if tg_op = 'INSERT' then new.site := ps;
        elsif ps <> new.site then raise exception 'That belongs to a different site.' using errcode = 'P0001';
        end if;
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.site is distinct from old.site then
    raise exception 'A record can''t be moved to another site.' using errcode = 'P0001';
  end if;
  if new.site is null then
    raise exception 'Every record needs a site.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger site_check before insert or update on public.groups        for each row execute function app.site_from_parent();
create trigger site_check before insert or update on public.rooms         for each row execute function app.site_from_parent();
create trigger site_check before insert or update on public.departments   for each row execute function app.site_from_parent();
create trigger site_check before insert or update on public.invoice_types for each row execute function app.site_from_parent();
create trigger site_check before insert or update on public.price_list    for each row execute function app.site_from_parent();
create trigger site_check before insert or update on public.form_groups   for each row execute function app.site_from_parent();
create trigger site_check before insert or update on public.courses        for each row execute function app.site_from_parent('group', 'groups');
create trigger site_check before insert or update on public.sessions       for each row execute function app.site_from_parent('course', 'courses');
create trigger site_check before insert or update on public.session_notes  for each row execute function app.site_from_parent('session', 'sessions');
create trigger site_check before insert or update on public.course_notes   for each row execute function app.site_from_parent('course', 'courses');
create trigger site_check before insert or update on public.invoices       for each row execute function app.site_from_parent('type', 'invoice_types');
create trigger site_check before insert or update on public.form_sets      for each row execute function app.site_from_parent('group', 'form_groups');
create trigger site_check before insert or update on public.forms          for each row execute function app.site_from_parent('set', 'form_sets');
create trigger site_check before insert or update on public.form_responses for each row execute function app.site_from_parent('form', 'forms');

-- A new site gets its price list and its secrets row (with a staff access
-- code nobody could guess: 12 characters, no look-alikes).
create function app.site_created() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.price_list (site, attendee, items) values (new.id, '[]', '[]') on conflict (site) do nothing;
  insert into public.site_secrets (site, eventbrite_staff_code)
  values (new.id, app.random_string(12, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789')) on conflict (site) do nothing;
  return new;
end $$;
create trigger site_created after insert on public.sites for each row execute function app.site_created();

-- Notes (was *_notes.pb.js): the body is sanitised on every save, because
-- it's shown as HTML to everyone; the author is whoever is signed in, and
-- stays the same on edits. Same allow-list as the old regexes: a few
-- formatting tags, no attributes, links only to http(s)/mailto.
create function app.sanitize_note_html(html text) returns text language plpgsql immutable set search_path = '' as $$
declare
  out text := '';
  pos int;
  s int;
  e int;
  tag text;
  m text;
  name text;
  attrs text;
  href text[];
  link text;
  allowed text[] := array['b','strong','i','em','u','ul','ol','li','br','p','a','span','div'];
begin
  if html is null then return ''; end if;
  -- 1. Drop dangerous elements, contents and all.
  loop
    s := regexp_instr(html, '<(script|style|iframe|object|embed)[^>]*>', 1, 1, 0, 'i');
    exit when s = 0;
    tag := lower(substring(html from s + 1 for regexp_instr(html, '[^a-zA-Z]', s + 1) - s - 1));
    e := regexp_instr(html, '</' || tag || '>', s, 1, 1, 'i');
    exit when e = 0;   -- unclosed: step 3 still strips the tag itself
    html := substring(html from 1 for s - 1) || substring(html from e);
  end loop;
  -- 2. Drop comments.
  loop
    s := strpos(html, '<!--');
    exit when s = 0;
    e := strpos(substring(html from s + 4), '-->');
    exit when e = 0;
    html := substring(html from 1 for s - 1) || substring(html from s + 4 + e + 2);
  end loop;
  -- 3. Rebuild every tag: allowed ones bare, links with a safe href, the rest gone.
  pos := 1;
  loop
    s := regexp_instr(html, '</?[a-zA-Z0-9]+[^>]*>', pos);
    if s = 0 then out := out || substring(html from pos); exit; end if;
    e := regexp_instr(html, '</?[a-zA-Z0-9]+[^>]*>', pos, 1, 1);
    m := substring(html from s for e - s);
    out := out || substring(html from pos for s - pos);
    name := lower(substring(m from '^</?([a-zA-Z0-9]+)'));
    attrs := substring(m from '^</?[a-zA-Z0-9]+([^>]*)>$');
    if name = any(allowed) then
      if left(m, 2) = '</' then
        out := out || '</' || name || '>';
      elsif name = 'a' then
        href := regexp_match(coalesce(attrs, ''), 'href\s*=\s*("([^"]*)"|''([^'']*)''|(\S+))', 'i');
        link := coalesce(href[2], href[3], href[4], '');
        if link !~* '^(https?:|mailto:)' then link := ''; end if;
        out := out || case when link <> ''
          then '<a href="' || replace(link, '"', '&quot;') || '" target="_blank" rel="noopener noreferrer">'
          else '<a>' end;
      else
        out := out || '<' || name || '>';
      end if;
    end if;
    pos := e;
  end loop;
  return out;
end $$;

create function app.note_saved() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.body := app.sanitize_note_html(new.body);
  if tg_op = 'INSERT' then
    new.author := auth.uid();
    new.author_name := coalesce((select coalesce(nullif(name, ''), email) from public.profiles where id = auth.uid()), '');
    new.created := now();
  else
    new.author := old.author;
    new.author_name := old.author_name;
    new.created := old.created;
  end if;
  new.updated := now();
  return new;
end $$;
create trigger note_saved before insert or update on public.session_notes for each row execute function app.note_saved();
create trigger note_saved before insert or update on public.course_notes  for each row execute function app.note_saved();

-- Renaming someone rewrites the copies of their name (was users.pb.js).
create function app.profile_renamed() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name then
    update public.session_notes set author_name = new.name where author = new.id;
    update public.course_notes  set author_name = new.name where author = new.id;
  end if;
  return new;
end $$;
create trigger profile_renamed after update on public.profiles for each row execute function app.profile_renamed();

-- Quote and invoice numbers (was invoices.pb.js): the site's prefix, Q or
-- INV, the financial year the number is issued in (1 April, UK time), and
-- a counter that never hands out the same number twice.
create function app.next_ref(kind text, site_id text) returns text language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Europe/London')::date;
  y int := extract(year from today)::int - case when extract(month from today) < 4 then 1 else 0 end;
  prefix text;
  v_n int;
begin
  prefix := coalesce((select ref_prefix from public.sites where id = site_id), '') || kind || '-'
            || lpad((y % 100)::text, 2, '0') || lpad(((y + 1) % 100)::text, 2, '0') || '-';
  insert into public.ref_counters (key, n) values (prefix, 0) on conflict (key) do nothing;
  update public.ref_counters c set n = c.n + 1 where c.key = prefix returning c.n into v_n;
  return prefix || lpad(v_n::text, 4, '0');
end $$;

-- Who counts as a person using the board (not Studio or the server).
create function app.from_board() returns boolean language sql stable as $$
  select current_user in ('authenticated', 'anon')
$$;

create function app.invoice_saved() returns trigger language plpgsql set search_path = '' as $$
declare
  reopening boolean;
begin
  if tg_op = 'INSERT' then
    if app.from_board() and (new.quote_ref <> '' or new.invoice_ref <> '') then
      raise exception 'Quote and invoice numbers are set by the server.' using errcode = 'P0001';
    end if;
    if new.quote_ref = '' then new.quote_ref := app.next_ref('Q', new.site); end if;
    if new.quoted_at = '' then new.quoted_at := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); end if;
    if new.status in ('invoiced', 'paid') and new.invoice_ref = '' then new.invoice_ref := app.next_ref('INV', new.site); end if;
    new.created := now();
    return new;
  end if;

  if app.from_board() then
    if new.quote_ref is distinct from old.quote_ref or new.invoice_ref is distinct from old.invoice_ref then
      raise exception 'Quote and invoice numbers are set by the server.' using errcode = 'P0001';
    end if;
    -- Once invoiced, the figures are fixed: it can be paid, or taken back
    -- to "quoted" (keeping its number) to be edited.
    if old.status in ('invoiced', 'paid') then
      reopening := old.status = 'invoiced' and new.status = 'quoted';
      if new.type is distinct from old.type or new.title is distinct from old.title
         or new.client is distinct from old.client or new.date is distinct from old.date
         or new.details is distinct from old.details or new.rates is distinct from old.rates
         or new.quote_amount is distinct from old.quote_amount or new.quote_label is distinct from old.quote_label
         or new.invoice_total is distinct from old.invoice_total or new.quoted_at is distinct from old.quoted_at
         or (not reopening and new.invoiced_at is distinct from old.invoiced_at) then
        raise exception 'This invoice has been issued, so its details can''t be changed. Go back and edit the invoice first.' using errcode = 'P0001';
      end if;
      if not ((old.status = 'invoiced' and new.status in ('invoiced', 'paid', 'quoted'))
              or (old.status = 'paid' and new.status in ('paid', 'invoiced'))) then
        raise exception 'An invoice that is % can''t be changed to %.', old.status, new.status using errcode = 'P0001';
      end if;
    end if;
  end if;
  if new.status in ('invoiced', 'paid') and new.invoice_ref = '' then
    new.invoice_ref := app.next_ref('INV', new.site);
  end if;
  new.created := old.created;
  return new;
end $$;
-- Named so it runs after site_check (triggers fire in name order).
create trigger zz_invoice_saved before insert or update on public.invoices for each row execute function app.invoice_saved();

-- Form links (was forms.pb.js): 20 random characters set here, never changed.
create function app.form_saved() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.code := app.random_string(20, 'abcdefghijkmnpqrstuvwxyz23456789');
    new.created := now();
  elsif new.code is distinct from old.code then
    raise exception 'A form''s link can''t be changed.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger form_saved before insert or update on public.forms for each row execute function app.form_saved();

-- Leave (was leave.pb.js): goes on the person's home site; whole days, or
-- hours on a single day.
create function app.leave_saved() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  home text;
begin
  if tg_op = 'INSERT' then
    select home_site into home from public.profiles where id = new.person;
    if home is null then raise exception 'That person has no home site, so can''t have leave.' using errcode = 'P0001'; end if;
    new.site := home;
  else
    if new.person is distinct from old.person then raise exception 'Leave can''t be moved to another person.' using errcode = 'P0001'; end if;
    if new.site is distinct from old.site then raise exception 'A record can''t be moved to another site.' using errcode = 'P0001'; end if;
  end if;
  if new."end" < new.start then raise exception 'The leave ends before it starts.' using errcode = 'P0001'; end if;
  if (new."from" = '') <> (new."to" = '') then raise exception 'Give both hours, or neither for whole days.' using errcode = 'P0001'; end if;
  if new."from" <> '' and new."to" <= new."from" then raise exception 'The hours end before they start.' using errcode = 'P0001'; end if;
  if new."from" <> '' and new."end" <> new.start then raise exception 'Hours can only be set on a single day.' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger leave_saved before insert or update on public.leave for each row execute function app.leave_saved();

-- Allocating staff to a session (was session_staff.pb.js): only people
-- whose home site is the session's course's site; only newly added people
-- are checked.
create function app.session_staff_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  csite text;
  added uuid[];
begin
  added := array(select unnest(new.staff) except select unnest(case when tg_op = 'UPDATE' then old.staff else '{}'::uuid[] end));
  if cardinality(added) = 0 then return new; end if;
  select site into csite from public.courses where id = new.course;
  if csite is null or exists (
    select 1 from unnest(added) a(id)
    left join public.profiles p on p.id = a.id
    where p.home_site is distinct from csite
  ) then
    raise exception 'Only staff from the session''s own site can be allocated.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger zz_session_staff before insert or update on public.sessions for each row execute function app.session_staff_check();

-- Your own prefs row only, and it can't be handed to someone else.
create function app.prefs_saved() returns trigger language plpgsql set search_path = '' as $$
begin
  if app.from_board() then
    if tg_op = 'INSERT' then new."user" := auth.uid();
    elsif new."user" is distinct from old."user" then raise exception 'Prefs belong to one person.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger prefs_saved before insert or update on public.user_prefs for each row execute function app.prefs_saved();

-- ================================================================ access (RLS)

alter table public.sites enable row level security;
alter table public.site_secrets enable row level security;
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.courses enable row level security;
alter table public.sessions enable row level security;
alter table public.session_notes enable row level security;
alter table public.course_notes enable row level security;
alter table public.rooms enable row level security;
alter table public.departments enable row level security;
alter table public.invoice_types enable row level security;
alter table public.invoices enable row level security;
alter table public.price_list enable row level security;
alter table public.ref_counters enable row level security;
alter table public.form_groups enable row level security;
alter table public.form_sets enable row level security;
alter table public.forms enable row level security;
alter table public.form_responses enable row level security;
alter table public.form_rate enable row level security;
alter table public.leave enable row level security;
alter table public.user_prefs enable row level security;
alter table public.apps enable row level security;
alter table public.eb_images enable row level security;
alter table public.eb_created enable row level security;
alter table public.pub_courses_links enable row level security;
alter table public.cache enable row level security;

-- Nothing is open to signed-out visitors; the public pages go through Edge
-- Functions. Signed-in people get only what the policies below allow.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

-- Sites: yours (admins: all). Changed in Studio only.
grant select on public.sites to authenticated;
create policy read on public.sites for select to authenticated
  using (app.is_admin() or id = any(app.my_sites()));

-- Your own profile (role, sites) - the board needs it after sign-in.
grant select on public.profiles to authenticated;
create policy own on public.profiles for select to authenticated using (id = auth.uid());

grant select on public.staff to authenticated;

-- Per-site board data: read your sites; admins and the site's editors write.
do $$
declare t text;
begin
  foreach t in array array['groups', 'courses', 'sessions', 'session_notes', 'course_notes',
                           'invoice_types', 'invoices', 'form_groups', 'form_sets', 'forms'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy read on public.%I for select to authenticated using (app.can_read(site))', t);
    execute format('create policy ins on public.%I for insert to authenticated with check (app.can_write(site))', t);
    execute format('create policy upd on public.%I for update to authenticated using (app.can_write(site)) with check (app.can_write(site))', t);
    execute format('create policy del on public.%I for delete to authenticated using (app.can_write(site))', t);
  end loop;
end $$;

-- Reference lists: read only (Studio edits them).
grant select on public.rooms, public.departments to authenticated;
create policy read on public.rooms for select to authenticated using (app.can_read(site));
create policy read on public.departments for select to authenticated using (app.can_read(site));

-- One price list per site, made by the server; edited, never created or deleted.
grant select, update on public.price_list to authenticated;
create policy read on public.price_list for select to authenticated using (app.can_read(site));
create policy upd on public.price_list for update to authenticated using (app.can_write(site)) with check (app.can_write(site));

-- Responses: read and delete; created only by the public form function.
grant select, delete on public.form_responses to authenticated;
create policy read on public.form_responses for select to authenticated using (app.can_read(site));
create policy del on public.form_responses for delete to authenticated using (app.can_write(site));

-- Leave: everyone on the site reads it; admins only write (not editors).
grant select, insert, update, delete on public.leave to authenticated;
create policy read on public.leave for select to authenticated using (app.can_read(site));
create policy ins on public.leave for insert to authenticated with check (app.is_admin());
create policy upd on public.leave for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy del on public.leave for delete to authenticated using (app.is_admin());

-- Your own view settings - the one thing viewers can write.
grant select, insert, update on public.user_prefs to authenticated;
create policy own_read on public.user_prefs for select to authenticated using ("user" = auth.uid());
create policy own_ins on public.user_prefs for insert to authenticated with check ("user" = auth.uid());
create policy own_upd on public.user_prefs for update to authenticated using ("user" = auth.uid()) with check ("user" = auth.uid());

-- Apps: shown to the roles it lists, on the sites it lists (admins: any site).
grant select on public.apps to authenticated;
create policy read on public.apps for select to authenticated
  using (app.my_role() = any(roles) and (app.is_admin() or sites && app.my_sites()));

-- site_secrets, ref_counters, form_rate, eb_images, eb_created,
-- pub_courses_links, cache: no grants, no policies - server and Studio only.
