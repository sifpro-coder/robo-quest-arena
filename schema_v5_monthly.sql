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
