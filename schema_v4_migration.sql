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
