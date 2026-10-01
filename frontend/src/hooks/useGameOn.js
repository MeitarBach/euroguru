import { useEffect, useState } from 'react';
import { loadSchedule } from '../lib/live/schedule';
import { CURRENT_SEASON } from '../seasons';

// A game is taken to be on from tip-off until this long after it. Only the navigation
// marker uses this; the Live tab itself reads the real game state.
const GAME_SPAN_MS = 2.25 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60_000;

/**
 * Whether a Euroleague game is being played right now, from the schedule alone.
 *
 * Drives the pulse on the Live tab in the navigation. Costs one request a session - the
 * schedule is shared with the Live tab and cached by the browser for two hours - and
 * never touches the live feed.
 */
export default function useGameOn() {
    const [on, setOn] = useState(false);
    useEffect(() => {
        let alive = true;
        let games = [];
        const check = () => {
            const now = Date.now();
            if (alive) setOn(games.some(g => g.tipoff <= now && now - g.tipoff < GAME_SPAN_MS));
        };
        loadSchedule(`E${CURRENT_SEASON}`)
            .then(all => { games = all; check(); })
            .catch(() => { /* no marker - the tab still works */ });
        const id = setInterval(check, CHECK_EVERY_MS);
        return () => { alive = false; clearInterval(id); };
    }, []);
    return on;
}
