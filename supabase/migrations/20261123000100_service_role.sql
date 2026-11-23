-- The server role (Edge Functions, tools/seed.mjs) works on every table,
-- past RLS. New Supabase projects no longer grant it this by default.
grant usage on schema app to service_role;
grant execute on all functions in schema app to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
