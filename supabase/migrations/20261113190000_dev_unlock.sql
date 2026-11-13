-- A dev key that lifts the round lock - for the local app only.
--
-- While a round is on, teams_guard allows subs and the armband only (no transfers, and
-- nobody whose game has started moves up). Dev and prod share this database, so lifting
-- that for local testing can't be a switch: it would lift it on the live site too.
-- Instead a request that carries a known key in the `x-euroguru-unlock` header skips the
-- in-round rules. The local app sends it when VITE_DEV_UNLOCK is set in
-- frontend/.env.development.local (gitignored, and read by `vite` dev only - never by a
-- build); the live site never has it.
--
-- Only the key's sha256 is kept here, in private.dev_unlock (not exposed by the API).
-- Add a key:    insert into private.dev_unlock (token_hash, note) values ('<sha256 hex>', 'who/where');
-- Revoke keys:  delete from private.dev_unlock;
--
-- Row security still applies - a key only ever opens the holder's own teams - and so do
-- the 5-team cap and everything else. A change made with it while a round is on is still
-- copied into that round's team_rounds row (teams_round_lineup), so it counts for the
-- round like any sub.

create table private.dev_unlock (
    token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
    note       text,
    created_at timestamptz not null default now()
);
comment on table private.dev_unlock is
    'sha256 (hex) of the keys that lift the round lock for the local app - see private.dev_unlocked().';
alter table private.dev_unlock enable row level security;
revoke all on private.dev_unlock from public, anon, authenticated;

-- Whether this request carries a dev key. Outside an API request (no request.headers)
-- it is false.
create function private.dev_unlocked()
returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from private.dev_unlock d
        where d.token_hash = encode(pg_catalog.sha256(convert_to(
            nullif(current_setting('request.headers', true), '')::json ->> 'x-euroguru-unlock', 'UTF8')), 'hex')
    );
$$;
revoke execute on function private.dev_unlocked() from public, anon;
grant execute on function private.dev_unlocked() to authenticated;

create or replace function public.teams_guard()
returns trigger
language plpgsql set search_path = ''
as $$
declare
    win record;
    moved text;
begin
    select * into win from public.locked_round();
    -- A dev key lifts the round's rules (above); nothing else.
    if win.round is not null and private.dev_unlocked() then
        win.round := null;
    end if;

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
