import { useState, useCallback, useMemo } from 'react';
import { useGate } from './authContext';
import usePrefsSynced from './usePrefsSynced';
import { prefChanged } from '../lib/prefs';
import { FREE_WATCH_LIMIT } from '../lib/gate';

const STORAGE_KEY = 'euroguru.liveGroups';
// Which group is open is this device's business, so it is not synced.
const SELECTED_KEY = 'euroguru.liveGroupSelected';
const NAME_MAX = 24;

// Colours a group keeps for life: stored by index, so deleting one never repaints another.
export const GROUP_COLORS = ['#a78bfa', '#38bdf8', '#fbbf24', '#34d399', '#fb7185', '#22d3ee', '#f472b6', '#a3e635'];

const DEFAULT_GROUPS = [{ id: 'g-mine', name: 'My team', color: 0, keys: [], bench: [], captain: null }];

function load() {
    try {
        const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
        if (!Array.isArray(saved) || !saved.length) return DEFAULT_GROUPS;
        return saved
            .filter(g => g && typeof g.id === 'string' && Array.isArray(g.keys))
            .map(g => {
                const keys = g.keys.filter(k => typeof k === 'string');
                // Roles are per group (lib/live/rows.js says what each is worth): the
                // same player can captain your team and sit on a rival's bench.
                const bench = (Array.isArray(g.bench) ? g.bench : []).filter(k => keys.includes(k));
                const captain = keys.includes(g.captain) && !bench.includes(g.captain) ? g.captain : null;
                return {
                    id: g.id,
                    name: String(g.name ?? 'Group').slice(0, NAME_MAX),
                    color: Number.isInteger(g.color) ? g.color : 0,
                    keys,
                    bench,
                    captain,
                };
            });
    } catch {
        return DEFAULT_GROUPS;
    }
}

const loadSelected = () => {
    try {
        return window.localStorage.getItem(SELECTED_KEY);
    } catch {
        return null;
    }
};

const cleanName = (name, fallback) => String(name ?? '').trim().slice(0, NAME_MAX) || fallback;

/**
 * Named groups of players followed on the Live tab - "My team", and the teams of the
 * people in your league - each with its own total.
 *
 * A player may sit in several groups: fantasy rosters are not exclusive, so you and a
 * rival can both own Vezenkov. Stored like every other setting (localStorage, kept in
 * step with the account by lib/prefs.js), so the groups follow a signed-in user.
 *
 * Signed out, FREE_WATCH_LIMIT distinct players can be followed across all groups;
 * reaching for one more raises the sign-in modal instead.
 */
export default function useWatchGroups() {
    const [groups, setGroups] = useState(load);
    const [selectedId, setSelectedId] = useState(loadSelected);
    const { locked, unlock } = useGate();
    usePrefsSynced(() => setGroups(load()));

    const save = useCallback((next) => {
        setGroups(next);
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch { /* not fatal - the groups just will not survive a reload */ }
        prefChanged();
    }, []);

    const select = useCallback((id) => {
        setSelectedId(id);
        try {
            window.localStorage.setItem(SELECTED_KEY, id);
        } catch { /* falls back to the first group next time */ }
    }, []);

    const selected = groups.find(g => g.id === selectedId) ?? groups[0];
    const allKeys = useMemo(() => [...new Set(groups.flatMap(g => g.keys))], [groups]);
    const atLimit = locked && allKeys.length >= FREE_WATCH_LIMIT;

    const add = useCallback((groupId, key) => {
        const group = groups.find(g => g.id === groupId);
        if (!group || group.keys.includes(key)) return true;
        // Already followed through another group: no new player, so no new limit.
        if (atLimit && !allKeys.includes(key)) {
            unlock(`Watch more than ${FREE_WATCH_LIMIT} players`);
            return false;
        }
        save(groups.map(g => (g.id === groupId ? { ...g, keys: [...g.keys, key] } : g)));
        return true;
    }, [groups, allKeys, atLimit, unlock, save]);

    const remove = useCallback((groupId, key) => {
        save(groups.map(g => (g.id === groupId
            ? {
                ...g,
                keys: g.keys.filter(k => k !== key),
                bench: g.bench.filter(k => k !== key),
                captain: g.captain === key ? null : g.captain,
            }
            : g)));
    }, [groups, save]);

    // Benching the captain takes the armband off: a captain is always a starter.
    const toggleBench = useCallback((groupId, key) => {
        save(groups.map(g => {
            if (g.id !== groupId || !g.keys.includes(key)) return g;
            if (g.bench.includes(key)) return { ...g, bench: g.bench.filter(k => k !== key) };
            return { ...g, bench: [...g.bench, key], captain: g.captain === key ? null : g.captain };
        }));
    }, [groups, save]);

    // One captain per group: naming one replaces the last, naming the same one again
    // clears it, and a benched player made captain comes off the bench.
    const toggleCaptain = useCallback((groupId, key) => {
        save(groups.map(g => {
            if (g.id !== groupId || !g.keys.includes(key)) return g;
            if (g.captain === key) return { ...g, captain: null };
            return { ...g, captain: key, bench: g.bench.filter(k => k !== key) };
        }));
    }, [groups, save]);

    const toggle = useCallback((groupId, key) => {
        const group = groups.find(g => g.id === groupId);
        return group?.keys.includes(key) ? remove(groupId, key) : add(groupId, key);
    }, [groups, add, remove]);

    // `keys` seeds the group - a player picked in the game view goes straight in, subject
    // to the same free limit as any other add.
    const create = useCallback((name, keys = []) => {
        const used = new Set(groups.map(g => g.color));
        const color = GROUP_COLORS.findIndex((_, i) => !used.has(i));
        const fresh = keys.filter(k => !allKeys.includes(k));
        const allowed = locked ? Math.max(0, FREE_WATCH_LIMIT - allKeys.length) : Infinity;
        if (fresh.length > allowed) unlock(`Watch more than ${FREE_WATCH_LIMIT} players`);
        const group = {
            id: `g-${Date.now().toString(36)}`,
            name: cleanName(name, `Group ${groups.length + 1}`),
            color: color === -1 ? groups.length % GROUP_COLORS.length : color,
            keys: keys.filter(k => allKeys.includes(k) || fresh.indexOf(k) < allowed),
            bench: [],
            captain: null,
        };
        save([...groups, group]);
        select(group.id);
        return group.id;
    }, [groups, allKeys, locked, unlock, save, select]);

    const rename = useCallback((groupId, name) => {
        save(groups.map(g => (g.id === groupId ? { ...g, name: cleanName(name, g.name) } : g)));
    }, [groups, save]);

    // The last group cannot go: the page always has somewhere to put a player.
    const destroy = useCallback((groupId) => {
        if (groups.length < 2) return;
        save(groups.filter(g => g.id !== groupId));
    }, [groups, save]);

    return {
        groups, selected, select, allKeys,
        add, remove, toggle, toggleBench, toggleCaptain, create, rename, destroy,
        atLimit, limit: locked ? FREE_WATCH_LIMIT : null,
    };
}
