-- CFI Academy database. Run once in Supabase > SQL Editor.
-- No anonymous policies: only the trusted Render server service_role may query these tables.
create extension if not exists pgcrypto;
create table if not exists public.cfi_users (
 id uuid primary key default gen_random_uuid(),
 username text not null unique,
 display_name text not null,
 password_hash text not null,
 role text not null check (role in ('admin','student')),
 active boolean not null default true,
 must_change_password boolean not null default false,
 session_version integer not null default 1,
 created_at timestamptz not null default now()
);
create table if not exists public.cfi_submissions (
 user_id uuid not null references public.cfi_users(id) on delete cascade,
 lesson_id text not null,
 code text not null default '',
 notes text not null default '',
 score int not null default 0 check (score between 0 and 20),
 best_score int not null default 0 check (best_score between 0 and 20),
 correct int not null default 0,
 total int not null default 0,
 quiz_details jsonb not null default '[]'::jsonb,
 review_status text not null default 'pending' check (review_status in ('pending','reviewed','needs_changes')),
 review_note text not null default '',
 updated_at timestamptz not null default now(),
 primary key (user_id,lesson_id)
);
create table if not exists public.cfi_extra_lessons (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 intro text not null,
 task text not null default '',
 terms text not null default '',
 subject text not null default 'ESP32',
 type text not null default 'lesson',
 week int not null default 23,
 quiz jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now()
);
create table if not exists public.cfi_certificates (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references public.cfi_users(id) on delete cascade,
 code text not null unique,
 session text not null default 'ESP32 · Smart Home Mini',
 issued_at timestamptz not null default now()
);
alter table public.cfi_users enable row level security;
alter table public.cfi_submissions enable row level security;
alter table public.cfi_extra_lessons enable row level security;
alter table public.cfi_certificates enable row level security;
-- Do not create any anon / authenticated RLS policies; credentials are validated in Node.
-- Do not paste the Supabase service_role key inside these files or the browser.


-- CFI Academy V4 migration: apply AFTER V3 schema.sql in Supabase SQL Editor.
-- Old professor-created accounts (without email) remain valid.
alter table public.cfi_users add column if not exists email text;
alter table public.cfi_users add column if not exists email_verified boolean not null default false;
alter table public.cfi_users add column if not exists approval_method text not null default 'prof';
alter table public.cfi_users add column if not exists activation_status text not null default 'active';
create unique index if not exists cfi_users_unique_email on public.cfi_users (lower(email)) where email is not null;
create table if not exists public.cfi_email_tokens (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.cfi_users(id) on delete cascade,
 token_hash text not null unique,
 expires_at timestamptz not null,
 used_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.cfi_payments (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.cfi_users(id) on delete cascade,
 gateway text not null default 'konnect',
 payment_ref text not null unique,
 amount_millimes integer not null check (amount_millimes>0),
 status text not null default 'pending' check (status in ('pending','paid')),
 paid_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.cfi_email_tokens enable row level security;
alter table public.cfi_payments enable row level security;
-- These tables are accessed ONLY by trusted Render server using Supabase secret key.


-- CFI Academy V5 — run AFTER schema.sql and schema_v4_migration.sql.
-- Adds rolling monthly access and a teacher-editable price (default 10 TND = 10000 millimes).
create table if not exists public.cfi_settings (
 key text primary key,
 value_int integer not null check (value_int between 1000 and 1000000),
 updated_at timestamptz not null default now()
);
insert into public.cfi_settings(key,value_int) values ('monthly_price_millimes',10000)
on conflict (key) do nothing;
alter table public.cfi_settings enable row level security;

alter table public.cfi_users add column if not exists access_expires_at timestamptz;
alter table public.cfi_users add column if not exists access_source text;
-- Existing approved students receive one-month grace at migration (no accidental lockout).
update public.cfi_users set access_expires_at=now()+interval '1 month',access_source='prof'
where role='student' and active=true and access_expires_at is null;

-- This RPC is invoked ONLY after the trusted Render server independently verifies
-- the payment with Konnect (amount, currency, id, order id and COMPLETED state).
-- The transaction/row locks ensure webhook retries never credit the same payment twice.
create or replace function public.cfi_apply_verified_payment(p_ref text)
returns void
language plpgsql security definer set search_path=public as $$
declare payrow public.cfi_payments%rowtype;
        account public.cfi_users%rowtype;
        next_exp timestamptz;
begin
 select * into payrow from public.cfi_payments where payment_ref=p_ref for update;
 if not found then raise exception 'Unknown payment'; end if;
 if payrow.status='paid' then return; end if;
 select * into account from public.cfi_users where id=payrow.user_id for update;
 if not found or account.role<>'student' or account.email_verified is not true
   then raise exception 'Ineligible account'; end if;
 next_exp := greatest(coalesce(account.access_expires_at,now()),now()) + interval '1 month';
 update public.cfi_users set active=true,activation_status='active',access_expires_at=next_exp,access_source='payment' where id=account.id;
 update public.cfi_payments set status='paid',paid_at=now() where id=payrow.id;
end;
$$;
revoke all on function public.cfi_apply_verified_payment(text) from public,anon,authenticated;
grant execute on function public.cfi_apply_verified_payment(text) to service_role;
-- This migration grants no public read/write access to student records.
