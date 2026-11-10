-- Open lineups: a league whose admin turns this on shows every team's current lineup,
-- any time - not only as saved at the lock. For a league of friends who don't mind, and
-- for trying a league out with several teams of your own. Off by default: rivals'
-- lineups stay hidden until the round locks.

alter table public.leagues add column open_lineups boolean not null default false;
grant update (open_lineups) on public.leagues to authenticated;  -- the admin-only update policy applies

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
        'open_lineups', l.open_lineups,
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
                'lineup', case when l.open_lineups then t.lineup else tr.lineup end
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
