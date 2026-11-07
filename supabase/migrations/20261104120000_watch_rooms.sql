-- Leagues become Watch Rooms.
--
-- EuroGuru is a companion to EuroLeague Fantasy, not a rival game, so a room has no
-- season table: it is a place to bring your teams, watch everyone's score live for the
-- round being played, and chat while the games are on. Rooms are public (anyone signed
-- in can find and join them) or private (an invite link only), and stay open until
-- their admin closes them - closing deletes the room and its chat.
--
-- What stays: teams, the round lock and its lineup snapshots (team_rounds), so rivals'
-- lineups are still hidden until the round's first tip-off. What goes: open_lineups and
-- the league's season (a room outlives a season; its board shows the latest round).
--
-- Chat is open only around games: from an hour before a tip-off until an hour after the
-- game ends (tip-off + 3h), from the tip-offs in `fixtures`, which the data run writes
-- next to `rounds` (backend/utils/rounds.py). Overlapping windows merge into one session.

-- ------------------------------------------------------------------------ rename

alter table public.leagues rename to rooms;
alter table public.league_teams rename to room_teams;
alter table public.room_teams rename column league_id to room_id;
alter index public.leagues_admin_idx rename to rooms_admin_idx;
alter index public.league_teams_team_idx rename to room_teams_team_idx;

-- The old RPCs name the old tables in their bodies; the room ones below replace them.
drop function public.league_preview(text);
drop function public.join_league(text, uuid);
drop function public.league_board(uuid);

alter table public.rooms drop column open_lineups;
alter table public.rooms drop column season;
alter table public.rooms
    add column visibility text not null default 'private' check (visibility in ('public', 'private')),
    -- The EuroGuru Room: pinned on top of the public list, with a bigger cap. Set by hand
    -- (SQL), never by a client - no grant covers it.
    add column official boolean not null default false,
    add constraint rooms_official_public check (not official or visibility = 'public');
comment on table public.rooms is
    'Watch Rooms: teams watched together live, with a chat during games. See 20261104120000_watch_rooms.sql.';

revoke all on public.rooms from anon, authenticated;
grant select, delete on public.rooms to authenticated;
grant insert (name, visibility), update (name, visibility) on public.rooms to authenticated;

-- ------------------------------------------------------------------- membership

-- Recreated in place (same function, new body and name) so the policies that use them
-- keep pointing at them.
create or replace function private.is_league_member(lid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.room_teams rt join public.teams t on t.id = rt.team_id
        where rt.room_id = lid and t.owner = (select auth.uid())
    );
$$;
alter function private.is_league_member(uuid) rename to is_room_member;

create or replace function private.is_league_admin(lid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (select 1 from public.rooms where id = lid and admin = (select auth.uid()));
$$;
alter function private.is_league_admin(uuid) rename to is_room_admin;

-- Who may look at a room: anyone signed in when it is public, otherwise its members and
-- its admin. Posting and bringing teams still take membership.
create function private.can_read_room(rid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (select 1 from public.rooms where id = rid and visibility = 'public')
        or private.is_room_member(rid) or private.is_room_admin(rid);
$$;
revoke execute on function private.can_read_room(uuid) from public, anon;
grant execute on function private.can_read_room(uuid) to authenticated;

drop policy "leagues: members and admin read" on public.rooms;
create policy "rooms: readable" on public.rooms
    for select to authenticated
    using (visibility = 'public' or admin = (select auth.uid()) or private.is_room_member(id));
alter policy "leagues: create as admin" on public.rooms rename to "rooms: create as admin";
alter policy "leagues: admin renames" on public.rooms rename to "rooms: admin edits";
alter policy "leagues: admin deletes" on public.rooms rename to "rooms: admin closes";

drop policy "league_teams: members read" on public.room_teams;
create policy "room_teams: readable with the room" on public.room_teams
    for select to authenticated
    using (private.can_read_room(room_id));
alter policy "league_teams: owner leaves, admin removes" on public.room_teams
    rename to "room_teams: owner leaves, admin removes";

-- ---------------------------------------------------------------------- fixtures

create table public.fixtures (
    season    int not null,
    game_code int not null,
    round     int not null,
    tipoff    timestamptz not null,
    primary key (season, game_code)
);
create index fixtures_tipoff_idx on public.fixtures (tipoff);
comment on table public.fixtures is
    'Every game''s tip-off, for the chat hours. Written by the data run (utils.rounds), read by everyone.';

alter table public.fixtures enable row level security;
create policy "fixtures: readable by all" on public.fixtures for select to anon, authenticated using (true);
revoke insert, update, delete on public.fixtures from anon, authenticated;

-- The chat session now or next: one game's [tip-off - 1h, tip-off + 3h], merged with
-- every window it overlaps. Null when no game is scheduled.
create function public.chat_window()
returns json
language sql stable set search_path = ''
as $$
    with w as (
        select tipoff - interval '1 hour' as s, tipoff + interval '3 hours' as e
        from public.fixtures
        where tipoff > now() - interval '3 days' and tipoff < now() + interval '60 days'
    ), m as (
        select s, e, case when s <= max(e) over (order by s rows between unbounded preceding and 1 preceding)
                          then 0 else 1 end as brk
        from w
    ), g as (
        select s, e, sum(brk) over (order by s) as grp from m
    ), islands as (
        select min(s) as s, max(e) as e from g group by grp
    )
    select json_build_object('open', s <= now(), 'opens_at', s, 'closes_at', e)
    from islands where e > now() order by s limit 1;
$$;

create function public.chat_open()
returns boolean
language sql stable set search_path = ''
as $$
    select exists (
        select 1 from public.fixtures
        where now() >= tipoff - interval '1 hour' and now() < tipoff + interval '3 hours'
    );
$$;

-- ---------------------------------------------------------------------- the chat

create table public.room_messages (
    id         bigint generated always as identity primary key,
    room_id    uuid not null references public.rooms (id) on delete cascade,
    author     uuid not null default auth.uid() references auth.users (id) on delete cascade,
    -- Copied from profiles when posted, so a live insert carries the name it shows.
    nickname   text not null,
    body       text not null check (char_length(btrim(body)) between 1 and 500),
    created_at timestamptz not null default now()
);
create index room_messages_room_idx on public.room_messages (room_id, created_at desc);
create index room_messages_author_idx on public.room_messages (author, created_at desc);

alter table public.room_messages enable row level security;
create policy "room_messages: readable with the room" on public.room_messages
    for select to authenticated
    using (private.can_read_room(room_id));
create policy "room_messages: author or admin deletes" on public.room_messages
    for delete to authenticated
    using (author = (select auth.uid()) or private.is_room_admin(room_id));
-- Posting goes through post_message(), which checks membership, the hours and the pace.
revoke all on public.room_messages from anon, authenticated;
grant select, delete on public.room_messages to authenticated;

alter publication supabase_realtime add table public.room_messages;

create function public.post_message(rid uuid, body text)
returns public.room_messages
language plpgsql security definer set search_path = ''
as $$
declare
    me uuid := (select auth.uid());
    msg public.room_messages;
begin
    if me is null then
        raise exception 'Sign in to chat' using errcode = '42501';
    end if;
    if not (private.is_room_member(rid) or private.is_room_admin(rid)) then
        raise exception 'Bring a team into this room to chat' using hint = 'not_member';
    end if;
    if not public.chat_open() then
        raise exception 'The chat opens an hour before tip-off' using hint = 'chat_closed';
    end if;
    perform pg_advisory_xact_lock(hashtext('chat:' || me::text));
    if exists (select 1 from public.room_messages
               where author = me and created_at > now() - interval '2 seconds') then
        raise exception 'Slow down a little' using hint = 'too_fast';
    end if;
    insert into public.room_messages (room_id, author, nickname, body)
    values (rid, me, coalesce((select nickname from public.profiles where user_id = me), 'Player'), btrim(body))
    returning * into msg;
    return msg;
end;
$$;

-- ------------------------------------------------------------------------- RPCs

-- 50 teams in a private room, 200 in a public one, 1,000 in the official room.
create function private.room_cap(r public.rooms)
returns int
language sql immutable set search_path = ''
as $$
    select case when r.official then 1000 when r.visibility = 'public' then 200 else 50 end;
$$;

-- One room as a list row: what the directory and an invite link show.
create function private.room_card(r public.rooms)
returns json
language sql stable security definer set search_path = ''
as $$
    select json_build_object(
        'id', r.id,
        'name', r.name,
        'visibility', r.visibility,
        'official', r.official,
        'admin', coalesce((select nickname from public.profiles where user_id = r.admin), 'Admin'),
        'is_admin', r.admin = (select auth.uid()),
        'teams', (select count(*) from public.room_teams where room_id = r.id),
        'cap', private.room_cap(r),
        'my_teams', coalesce((
            select json_agg(rt.team_id) from public.room_teams rt
            join public.teams t on t.id = rt.team_id
            where rt.room_id = r.id and t.owner = (select auth.uid())
        ), '[]'::json)
    );
$$;

create function public.create_room(name text, visibility text default 'private')
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
    rid uuid;
begin
    insert into public.rooms (name, visibility) values (btrim(name), visibility) returning id into rid;
    return rid;
end;
$$;

-- Rooms I am in or run, newest first.
create function public.my_rooms()
returns json
language sql stable security definer set search_path = ''
as $$
    select coalesce(json_agg(private.room_card(r) order by r.created_at desc), '[]'::json)
    from public.rooms r
    where r.admin = (select auth.uid()) or private.is_room_member(r.id);
$$;

-- The public directory: the official room first, then the busiest.
create function public.public_rooms(search text default null)
returns json
language sql stable security definer set search_path = ''
as $$
    select coalesce(json_agg(c.card order by c.official desc, c.teams desc, c.created_at desc), '[]'::json)
    from (
        select private.room_card(r) as card, r.official, r.created_at,
               (select count(*) from public.room_teams where room_id = r.id) as teams
        from public.rooms r
        where r.visibility = 'public'
          and (search is null or btrim(search) = '' or r.name ilike '%' || btrim(search) || '%')
        order by r.official desc, teams desc, r.created_at desc
        limit 50
    ) c;
$$;

-- What a private room's invite link shows before joining.
create function public.room_preview(code text)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
    r public.rooms;
begin
    if (select auth.uid()) is null then
        raise exception 'Sign in to see this room' using errcode = '42501';
    end if;
    select * into r from public.rooms where invite_code = code;
    if r.id is null then
        return null;
    end if;
    return private.room_card(r);
end;
$$;

-- Bring one or more of your teams into a room: a public room by its id, a private one
-- only with its invite code.
create function public.join_room(rid uuid, code text, team_ids uuid[])
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    r public.rooms;
    fresh uuid[];
begin
    if (select auth.uid()) is null then
        raise exception 'Sign in to join a room' using errcode = '42501';
    end if;
    if rid is not null then
        select * into r from public.rooms where id = rid;
    else
        select * into r from public.rooms where invite_code = code;
    end if;
    if r.id is null or (r.visibility = 'private' and r.invite_code is distinct from code
                        and r.admin <> (select auth.uid())) then
        raise exception 'This invite link is no longer valid' using hint = 'bad_invite';
    end if;
    if coalesce(cardinality(team_ids), 0) = 0 then
        raise exception 'Pick a team to bring' using hint = 'no_team';
    end if;
    if exists (select 1 from unnest(team_ids) as u(id)
               where not exists (select 1 from public.teams t where t.id = u.id and t.owner = (select auth.uid()))) then
        raise exception 'Not your team' using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(hashtext('room:' || r.id::text));
    select coalesce(array_agg(distinct u.id), '{}') into fresh
    from unnest(team_ids) as u(id)
    where not exists (select 1 from public.room_teams where room_id = r.id and team_id = u.id);
    if (select count(*) from public.room_teams where room_id = r.id) + cardinality(fresh) > private.room_cap(r) then
        raise exception 'This room is full (% teams)', private.room_cap(r) using hint = 'room_full';
    end if;
    insert into public.room_teams (room_id, team_id) select r.id, unnest(fresh);
    return r.id;
end;
$$;

-- The room's board for the latest round that has started (or nothing before the
-- season's first): names always, lineups only as saved at that round's lock.
create function public.room_board(rid uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
    r public.rooms;
    rnd public.rounds;
    nxt public.rounds;
    me uuid := (select auth.uid());
begin
    select * into r from public.rooms where id = rid;
    if r.id is null or not private.can_read_room(rid) then
        raise exception 'Room not found' using hint = 'not_found';
    end if;

    select * into rnd from public.rounds where lock_at <= now() order by lock_at desc limit 1;
    select * into nxt from public.rounds where lock_at > now() order by lock_at limit 1;

    return json_build_object(
        'id', r.id,
        'name', r.name,
        'visibility', r.visibility,
        'official', r.official,
        'admin', coalesce((select nickname from public.profiles where user_id = r.admin), 'Admin'),
        'is_admin', r.admin = me,
        'is_member', private.is_room_member(rid),
        'invite_code', case when r.admin = me or private.is_room_member(rid) then r.invite_code end,
        'cap', private.room_cap(r),
        'chat', public.chat_window(),
        'round', case when rnd.round is null then null else json_build_object(
            'season', rnd.season, 'round', rnd.round, 'lock_at', rnd.lock_at, 'unlock_at', rnd.unlock_at,
            'locked', now() < rnd.unlock_at) end,
        'next_lock', nxt.lock_at,
        'teams', coalesce((
            select json_agg(json_build_object(
                'team_id', t.id,
                'name', t.name,
                'nickname', coalesce(p.nickname, 'Player'),
                'mine', t.owner = me,
                'joined_at', rt.joined_at,
                'lineup', tr.lineup
            ) order by rt.joined_at)
            from public.room_teams rt
            join public.teams t on t.id = rt.team_id
            left join public.profiles p on p.user_id = t.owner
            left join public.team_rounds tr
                   on tr.team_id = t.id and tr.season = rnd.season and tr.round = rnd.round
            where rt.room_id = rid
        ), '[]'::json)
    );
end;
$$;

create or replace function public.reset_invite(lid uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
    code text := substr(md5(gen_random_uuid()::text), 1, 10);
begin
    update public.rooms set invite_code = code
        where id = lid and admin = (select auth.uid());
    if not found then
        raise exception 'Only the room admin can reset the link' using errcode = '42501';
    end if;
    return code;
end;
$$;

revoke execute on function private.room_card(public.rooms), private.room_cap(public.rooms) from public, anon;
grant execute on function private.room_card(public.rooms), private.room_cap(public.rooms) to authenticated;

revoke execute on function public.create_room(text, text), public.my_rooms(), public.public_rooms(text),
    public.room_preview(text), public.join_room(uuid, text, uuid[]), public.room_board(uuid),
    public.post_message(uuid, text) from public, anon;
grant execute on function public.create_room(text, text), public.my_rooms(), public.public_rooms(text),
    public.room_preview(text), public.join_room(uuid, text, uuid[]), public.room_board(uuid),
    public.post_message(uuid, text) to authenticated;
grant execute on function public.chat_window(), public.chat_open() to anon, authenticated;
