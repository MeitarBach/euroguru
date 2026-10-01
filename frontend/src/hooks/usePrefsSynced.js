import { useEffect, useRef } from 'react';
import { PREFS_SYNCED_EVENT } from '../lib/prefs';

/**
 * Run `reload` whenever an account's settings have just been copied onto this device.
 *
 * Views read their settings from localStorage once, on mount; signing in while one is
 * open would otherwise leave it showing this device's settings until the next visit.
 */
export default function usePrefsSynced(reload) {
    const latest = useRef(reload);
    useEffect(() => { latest.current = reload; });
    useEffect(() => {
        const handler = () => latest.current();
        window.addEventListener(PREFS_SYNCED_EVENT, handler);
        return () => window.removeEventListener(PREFS_SYNCED_EVENT, handler);
    }, []);
}
