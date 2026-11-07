import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './authContext';
import {
    listTeams, createTeam, saveLineup, renameTeam, deleteTeam, cleanLineup, lineupOps,
    TEAM_LIMIT, STARTERS, BENCH, EMPTY_LINEUP,
} from '../lib/teams';

const SELECTED_KEY = 'euroguru.liveTeamSelected';
const NAME_MAX = 24;
const cleanName = (name, fallback) => String(name ?? '').trim().slice(0, NAME_MAX) || fallback;

const loadSelected = () => {
    try {
        return window.localStorage.getItem(SELECTED_KEY);
    } catch {
        return null;
    }
};

const lineupOf = (team) => cleanLineup(team?.lineup ?? EMPTY_LINEUP);

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

    // The rules are lib/teams.js's lineupOps; each refuses with a reason through `say`.
    const change = useCallback((op) => (teamId, key, arg) => edit(teamId, (l) => lineupOps(say)[op](l, key, arg)), [edit, say]);
    const add = useMemo(() => change('add'), [change]);
    const remove = useMemo(() => change('remove'), [change]);
    const toggle = useMemo(() => change('toggle'), [change]);
    const toggleBench = useMemo(() => change('toggleBench'), [change]);
    const toggleCaptain = useMemo(() => change('toggleCaptain'), [change]);
    const makeSixth = useMemo(() => change('makeSixth'), [change]);
    const toggleCoach = useMemo(() => change('toggleCoach'), [change]);
    const swap = useMemo(() => change('swap'), [change]);
    const addAs = useMemo(() => change('addAs'), [change]);

    // `keys` and `roles` seed the team, as with a watchlist; past the caps they are cut,
    // and while a round is locked the team starts empty (the database allows nothing else).
    // Resolves to the new team's id, or null.
    const create = useCallback(async (name, keys = [], roles = {}) => {
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
        try {
            const row = await createTeam(cleanName(name, `Team ${latest.current.length + 1}`), lineup);
            apply(list => [...list, row]);
            select(row.id);
            return row.id;
        } catch (e) {
            say(e.hint === 'team_cap' ? `You can have up to ${TEAM_LIMIT} teams` : `Couldn't create the team: ${e.message}`);
            return null;
        }
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
        add, addAs, remove, toggle, swap, toggleBench, toggleCaptain, toggleCoach, makeSixth, create, rename, destroy,
        atLimit: false,
        limit: null,
        full: teams.length >= TEAM_LIMIT,
        lock,
    };
}
