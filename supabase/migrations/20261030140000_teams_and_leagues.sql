-- Teams and leagues for the Live tab.
--
-- A team is 5 starters (one captain, x2), 5 bench players and a head coach. The first
-- player on the bench is the sixth man and counts in full (x1); the other four count
-- half (x0.5), so the bench's order matters and is kept as saved. The lineup has
-- the same shape as a Live tab watchlist (frontend/src/hooks/useWatchGroups.js):
--   lineup = { keys: ["id:<n>", ...], bench: [...], captain: "id:<n>" | null, coach: "coach:<n>" | null }
-- where `keys` holds every player and `bench` is the subset on the bench.
--
-- Lineups freeze for a round from its first tip-off until three hours after its last
-- one (`rounds`, filled from the schedule by backend/utils/rounds.py). A pg_cron job
-- saves every team's lineup when a round locks (`team_rounds`), and league members see
-- each other's lineups only from those saved copies - so nobody can read a rival's
-- picks before the lock and copy them.
--
-- Every rule that matters lives here rather than in the client: RLS keeps teams
-- private to their owner, and the security-definer functions are the only way to see
-- someone else's team or to join a league.

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------- profiles

create table public.profiles (
    user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
    nickname   text not null check (char_length(btrim(nickname)) between 1 and 24),
    updated_at timestamptz not null default now()
);
comment on table public.profiles is
    'The name a user shows in leagues. Defaults to the Google first name; never an email.';

alter table public.profiles enable row level security;
create policy "profiles: own row" on public.profiles
    for all to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

-- ------------------------------------------------------------------------------ rounds

create table public.rounds (
    season    int not null,
    round     int not null,
    lock_at   timestamptz not null,
    unlock_at timestamptz not null,
    primary key (season, round),
    check (unlock_at > lock_at)
);
comment on table public.rounds is
    'Lineup lock per round: first tip-off to last tip-off + 3h. Written by the data run, read by everyone.';

alter table public.rounds enable row level security;
create policy "rounds: readable by all" on public.rounds for select to anon, authenticated using (true);
revoke insert, update, delete on public.rounds from anon, authenticated;

-- The round whose lock window is open right now, if any.
create function public.locked_round()
returns table (season int, round int, lock_at timestamptz, unlock_at timestamptz)
language sql stable set search_path = ''
as $$
    select r.season, r.round, r.lock_at, r.unlock_at
    from public.rounds r
    where now() >= r.lock_at and now() < r.unlock_at
    order by r.lock_at desc
    limit 1;
$$;

-- ------------------------------------------------------------------------------- teams

create function public.lineup_valid(lineup jsonb)
returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
    players text[];
    benched text[];
begin
    if jsonb_typeof(lineup) is distinct from 'object'
       or jsonb_typeof(lineup -> 'keys') is distinct from 'array'
       or jsonb_typeof(lineup -> 'bench') is distinct from 'array' then
        return false;
    end if;
    select coalesce(array_agg(e.v), '{}') into players from jsonb_array_elements_text(lineup -> 'keys') as e(v);
    select coalesce(array_agg(e.v), '{}') into benched from jsonb_array_elements_text(lineup -> 'bench') as e(v);

    return
        -- players are "id:<n>", each once
        (select bool_and(u.v ~ '^id:\d+$') from unnest(players) as u(v)) is not false
        and cardinality(players) = (select count(distinct u.v) from unnest(players) as u(v))
        -- the bench is a subset, at most 5, and so are the starters
        and benched <@ players
        and cardinality(benched) = (select count(distinct u.v) from unnest(benched) as u(v))
        and cardinality(benched) <= 5
        and cardinality(players) - cardinality(benched) <= 5
        -- the captain is a starter
        and (lineup ->> 'captain' is null
             or (lineup ->> 'captain' = any (players) and not lineup ->> 'captain' = any (benched)))
        -- one head coach, or none
        and (lineup ->> 'coach' is null or lineup ->> 'coach' ~ '^coach:\d+$');
end;
$$;

create table public.teams (
    id         uuid primary key default gen_random_uuid(),
    owner      uuid not null default auth.uid() references auth.users (id) on delete cascade,
    name       text not null check (char_length(btrim(name)) between 1 and 24),
    lineup     jsonb not null default '{"keys": [], "bench": [], "captain": null, "coach": null}'
               check (public.lineup_valid(lineup)),
    share_slug text unique,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index teams_owner_idx on public.teams (owner);
comment on table public.teams is
    'A user''s fantasy teams (at most 5). lineup has the watchlist shape; see the migration header.';

alter table public.teams enable row level security;
create policy "teams: owner only" on public.teams
    for all to authenticated
    using (owner = (select auth.uid()))
    with check (owner = (select auth.uid()));

-- Clients write a team's name and lineup and nothing else: the owner comes from the
-- session and the share slug from share_team() (phase C).
revoke all on public.teams from anon, authenticated;
grant select, delete on public.teams to authenticated;
grant insert (name, lineup), update (name, lineup) on public.teams to authenticated;

create function public.teams_guard()
returns trigger
language plpgsql set search_path = ''
as $$
declare
    win record;
begin
    select * into win from public.locked_round();

    if tg_op = 'INSERT' then
        -- Serialise one owner's inserts so two at once cannot both pass the count.
        perform pg_advisory_xact_lock(hashtext('teams:' || new.owner::text));
        if (select count(*) from public.teams where owner = new.owner) >= 5 then
            raise exception 'You can have up to 5 teams' using errcode = 'P0001';
        end if;
        if win.round is not null and jsonb_array_length(new.lineup -> 'keys') > 0 then
            raise exception 'Lineups are locked until %', win.unlock_at using errcode = 'P0002';
        end if;
    elsif new.lineup is distinct from old.lineup and win.round is not null then
        raise exception 'Lineups are locked until %', win.unlock_at using errcode = 'P0002';
    end if;

    new.updated_at := now();
    return new;
end;
$$;

create trigger teams_guard before insert or update on public.teams
    for each row execute function public.teams_guard();

-- ------------------------------------------------------------------------- team_rounds

create table public.team_rounds (
    team_id   uuid not null references public.teams (id) on delete cascade,
    season    int not null,
    round     int not null,
    lineup    jsonb not null,
    locked_at timestamptz not null,
    -- Filled when season totals are built: the saved lineup plus the stored stats.
    score     numeric,
    primary key (team_id, season, round),
    foreign key (season, round) references public.rounds (season, round) on delete cascade
);
comment on table public.team_rounds is
    'Each team''s lineup as it stood at a round''s lock, saved by the snapshot-locked-lineups cron job.';

alter table public.team_rounds enable row level security;
create policy "team_rounds: owner reads" on public.team_rounds
    for select to authenticated
    using (exists (select 1 from public.teams t where t.id = team_id and t.owner = (select auth.uid())));
revoke insert, update, delete on public.team_rounds from anon, authenticated;

-- Lineups cannot change inside a lock window, so a copy made any time inside it is the
-- lineup that played; a team made mid-round (empty, see teams_guard) gets an empty one.
create function public.snapshot_locked_lineups()
returns int
language sql security definer set search_path = ''
as $$
    with saved as (
        insert into public.team_rounds (team_id, season, round, lineup, locked_at)
        select t.id, r.season, r.round, t.lineup, r.lock_at
        from public.locked_round() r cross join public.teams t
        on conflict do nothing
        returning 1
    )
    select count(*)::int from saved;
$$;
revoke execute on function public.snapshot_locked_lineups() from public, anon, authenticated;

select cron.schedule('snapshot-locked-lineups', '* * * * *', 'select public.snapshot_locked_lineups()');

-- ----------------------------------------------------------------------------- leagues

create table public.leagues (
    id          uuid primary key default gen_random_uuid(),
    name        text not null check (char_length(btrim(name)) between 1 and 40),
    admin       uuid not null default auth.uid() references auth.users (id) on delete cascade,
    invite_code text not null unique default substr(md5(gen_random_uuid()::text), 1, 10),
    season      int not null,
    created_at  timestamptz not null default now()
);
create index leagues_admin_idx on public.leagues (admin);

create table public.league_teams (
    league_id uuid not null references public.leagues (id) on delete cascade,
    team_id   uuid not null references public.teams (id) on delete cascade,
    joined_at timestamptz not null default now(),
    primary key (league_id, team_id)
);
create index league_teams_team_idx on public.league_teams (team_id);

-- Membership checks for the policies below. Security definer so a policy on
-- league_teams can ask about league_teams without recursing into itself.
create function public.is_league_member(lid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.league_teams lt join public.teams t on t.id = lt.team_id
        where lt.league_id = lid and t.owner = (select auth.uid())
    );
$$;

create function public.is_league_admin(lid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (select 1 from public.leagues where id = lid and admin = (select auth.uid()));
$$;

alter table public.leagues enable row level security;
create policy "leagues: members and admin read" on public.leagues
    for select to authenticated
    using (admin = (select auth.uid()) or public.is_league_member(id));
create policy "leagues: create as admin" on public.leagues
    for insert to authenticated
    with check (admin = (select auth.uid()));
create policy "leagues: admin renames" on public.leagues
    for update to authenticated
    using (admin = (select auth.uid()))
    with check (admin = (select auth.uid()));
create policy "leagues: admin deletes" on public.leagues
    for delete to authenticated
    using (admin = (select auth.uid()));

revoke all on public.leagues from anon, authenticated;
grant select, delete on public.leagues to authenticated;
grant insert (name, season), update (name) on public.leagues to authenticated;

alter table public.league_teams enable row level security;
create policy "league_teams: members read" on public.league_teams
    for select to authenticated
    using (public.is_league_member(league_id) or public.is_league_admin(league_id));
-- Leaving is deleting your own team's row; the admin can remove anyone's.
create policy "league_teams: owner leaves, admin removes" on public.league_teams
    for delete to authenticated
    using (
        exists (select 1 from public.teams t where t.id = team_id and t.owner = (select auth.uid()))
        or public.is_league_admin(league_id)
    );
-- Joining goes through join_league(), which checks the invite code and the cap.
revoke all on public.league_teams from anon, authenticated;
grant select, delete on public.league_teams to authenticated;

-- ------------------------------------------------------------------------------- RPCs

-- What an invite link shows before joining: sign-in required, as for everything here.
create function public.league_preview(code text)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
    l public.leagues;
begin
    if (select auth.uid()) is null then
        raise exception 'Sign in to see this league' using errcode = '42501';
    end if;
    select * into l from public.leagues where invite_code = code;
    if l.id is null then
        return null;
    end if;
    return json_build_object(
        'id', l.id,
        'name', l.name,
        'season', l.season,
        'admin', coalesce((select nickname from public.profiles where user_id = l.admin), 'Admin'),
        'teams', (select count(*) from public.league_teams where league_id = l.id),
        'my_teams', coalesce((
            select json_agg(lt.team_id) from public.league_teams lt
            join public.teams t on t.id = lt.team_id
            where lt.league_id = l.id and t.owner = (select auth.uid())
        ), '[]'::json)
    );
end;
$$;

create function public.join_league(code text, team uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    lid uuid;
begin
    if (select auth.uid()) is null then
        raise exception 'Sign in to join a league' using errcode = '42501';
    end if;
    select id into lid from public.leagues where invite_code = code;
    if lid is null then
        raise exception 'This invite link is no longer valid' using errcode = 'P0003';
    end if;
    if not exists (select 1 from public.teams where id = team and owner = (select auth.uid())) then
        raise exception 'Not your team' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtext('league:' || lid::text));
    if exists (select 1 from public.league_teams where league_id = lid and team_id = team) then
        return lid;
    end if;
    if (select count(*) from public.league_teams where league_id = lid) >= 30 then
        raise exception 'This league is full (30 teams)' using errcode = 'P0004';
    end if;
    insert into public.league_teams (league_id, team_id) values (lid, team);
    return lid;
end;
$$;

-- The league's table. Names and nicknames always; lineups only as saved at the lock of
-- the latest round that has started, so nobody sees a rival's picks before tip-off.
-- Your own teams' lineups you can read anyway (the teams table).
create function public.league_board(lid uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
    l public.leagues;
    r public.rounds;
    nxt public.rounds;
begin
    select * into l from public.leagues where id = lid;
    if l.id is null or not (l.admin = (select auth.uid()) or public.is_league_member(lid)) then
        raise exception 'League not found' using errcode = 'P0005';
    end if;

    select * into r from public.rounds
        where season = l.season and lock_at <= now() order by lock_at desc limit 1;
    select * into nxt from public.rounds
        where season = l.season and lock_at > now() order by lock_at limit 1;

    return json_build_object(
        'id', l.id,
        'name', l.name,
        'season', l.season,
        'invite_code', l.invite_code,
        'is_admin', l.admin = (select auth.uid()),
        'round', case when r.round is null then null else json_build_object(
            'round', r.round, 'lock_at', r.lock_at, 'unlock_at', r.unlock_at,
            'locked', now() < r.unlock_at) end,
        'next_lock', nxt.lock_at,
        'teams', coalesce((
            select json_agg(json_build_object(
                'team_id', t.id,
                'name', t.name,
                'nickname', coalesce(p.nickname, 'Player'),
                'mine', t.owner = (select auth.uid()),
                'joined_at', lt.joined_at,
                'lineup', tr.lineup
            ) order by lt.joined_at)
            from public.league_teams lt
            join public.teams t on t.id = lt.team_id
            left join public.profiles p on p.user_id = t.owner
            left join public.team_rounds tr
                   on tr.team_id = t.id and tr.season = r.season and tr.round = r.round
            where lt.league_id = lid
        ), '[]'::json)
    );
end;
$$;

create function public.reset_invite(lid uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
    code text := substr(md5(gen_random_uuid()::text), 1, 10);
begin
    update public.leagues set invite_code = code
        where id = lid and admin = (select auth.uid());
    if not found then
        raise exception 'Only the league admin can reset the link' using errcode = '42501';
    end if;
    return code;
end;
$$;

revoke execute on function public.league_preview(text), public.join_league(text, uuid),
    public.league_board(uuid), public.reset_invite(uuid) from public, anon;
grant execute on function public.league_preview(text), public.join_league(text, uuid),
    public.league_board(uuid), public.reset_invite(uuid) to authenticated;
revoke execute on function public.is_league_member(uuid), public.is_league_admin(uuid) from public, anon;
grant execute on function public.is_league_member(uuid), public.is_league_admin(uuid) to authenticated;
