-- CFI Academy V5.4 — À EXÉCUTER UNE FOIS DANS SUPABASE SQL EDITOR
-- Table privée: historique complet des essais et activité scolaire sur la plateforme.
-- Nécessite les tables déjà installées par CFI V5. Aucune donnée existante effacée.
create extension if not exists pgcrypto;
create table if not exists public.cfi_quiz_attempts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.cfi_users(id) on delete cascade,
 lesson_id text not null,
 ticket_hash text not null,
 score integer not null check(score between 0 and 20),
 correct integer not null check(correct >= 0),
 total integer not null check(total between 1 and 10),
 study_day date not null,
 created_at timestamptz not null default now(),
 unique(user_id, ticket_hash)
);
create index if not exists cfi_attempts_user_date on public.cfi_quiz_attempts(user_id, created_at desc);
create index if not exists cfi_attempts_lesson on public.cfi_quiz_attempts(lesson_id);
alter table public.cfi_quiz_attempts enable row level security;
-- Pas de policies ouvertes à anon/authenticated: les accès passent par Render (service role).
