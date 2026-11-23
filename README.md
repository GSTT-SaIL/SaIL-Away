# SaIL-Away

The SaIL Centre's facilities board - courses, timetable, rota, staff leave,
quotes and invoices, forms, Eventbrite listings - as a static site on
**GitHub Pages** with **Supabase** behind it. No server of our own, no Docker.

**Status: a test site.** Everything in it is sample data; nothing here is live.

```
index.html, availability.html, form.html, styleguide.html, 404.html   the pages
css/, js/, assets/, public/     what the pages use (js/config.js says where Supabase is)
supabase/migrations/            the database: tables, row-level security, triggers
supabase/functions/api/         the server routes (Eventbrite, public pages) - one Edge Function
tools/seed.mjs                  sample data + test accounts for an empty database
tools/run.sh                    runs tools with the secrets they need
tests/                          end-to-end tests (Playwright)
.github/workflows/pages.yml     publishes the site on every push to main
docs/DESIGN.md                  how it looks, and every design decision
```

## How it fits together

- **The pages** are plain HTML/CSS/JS modules - no build step. They talk to
  Supabase with the project's *publishable* key, which is public by design.
- **Row-level security is the boundary.** Every table has policies; signed
  out, the API returns nothing. Roles: **admin** (every site, changes
  anything), **editor** (changes things on their sites), **viewer** (reads
  their sites). See the top of `supabase/migrations/20261123000000_schema.sql`.
- **Triggers do what the server used to:** keep sites apart, number quotes
  and invoices, clean notes HTML, check leave and staff allocations.
- **The `api` Edge Function** holds anything that needs a secret or must be
  public: Eventbrite (tokens stay server-side), the public availability page,
  public forms, and the staff course list.

## Accounts and settings

Made in **Supabase Studio**, not in the board:

- **People:** Authentication -> Add user (with a `name` in user metadata if
  you like). They get a viewer profile with no sites; set `role`, `sites`
  and `home_site` in the `profiles` table.
- **Sites, rooms, departments, apps:** their tables.
- **App card images:** upload to the `SaIL-Away` storage bucket under
  `apps/`, and put the file name (e.g. `esr.png`) in the app's `image`. The
  bucket is private; signed-in people get short-lived links.
- **Eventbrite tokens and the staff access code:** `site_secrets` - never in
  the repo, never sent to a browser.
- Public sign-ups are switched off.

## Working on it

Secrets live outside the repo in `~/.config/sail-away.env` (plain
`KEY=VALUE` lines): `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_PASSWORD`, `SUPABASE_PUBLISHABLE_KEY`, and the test accounts'
`TEST_*_PASSWORD`s.

```
npm ci && npx playwright install chromium     # once
npx supabase db push --remote                 # apply new migrations
npx supabase functions deploy api --use-api --no-verify-jwt
tools/run.sh seed                             # sample data, empty database only
tools/run.sh test                             # the tests
tools/run.sh sql < query.sql                  # SQL as the database owner
```

To see the board locally, serve the repo from a folder named like the Pages
one - e.g. `python3 -m http.server` in a parent folder holding a
`SaIL-Away` link to the repo - and open `/SaIL-Away/`.

Form links are `form.html#<code>`; the public availability page is
`availability.html?site=<code>`.
