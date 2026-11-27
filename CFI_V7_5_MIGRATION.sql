-- V7.5: apply on the existing Supabase project. No existing tables or rights are deleted.
begin;
alter table public.cfi_users add column if not exists player_name text;
create unique index if not exists cfi_player_name_unique_v75 on public.cfi_users(lower(player_name)) where player_name is not null;
create or replace function public.cfi_claim_player_name_v75(p_user uuid,p_name text)
returns text language plpgsql security definer set search_path=public as $$
declare current_name text;
begin
 if p_name is null or p_name !~ '^[A-Za-z0-9_]{3,18}$' or left(lower(p_name),6) = 'guest_' then return 'invalid'; end if;
 select player_name into current_name from public.cfi_users where id=p_user and role='student' and active and not must_change_password for update;
 if not found then return 'forbidden'; end if;
 if current_name is not null then return 'already'; end if;
 begin
  update public.cfi_users set player_name=p_name where id=p_user;
 exception when unique_violation then return 'taken'; end;
 return 'ok';
end; $$;
revoke all on function public.cfi_claim_player_name_v75(uuid,text) from public, anon, authenticated;
grant execute on function public.cfi_claim_player_name_v75(uuid,text) to service_role;

create table if not exists public.cfi_game_results_v75 (
  user_id uuid not null references public.cfi_users(id) on delete cascade,
  match_id uuid not null,
  game text not null check (game in ('arena','quiz','snake','battle','maze','debug','memory','circuit')),
  score int not null check (score between 0 and 1000000),
  placement int not null check (placement between 1 and 12),
  duration_min int not null check (duration_min between 1 and 5),
  player_count int not null check (player_count between 1 and 12),
  xp int not null check (xp between 0 and 20),
  played_at timestamptz not null default now(),
  primary key(user_id,match_id)
);
create index if not exists cfi_game_results_v75_user_date on public.cfi_game_results_v75(user_id,played_at desc);
alter table public.cfi_game_results_v75 enable row level security;
revoke all on public.cfi_game_results_v75 from public, anon, authenticated;
grant select on public.cfi_game_results_v75 to service_role;

-- Only the trusted game server calls this RPC. Lock the account for atomic daily cap and retries.
create or replace function public.cfi_record_game_v75(p_user uuid,p_match uuid,p_game text,p_score int,p_rank int,p_duration int,p_players int)
returns void language plpgsql security definer set search_path=public as $$
declare spent int; award int;
begin
  perform 1 from public.cfi_users where id=p_user and active and role='student' for update;
  if not found then return; end if;
  if exists(select 1 from public.cfi_game_results_v75 where user_id=p_user and match_id=p_match) then return; end if;
  select coalesce(sum(xp),0)::int into spent from public.cfi_game_results_v75
    where user_id=p_user and played_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  award:=greatest(0,least(20,100-spent,ceil(p_score/10.0)::int));
  insert into public.cfi_game_results_v75(user_id,match_id,game,score,placement,duration_min,player_count,xp)
  values(p_user,p_match,p_game,p_score,p_rank,p_duration,p_players,award)
  on conflict(user_id,match_id) do nothing;
end; $$;
revoke all on function public.cfi_record_game_v75(uuid,uuid,text,int,int,int,int) from public, anon, authenticated;
grant execute on function public.cfi_record_game_v75(uuid,uuid,text,int,int,int,int) to service_role;

-- No personal names, email addresses or raw account IDs in the leaderboard response.
create or replace function public.cfi_rewards_v75(p_user uuid)
returns jsonb language sql stable security definer set search_path=public as $$
with learning as (
  select user_id, count(*) filter(where best_score>=12)*50 as xp from public.cfi_submissions group by user_id
), gaming as (
  select user_id, sum(xp) as xp, count(*) as games from public.cfi_game_results_v75 group by user_id
), totals as (
  select u.id, u.player_name as alias,
    coalesce(l.xp,0) as lesson_xp,coalesce(g.xp,0) as game_xp,coalesce(g.games,0) as games,
    coalesce(l.xp,0)+coalesce(g.xp,0) as xp
  from public.cfi_users u left join learning l on l.user_id=u.id left join gaming g on g.user_id=u.id
  where u.role='student' and u.active
), ranked as (
  select *,rank() over(order by xp desc) as rank from totals where xp>0 and alias is not null
), recent as (
  select game,score,placement,duration_min,player_count,xp,played_at from public.cfi_game_results_v75 where user_id=p_user order by played_at desc limit 30
), top_players as (
  select alias,xp,rank, (id=p_user) as me from ranked order by rank,alias limit 20
)
select jsonb_build_object('me',(select jsonb_build_object('alias',t.alias,'xp',t.xp,'lessonXp',t.lesson_xp,'gameXp',t.game_xp,'games',t.games,'rank',r.rank,'level',1+t.xp/250,'nextLevelXp',(1+t.xp/250)*250) from totals t left join ranked r on r.id=t.id where t.id=p_user),
 'leaderboard',coalesce((select jsonb_agg(to_jsonb(z) order by z.rank,z.alias) from top_players z),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.played_at desc) from recent h),'[]'::jsonb));
$$;
revoke all on function public.cfi_rewards_v75(uuid) from public, anon, authenticated;
grant execute on function public.cfi_rewards_v75(uuid) to service_role;
commit;
