-- Subs during a round.
--
-- Until now a lineup froze outright from a round's first tip-off. Now, while a round is
-- on, a team keeps its players and coach (no transfers) but can still be rearranged:
-- swap a starter and a bench player, change the sixth man, move the armband. One rule
-- keeps that fair - a player whose game has tipped off can only move down, never up:
--   captain (x2) > starter > sixth man (x1) > the rest of the bench (x0.5)
-- So a bench player who already scored 30 can't be brought in after the fact, but a
-- starter who already played can still be benched for one whose game is still to come.
--
-- A round now scores its final lineup, not the one it locked with: every change made
-- inside the window is copied into that round's team_rounds row as it is saved, so the
-- Live tab's look back and the Watch Room boards read the lineup that counted.
--
-- To know when a player's game starts, the database now keeps each fixture's two clubs
-- and each priced player's club - both written by the data run (backend/utils/rounds.py)
-- next to the rounds and tip-offs it already writes.

-- ---------------------------------------------------------------------- fixtures

alter table public.fixtures add column home text, add column away text;
comment on column public.fixtures.home is 'Euroleague club code (the schedule''s homecode).';
comment on column public.fixtures.away is 'Euroleague club code (the schedule''s awaycode).';

-- ------------------------------------------------------------------ player_clubs

create table public.player_clubs (
    season     int not null,
    player_key text not null check (player_key ~ '^id:\d+$'),
    club       text not null,
    primary key (season, player_key)
);
comment on table public.player_clubs is
    'Each priced player''s current club (Euroleague code), keyed like a lineup. Written by the data run.';

alter table public.player_clubs enable row level security;
create policy "player_clubs: readable by all" on public.player_clubs for select to anon, authenticated using (true);
revoke insert, update, delete on public.player_clubs from anon, authenticated;

-- ---------------------------------------------------------------- the lineup rule

-- A player's place in a lineup: 3 captain, 2 starter, 1 sixth man, 0 the rest of the
-- bench. Only called with a key the lineup holds.
create function public.lineup_rank(lineup jsonb, player text)
returns int
language sql immutable set search_path = ''
as $$
    select case
        when lineup ->> 'captain' = player then 3
        when not (lineup -> 'bench') ? player then 2
        when lineup -> 'bench' ->> 0 = player then 1
        else 0
    end;
$$;

-- When a player's game in a round tips off: his club's fixture that round. Null when the
-- database doesn't know (no club on file, or fixtures written before they carried clubs);
-- the client applies the same rule from the live schedule, so null lets the change through.
create function public.round_tipoff(season int, round int, player text)
returns timestamptz
language sql stable set search_path = ''
as $$
    select min(f.tipoff)
    from public.player_clubs pc
    join public.fixtures f
      on f.season = pc.season and f.round = round_tipoff.round and pc.club in (f.home, f.away)
    where pc.season = round_tipoff.season and pc.player_key = round_tipoff.player;
$$;

create or replace function public.teams_guard()
returns trigger
language plpgsql set search_path = ''
as $$
declare
    win record;
    moved text;
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
        -- During a round: the same players and coach, only rearranged.
        if (new.lineup ->> 'coach') is distinct from (old.lineup ->> 'coach')
           or (select array_agg(k order by k) from jsonb_array_elements_text(new.lineup -> 'keys') as e(k))
              is distinct from
              (select array_agg(k order by k) from jsonb_array_elements_text(old.lineup -> 'keys') as e(k)) then
            raise exception 'No transfers while Round % is on - subs and the captain only, until %', win.round, win.unlock_at
                using hint = 'locked';
        end if;
        -- Nobody whose game has started moves up.
        select e.k into moved
        from jsonb_array_elements_text(new.lineup -> 'keys') as e(k)
        where public.lineup_rank(new.lineup, e.k) > public.lineup_rank(old.lineup, e.k)
          and public.round_tipoff(win.season, win.round, e.k) <= now()
        limit 1;
        if moved is not null then
            raise exception 'A player whose game has started can only move down the lineup (%)', moved
                using hint = 'played';
        end if;
    end if;

    new.updated_at := now();
    return new;
end;
$$;

-- --------------------------------------------------------- the lineup that counted

-- A change made inside a round's window is the round's lineup from then on. The
-- snapshot job still makes the row at the lock (and leaves it alone after); this keeps
-- it current - and makes it, if a sub lands in the minute before the job runs.
create function public.teams_round_lineup()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
    win record;
begin
    select * into win from public.locked_round();
    if win.round is not null then
        insert into public.team_rounds (team_id, season, round, lineup, locked_at)
        values (new.id, win.season, win.round, new.lineup, win.lock_at)
        on conflict (team_id, season, round) do update set lineup = excluded.lineup;
    end if;
    return null;
end;
$$;
revoke execute on function public.teams_round_lineup() from public, anon, authenticated;

create trigger teams_round_lineup after update of lineup on public.teams
    for each row when (new.lineup is distinct from old.lineup)
    execute function public.teams_round_lineup();
