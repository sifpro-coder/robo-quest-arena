-- CFI V6: run on the existing database only. No data deletion or account changes.
-- Existing V5.4 attempts table must already exist.
begin;
alter table public.cfi_quiz_attempts drop constraint if exists cfi_quiz_attempts_total_check;
alter table public.cfi_quiz_attempts add constraint cfi_quiz_attempts_total_check check (total between 1 and 12);
commit;
