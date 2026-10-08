-- Run in the official Supabase SQL Editor for the existing learning table.
-- The server key uses service_role. Existing RLS, client grants and rows stay intact.
grant select, insert, update, delete on table public.vault_notes to service_role;
