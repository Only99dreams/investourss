-- Private storage bucket for user-uploaded bank statement PDFs.
insert into storage.buckets (id, name, public)
values ('statements', 'statements', false)
on conflict (id) do nothing;

-- Upload: users may only write inside their own {user_id}/ folder.
drop policy if exists "statements_insert_own" on storage.objects;
create policy "statements_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Read: users may only read their own statements.
drop policy if exists "statements_select_own" on storage.objects;
create policy "statements_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete: users may only delete their own statements.
drop policy if exists "statements_delete_own" on storage.objects;
create policy "statements_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
