import { useState, useCallback } from 'react';
import { useGate } from './authContext';
import usePrefsSynced from './usePrefsSynced';
import { prefChanged } from '../lib/prefs';
import { FREE_WATCH_LIMIT } from '../lib/gate';

const STORAGE_KEY = 'euroguru.liveWatchlist';

const load = () => {
    try {
        const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(saved) ? saved.filter(k => typeof k === 'string') : [];
    } catch {
        return [];
    }
};

/**
 * The players followed on the Live tab, as PlayerKeys ("id:3791").
 *
 * Keys rather than names: a name can gain a disambiguating "(PAR)" when a namesake is
 * priced, the key never changes. Stored like every other setting - localStorage, kept
 * in step with the account by lib/prefs.js - so the list follows a signed-in user.
 *
 * Signed out, the list holds FREE_WATCH_LIMIT players; reaching for one more raises
 * the sign-in modal instead.
 */
export default function useWatchlist() {
    const [keys, setKeys] = useState(load);
    const { locked, unlock } = useGate();
    usePrefsSynced(() => setKeys(load()));

    const save = useCallback((next) => {
        setKeys(next);
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch { /* not fatal - the list just will not survive a reload */ }
        prefChanged();
    }, []);

    const atLimit = locked && keys.length >= FREE_WATCH_LIMIT;

    const add = useCallback((key) => {
        if (keys.includes(key)) return true;
        if (atLimit) {
            unlock(`Watch more than ${FREE_WATCH_LIMIT} players`);
            return false;
        }
        save([...keys, key]);
        return true;
    }, [keys, atLimit, unlock, save]);

    const remove = useCallback((key) => save(keys.filter(k => k !== key)), [keys, save]);

    const toggle = useCallback(
        (key) => (keys.includes(key) ? remove(key) : add(key)),
        [keys, add, remove],
    );

    return { keys, add, remove, toggle, atLimit, limit: locked ? FREE_WATCH_LIMIT : null };
}
