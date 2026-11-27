-- CFI V7.1 - existing database, after V7.0. Non-destructive.
begin;
alter table public.cfi_users
  add column if not exists lifetime_traffic boolean not null default false,
  add column if not exists lifetime_home boolean not null default false;
insert into public.cfi_settings(key,value_int) values
  ('lifetime_traffic_millimes',9000),
  ('lifetime_home_millimes',19000)
on conflict (key) do nothing;
commit;
