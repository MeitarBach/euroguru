-- The first migration raised its errors as P0002-P0005, which Postgres already gives
-- meanings (no_data_found, too_many_rows, assert_failure - the last one cannot even be
-- caught by a WHEN OTHERS handler). Every rule now raises the plain user error, P0001,
-- with a short hint the client can switch on: locked, team_cap, league_full,
-- bad_invite, not_found.

create or replace function public.teams_guard()
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
            raise exception 'You can have up to 5 teams' using hint = 'team_cap';
        end if;
        if win.round is not null and jsonb_array_length(new.lineup -> 'keys') > 0 then
            raise exception 'Lineups are locked until %', win.unlock_at using hint = 'locked';
        end if;
    elsif new.lineup is distinct from old.lineup and win.round is not null then
        raise exception 'Lineups are locked until %', win.unlock_at using hint = 'locked';
    end if;

    new.updated_at := now();
    return new;
end;
$$;

create or replace function public.join_league(code text, team uuid)
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
        raise exception 'This invite link is no longer valid' using hint = 'bad_invite';
    end if;
    if not exists (select 1 from public.teams where id = team and owner = (select auth.uid())) then
        raise exception 'Not your team' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtext('league:' || lid::text));
    if exists (select 1 from public.league_teams where league_id = lid and team_id = team) then
        return lid;
    end if;
    if (select count(*) from public.league_teams where league_id = lid) >= 30 then
        raise exception 'This league is full (30 teams)' using hint = 'league_full';
    end if;
    insert into public.league_teams (league_id, team_id) values (lid, team);
    return lid;
end;
$$;

create or replace function public.league_board(lid uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
    l public.leagues;
    r public.rounds;
    nxt public.rounds;
begin
    select * into l from public.leagues where id = lid;
    if l.id is null or not (l.admin = (select auth.uid()) or private.is_league_member(lid)) then
        raise exception 'League not found' using hint = 'not_found';
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
