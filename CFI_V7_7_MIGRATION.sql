begin;
create table if not exists public.cfi_sessions (
  id uuid primary key,
  user_id uuid not null references public.cfi_users(id) on delete cascade,
  session_version integer not null,
  device text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists cfi_sessions_user_idx on public.cfi_sessions(user_id, expires_at);
alter table public.cfi_sessions enable row level security;
revoke all on public.cfi_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.cfi_sessions to service_role;
commit;

begin;
-- Serialize logins per account, including simultaneous requests on different servers.
create or replace function public.cfi_open_session_v77(p_user uuid,p_sid uuid,p_sv integer,p_device text,p_exp timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
declare acct public.cfi_users%rowtype;
begin
 select * into acct from public.cfi_users where id=p_user for update;
 if not found or not acct.active or acct.session_version<>p_sv then return false; end if;
 if acct.role='student' and exists(select 1 from public.cfi_sessions where user_id=p_user and session_version=p_sv and revoked_at is null and expires_at>now()) then return false; end if;
 insert into public.cfi_sessions(id,user_id,session_version,device,expires_at) values(p_sid,p_user,p_sv,left(p_device,100),p_exp);
 return true;
end; $$;
revoke all on function public.cfi_open_session_v77(uuid,uuid,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.cfi_open_session_v77(uuid,uuid,integer,text,timestamptz) to service_role;
commit;
