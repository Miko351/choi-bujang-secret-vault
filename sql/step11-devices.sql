-- Review, then run in the learning project's SQL Editor. No existing note rows or policies are changed.
begin;
create table public.vault_devices (
  id uuid primary key,
  owner_id uuid not null,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null check (counter >= 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected','revoked')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  check ((status = 'approved') = (approved_at is not null))
);
create table public.vault_device_challenges (
  id uuid primary key,
  owner_id uuid not null,
  auth_binding text not null check (auth_binding ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('registration','authentication')),
  challenge text not null,
  expires_at timestamptz not null
);
create table public.vault_device_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  device_id uuid not null references public.vault_devices(id) on delete cascade,
  owner_id uuid not null,
  auth_binding text not null check (auth_binding ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);
create index on public.vault_devices(owner_id);
create index on public.vault_device_challenges(expires_at);
create index on public.vault_device_sessions(expires_at);
alter table public.vault_devices enable row level security;
alter table public.vault_device_challenges enable row level security;
alter table public.vault_device_sessions enable row level security;
revoke all on table public.vault_devices, public.vault_device_challenges, public.vault_device_sessions from PUBLIC, anon, authenticated;
grant select, insert, update, delete on table public.vault_devices, public.vault_device_challenges, public.vault_device_sessions to service_role;
commit;
-- The web APIs only insert status=pending. Approval is a separate trusted DB action.
-- Inspect pending requests privately in SQL Editor; never publish these rows or public keys.
-- select id, owner_id, status, created_at from public.vault_devices order by created_at desc;
-- After independently checking the displayed request ID and its account, replace the UUIDs yourself:
-- update public.vault_devices set status='approved', approved_at=now()
-- where id='REVIEWED_REQUEST_UUID'::uuid and owner_id='VERIFIED_OWNER_UUID'::uuid and status='pending';
-- Revoke the exact request without deleting note/audit data:
-- update public.vault_devices set status='revoked', approved_at=null where id='REVIEWED_REQUEST_UUID'::uuid;
-- Periodically remove expired challenges/sessions in SQL Editor (does not approve a device):
-- delete from public.vault_device_challenges where expires_at < now();
-- delete from public.vault_device_sessions where expires_at < now();
