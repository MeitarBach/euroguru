-- The membership checks behind the league policies need not be callable over the API
-- (/rest/v1/rpc/...), which only exposes `public`. Move them to a private schema: the
-- policies follow them (they reference the function, not its name), and
-- league_board(), which calls one by name, is recreated to match.

create schema if not exists private;
grant usage on schema private to authenticated;

alter function public.is_league_member(uuid) set schema private;
alter function public.is_league_admin(uuid) set schema private;

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
