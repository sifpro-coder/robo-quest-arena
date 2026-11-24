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
