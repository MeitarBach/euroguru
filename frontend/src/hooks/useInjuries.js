import { useEffect, useState } from 'react';
import { fetchInjuries } from '../services/api';

/**
 * The current injury report as a lookup: PlayerName -> {InjuryStatus, Injury}.
 *
 * For the injured badge on views whose player data does not carry a status of its own
 * (the price tracker, the matchups, the live feed...). One request per page load,
 * shared by every badge on the page: the report changes once a day.
 */
const EMPTY = {};
let report = null;
let loading = null;
const listeners = new Set();

function load() {
    if (!loading) {
        loading = fetchInjuries()
            .then(res => { report = res?.players ?? {}; })
            .catch(() => { report = {}; })
            .finally(() => listeners.forEach(fn => fn()));
    }
    return loading;
}

export default function useInjuries() {
    const [, rerender] = useState(0);
    useEffect(() => {
        if (report) return undefined;
        const fn = () => rerender(n => n + 1);
        listeners.add(fn);
        load();
        return () => { listeners.delete(fn); };
    }, []);
    return report ?? EMPTY;
}
