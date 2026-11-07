import { db, run } from './db';

/**
 * Teams, round locks and profiles, stored in Supabase.
 *
 * The rules live in the database (supabase/migrations/*_teams_and_leagues.sql): row
 * security keeps a team private to its owner and a trigger refuses lineup changes while
 * a round is on. This module is the thin client for it, plus the lineup rules the UI
 * applies before asking (lineupOps). Every request throws on failure - see run().
 *
 * Watch Rooms, where teams are watched together, are in lib/rooms.js.
 */

export const TEAM_LIMIT = 5;
export const STARTERS = 5;
export const BENCH = 5;
// `bench` is ordered: its first player is the sixth man, who counts in full (the rest
// half) - see ROLE_FACTOR in lib/live/rows.js.
export const EMPTY_LINEUP = Object.freeze({ keys: [], bench: [], captain: null, coach: null });

const TEAM_COLUMNS = 'id, name, lineup, share_slug, created_at';

/** A lineup in the shape the database accepts: known keys only, roles kept consistent. */
export function cleanLineup(lineup = EMPTY_LINEUP) {
    const keys = [...new Set((lineup.keys ?? []).filter(k => typeof k === 'string' && /^id:\d+$/.test(k)))];
    const bench = [...new Set((lineup.bench ?? []).filter(k => keys.includes(k)))];
    const captain = keys.includes(lineup.captain) && !bench.includes(lineup.captain) ? lineup.captain : null;
    const coach = typeof lineup.coach === 'string' && /^coach:\d+$/.test(lineup.coach) ? lineup.coach : null;
    return { keys, bench, captain, coach };
}

const startersOf = (l) => l.keys.length - l.bench.length;
export const isCoachKey = (key) => typeof key === 'string' && /^coach:\d+$/.test(key);

/**
 * The lineup rules, as pure changes: each takes a lineup and returns the next one, or
 * null to refuse - after saying why through `say`. Used by saved teams (useTeams) and
 * by My Teams' signed-out draft alike.
 */
export function lineupOps(say = () => {}) {
    const add = (l, key) => {
        if (l.keys.includes(key)) return l;
        if (startersOf(l) < STARTERS) return { ...l, keys: [...l.keys, key] };
        if (l.bench.length < BENCH) return { ...l, keys: [...l.keys, key], bench: [...l.bench, key] };
        say(`A team has ${STARTERS} starters and ${BENCH} on the bench - remove someone first`);
        return null;
    };
    const remove = (l, key) => ({
        ...l,
        keys: l.keys.filter(k => k !== key),
        bench: l.bench.filter(k => k !== key),
        captain: l.captain === key ? null : l.captain,
    });
    return {
        add,
        // Add for a chosen spot - the starting five or the bench - falling back to the
        // other when that one is full.
        addAs: (l, key, where) => {
            if (where === 'bench' && !l.keys.includes(key) && l.bench.length < BENCH) {
                return { ...l, keys: [...l.keys, key], bench: [...l.bench, key] };
            }
            return add(l, key);
        },
        remove,
        // Two players trade places: a starter and a bench player swap roles (the
        // incoming starter takes over the armband if the captain goes to the bench), and
        // two bench players swap order - which is how the sixth man changes.
        swap: (l, a, b) => {
            if (a === b || !l.keys.includes(a) || !l.keys.includes(b)) return null;
            const aBench = l.bench.includes(a);
            const bBench = l.bench.includes(b);
            if (aBench && bBench) return { ...l, bench: l.bench.map(k => (k === a ? b : k === b ? a : k)) };
            if (!aBench && !bBench) return null; // two starters: nothing changes
            const [starter, benched] = aBench ? [b, a] : [a, b];
            return {
                ...l,
                bench: l.bench.map(k => (k === benched ? starter : k)),
                captain: l.captain === starter ? benched : l.captain,
            };
        },
        toggle: (l, key) => (l.keys.includes(key) ? remove(l, key) : add(l, key)),
        // Benching the captain takes the armband off: a captain is always a starter.
        toggleBench: (l, key) => {
            if (!l.keys.includes(key)) return null;
            if (l.bench.includes(key)) {
                if (startersOf(l) >= STARTERS) {
                    say(`${STARTERS} starters already - bench one of them first`);
                    return null;
                }
                return { ...l, bench: l.bench.filter(k => k !== key) };
            }
            if (l.bench.length >= BENCH) {
                say(`The bench is full (${BENCH})`);
                return null;
            }
            return { ...l, bench: [...l.bench, key], captain: l.captain === key ? null : l.captain };
        },
        // One captain; naming the same one again clears it. A benched captain comes off
        // the bench, which needs a free starter's spot.
        toggleCaptain: (l, key) => {
            if (!l.keys.includes(key)) return null;
            if (l.captain === key) return { ...l, captain: null };
            if (l.bench.includes(key) && startersOf(l) >= STARTERS) {
                say(`${STARTERS} starters already - bench one to make room for the captain`);
                return null;
            }
            return { ...l, captain: key, bench: l.bench.filter(k => k !== key) };
        },
        // The sixth man is the first on the bench: move this bench player to the front.
        makeSixth: (l, key) => (l.bench.includes(key) ? { ...l, bench: [key, ...l.bench.filter(k => k !== key)] } : null),
        toggleCoach: (l, key) => (isCoachKey(key) ? { ...l, coach: l.coach === key ? null : key } : null),
    };
}

// ---------------------------------------------------------------------------- teams

export const listTeams = () =>
    run(db.from('teams').select(TEAM_COLUMNS).order('created_at'));

export const createTeam = (name, lineup = EMPTY_LINEUP) =>
    run(db.from('teams').insert({ name, lineup: cleanLineup(lineup) }).select(TEAM_COLUMNS).single());

export const saveLineup = (id, lineup) =>
    run(db.from('teams').update({ lineup: cleanLineup(lineup) }).eq('id', id).select(TEAM_COLUMNS).single());

export const renameTeam = (id, name) =>
    run(db.from('teams').update({ name }).eq('id', id).select(TEAM_COLUMNS).single());

export const deleteTeam = (id) => run(db.from('teams').delete().eq('id', id));

// --------------------------------------------------------------------------- rounds

/** Every round's lock window for a season, oldest first. Readable signed out. */
export const listRounds = (season) =>
    run(db.from('rounds').select('round, lock_at, unlock_at').eq('season', Number(season)).order('round'));

// ------------------------------------------------------------------------- profiles

export async function getNickname(userId) {
    const rows = await run(db.from('profiles').select('nickname').eq('user_id', userId));
    return rows?.[0]?.nickname ?? null;
}

export const saveNickname = (userId, nickname) =>
    run(db.from('profiles')
        .upsert({ user_id: userId, nickname, updated_at: new Date().toISOString() })
        .select('nickname').single());
