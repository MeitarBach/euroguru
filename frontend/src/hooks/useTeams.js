import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './authContext';
import {
    listTeams, createTeam, saveLineup, renameTeam, deleteTeam, cleanLineup,
    TEAM_LIMIT, STARTERS, BENCH, EMPTY_LINEUP,
} from '../lib/leagues';

const SELECTED_KEY = 'euroguru.liveTeamSelected';
const NAME_MAX = 24;
const isCoachKey = (key) => typeof key === 'string' && /^coach:\d+$/.test(key);
const cleanName = (name, fallback) => String(name ?? '').trim().slice(0, NAME_MAX) || fallback;

const loadSelected = () => {
    try {
        return window.localStorage.getItem(SELECTED_KEY);
    } catch {
        return null;
    }
};

const lineupOf = (team) => cleanLineup(team?.lineup ?? EMPTY_LINEUP);
const startersOf = (l) => l.keys.length - l.bench.length;

/**
 * Your fantasy teams, saved to your account: up to 5, each 5 starters (one captain),
 * 5 bench and a coach, frozen while a round is on.
 *
 * Shaped like useWatchGroups - groups, selected, add, remove, toggleBench,
 * toggleCaptain, toggleCoach, create, rename, destroy - so the Live tab's cards,
 * picker, box score and board work on a team exactly as on a watchlist. What differs:
 *   - a change is saved to Supabase; the screen updates at once and goes back if the
 *     database says no (a lock that started a second ago, a team deleted elsewhere);
 *   - a full team or a locked round refuses the change and says why through `notify`
 *     rather than failing silently;
 *   - the last team can be deleted: there is no "always somewhere to put a player".
 *
 * `lock` is useRoundLock's answer. Signed out there are no teams: `signedIn` is false
 * and every change is refused.
 */
export default function useTeams({ lock, notify } = {}) {
    const { user } = useAuth();
    const userId = user?.id ?? null;
    // The loaded list, tagged with whose it is, so a sign-out or a switch of account
    // never shows the previous person's teams for a moment.
    const [loaded, setLoaded] = useState({ userId: null, rows: [], status: 'idle' });
    const [version, setVersion] = useState(0);
    const [selectedId, setSelectedId] = useState(loadSelected);

    // Every change goes through apply(), which keeps `latest` current between renders:
    // two taps in quick succession must each see the other's result.
    const latest = useRef([]);
    const apply = useCallback((fn) => {
        latest.current = fn(latest.current);
        const rows = latest.current;
        setLoaded(prev => ({ ...prev, rows }));
    }, []);

    const notifyRef = useRef(notify);
    useEffect(() => { notifyRef.current = notify; }, [notify]);
    const say = useCallback((message) => notifyRef.current?.(message), []);

    useEffect(() => {
        if (!userId) return undefined;
        let alive = true;
        listTeams()
            .then(rows => {
                if (!alive) return;
                latest.current = rows ?? [];
                setLoaded({ userId, rows: latest.current, status: 'ready' });
            })
            .catch(() => { if (alive) setLoaded({ userId, rows: [], status: 'error' }); });
        return () => { alive = false; };
    }, [userId, version]);
    const reload = useCallback(() => setVersion(v => v + 1), []);

    const mine = loaded.userId === userId && userId !== null;
    const teams = useMemo(() => (mine ? loaded.rows : []), [mine, loaded.rows]);
    const status = !userId ? 'idle' : mine ? loaded.status : 'loading';

    const select = useCallback((id) => {
        setSelectedId(id);
        try {
            window.localStorage.setItem(SELECTED_KEY, id);
        } catch { /* falls back to the first team next time */ }
    }, []);

    const replace = useCallback((row) => apply(list => list.map(t => (t.id === row.id ? row : t))), [apply]);

    const locked = Boolean(lock?.locked);
    const lockedRound = lock?.round ?? null;

    // Applies `change` (lineup -> lineup, or null to refuse) to one team and saves it.
    const edit = useCallback((teamId, change) => {
        if (!userId) return false;
        const team = latest.current.find(t => t.id === teamId);
        if (!team) return false;
        if (locked) {
            say(`Lineups are locked for Round ${lockedRound}`);
            return false;
        }
        const next = change(lineupOf(team));
        if (!next) return false;
        replace({ ...team, lineup: cleanLineup(next) });
        saveLineup(teamId, next)
            .then(replace)
            .catch(e => {
                replace(team);
                say(e.hint === 'locked' ? 'Lineups just locked for this round' : `Couldn't save: ${e.message}`);
            });
        return true;
    }, [userId, locked, lockedRound, replace, say]);

    const add = useCallback((teamId, key) => edit(teamId, (l) => {
        if (l.keys.includes(key)) return l;
        if (startersOf(l) < STARTERS) return { ...l, keys: [...l.keys, key] };
        if (l.bench.length < BENCH) return { ...l, keys: [...l.keys, key], bench: [...l.bench, key] };
        say(`A team has ${STARTERS} starters and ${BENCH} on the bench - remove someone first`);
        return null;
    }), [edit, say]);

    const remove = useCallback((teamId, key) => edit(teamId, (l) => ({
        ...l,
        keys: l.keys.filter(k => k !== key),
        bench: l.bench.filter(k => k !== key),
        captain: l.captain === key ? null : l.captain,
    })), [edit]);

    // Benching the captain takes the armband off: a captain is always a starter.
    const toggleBench = useCallback((teamId, key) => edit(teamId, (l) => {
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
    }), [edit, say]);

    // One captain; naming the same one again clears it. A benched captain comes off the
    // bench, which needs a free starter's spot.
    const toggleCaptain = useCallback((teamId, key) => edit(teamId, (l) => {
        if (!l.keys.includes(key)) return null;
        if (l.captain === key) return { ...l, captain: null };
        if (l.bench.includes(key) && startersOf(l) >= STARTERS) {
            say(`${STARTERS} starters already - bench one to make room for the captain`);
            return null;
        }
        return { ...l, captain: key, bench: l.bench.filter(k => k !== key) };
    }), [edit, say]);

    // The sixth man is the first on the bench: move this bench player to the front.
    const makeSixth = useCallback((teamId, key) => edit(teamId, (l) => (
        l.bench.includes(key) ? { ...l, bench: [key, ...l.bench.filter(k => k !== key)] } : null
    )), [edit]);

    const toggle = useCallback((teamId, key) => {
        const team = latest.current.find(t => t.id === teamId);
        return lineupOf(team).keys.includes(key) ? remove(teamId, key) : add(teamId, key);
    }, [add, remove]);

    const toggleCoach = useCallback((teamId, key) => {
        if (!isCoachKey(key)) return false;
        return edit(teamId, (l) => ({ ...l, coach: l.coach === key ? null : key }));
    }, [edit]);

    // `keys` and `roles` seed the team, as with a watchlist; past the caps they are cut,
    // and while a round is locked the team starts empty (the database allows nothing else).
    const create = useCallback((name, keys = [], roles = {}) => {
        if (!userId) return null;
        if (latest.current.length >= TEAM_LIMIT) {
            say(`You can have up to ${TEAM_LIMIT} teams`);
            return null;
        }
        let lineup = EMPTY_LINEUP;
        if (keys.length || roles.coach) {
            if (locked) {
                say(`Lineups are locked for Round ${lockedRound} - the team starts empty`);
            } else {
                const bench = (roles.bench ?? []).filter(k => keys.includes(k)).slice(0, BENCH);
                const starters = keys.filter(k => !bench.includes(k)).slice(0, STARTERS);
                if (starters.length + bench.length < keys.length) say(`Kept ${STARTERS} starters and ${BENCH} on the bench`);
                lineup = { keys: [...starters, ...bench], bench, captain: roles.captain ?? null, coach: roles.coach ?? null };
            }
        }
        createTeam(cleanName(name, `Team ${latest.current.length + 1}`), lineup)
            .then(row => { apply(list => [...list, row]); select(row.id); })
            .catch(e => say(e.hint === 'team_cap'
                ? `You can have up to ${TEAM_LIMIT} teams`
                : `Couldn't create the team: ${e.message}`));
        return null;
    }, [userId, locked, lockedRound, apply, select, say]);

    const rename = useCallback((teamId, name) => {
        const team = latest.current.find(t => t.id === teamId);
        if (!team) return;
        const next = cleanName(name, team.name);
        replace({ ...team, name: next });
        renameTeam(teamId, next).then(replace).catch(e => { replace(team); say(`Couldn't rename: ${e.message}`); });
    }, [replace, say]);

    const destroy = useCallback((teamId) => {
        const before = latest.current;
        apply(list => list.filter(t => t.id !== teamId));
        deleteTeam(teamId).catch(e => { apply(() => before); say(`Couldn't delete: ${e.message}`); });
    }, [apply, say]);

    // The same shape a watchlist group has, so everything downstream reads both.
    const groups = useMemo(() => teams.map((t, i) => {
        const l = lineupOf(t);
        return { id: t.id, name: t.name, color: i, keys: l.keys, bench: l.bench, captain: l.captain, coach: l.coach };
    }), [teams]);
    const selected = groups.find(g => g.id === selectedId) ?? groups[0] ?? null;
    const allKeys = useMemo(() => [...new Set(groups.flatMap(g => g.keys))], [groups]);

    return {
        kind: 'teams',
        signedIn: Boolean(userId),
        status,
        reload,
        groups, selected, select, allKeys,
        add, remove, toggle, toggleBench, toggleCaptain, toggleCoach, makeSixth, create, rename, destroy,
        atLimit: false,
        limit: null,
        full: teams.length >= TEAM_LIMIT,
        lock,
    };
}
