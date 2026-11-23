-- App card images live in the private "SaIL-Away" storage bucket, under
-- apps/. Anyone signed in can read them (the board asks for short-lived
-- signed URLs); nobody writes from the board - upload them in Studio, which
-- uses the service key. apps.image holds the path inside apps/, e.g.
-- "esr.png" for SaIL-Away/apps/esr.png.
create policy "signed-in people read app images"
  on storage.objects for select to authenticated
  using (bucket_id = 'SaIL-Away' and (storage.foldername(name))[1] = 'apps');
