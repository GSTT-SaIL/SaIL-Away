# Notes for Claude Code

**This repo is public.** Never commit secrets, server addresses, personal
emails or IP addresses. Secrets live in `~/.config/sail-away.env`; read it as
plain `KEY=VALUE` lines (as `tools/run.sh` does) and never print the values.

SaIL-Away is a rebuild of the private `Facilities` board (PocketBase + Docker
on a VPS) as GitHub Pages + Supabase. **Facilities is read-only** - copy from
it, never change it. The whole site is a test site for now; there's one
Supabase project and Claude may change its data and schema.

Read [README.md](README.md) first, then **[docs/DESIGN.md](docs/DESIGN.md)
before any visible change** - the design tokens, shared components and every
look the user chose. Don't restyle a component inside one view.

## How the port works

- **`js/core/pb.js` is an adapter**: the views still call a PocketBase-shaped
  `pb` (`pb.collection(x).getFullList({ filter, sort, fields })`,
  `pb.filter()`, `pb.send("/api/...")`, `pb.authStore`), and it turns them
  into Supabase calls. Filters use PocketBase syntax, parsed there; it throws
  on anything it doesn't support rather than guessing. Extend it there.
- **Column names match the old app** (`group`, `end`, `from`, `to`, `set`,
  `user`) so views didn't change - quote them in SQL.
- **Empty values are `''` / `0` / `false`, not null** (PocketBase did that and
  the views rely on it); single relations are null when empty.
- **Security is row-level security + triggers** in
  `supabase/migrations/`. Helper functions are in schema `app`, which the API
  doesn't expose. Triggers that read other tables are `security definer`, so
  RLS can't hide a parent and let a record be filed under the wrong site.
- **Never edit an applied migration** - add a new one.
- **Server routes are one Edge Function**, `supabase/functions/api`, under the
  old `/api/...` paths. It runs with the service key, so each route checks
  who's asking itself. Public routes send only fields picked one by one.

## Rules carried over from Facilities (the user's calls)

- Only admins and the site's editors change anything; viewers see
  everything on their sites. Leave: admins only. `user_prefs`: everyone,
  their own row only.
- **Never use `confirm()`/`alert()`** - use `ask()`/`tell()` from
  `js/core/dialog.js`.
- **Never create real Eventbrite drafts** - test the course form with the dry
  run (`dry: true`) only.
- People are shown by name, never email: the `staff` view, and
  `author` + `author_name` copies on notes.
- No links between invoices and courses; no draft quotes; no "cancelled"
  status; numbers are never reused.
- One place decides the financial year (`js/core/period.js`) and one the site
  (`js/core/site.js`).

## Testing

`tools/run.sh test` runs Playwright against a local static server and the
Supabase project, signed in as the seeded test accounts. Tests that change
data put it back. Also look at changed views in a browser - tests can't see
layout.
