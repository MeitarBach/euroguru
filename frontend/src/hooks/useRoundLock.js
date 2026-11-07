import { useEffect, useMemo, useState } from 'react';
import { listRounds } from '../lib/teams';
import { db } from '../lib/db';

/**
 * Whether teams' lineups are locked right now, and until when.
 *
 * A lineup freezes at a round's first tip-off and opens again three hours after its
 * last one; the windows come from Supabase's `rounds` table (filled from the schedule
 * by the data run). The database refuses a locked edit on its own - this is what lets
 * the UI say so before anyone tries.
 *
 * Returns { ready, locked, round, until, nextRound, nextLock }:
 *   locked - the window is open now; `round` is the round and `until` when it opens again
 *   unlocked - `nextRound` / `nextLock` say when the next one starts (null after the last)
 * Times are epoch milliseconds.
 */
export default function useRoundLock(season, now) {
    const [rounds, setRounds] = useState(null);

    useEffect(() => {
        if (!db) return undefined;
        let alive = true;
        listRounds(season)
            .then(rows => { if (alive) setRounds(rows.map(r => ({
                round: r.round, lockAt: Date.parse(r.lock_at), unlockAt: Date.parse(r.unlock_at),
            }))); })
            .catch(() => { if (alive) setRounds([]); });
        return () => { alive = false; };
    }, [season]);

    return useMemo(() => {
        if (!rounds) return { ready: false, locked: false, round: null, until: null, nextRound: null, nextLock: null };
        const open = rounds.find(r => now >= r.lockAt && now < r.unlockAt);
        const next = rounds.find(r => r.lockAt > now);
        return {
            ready: true,
            locked: Boolean(open),
            round: open?.round ?? null,
            until: open?.unlockAt ?? null,
            nextRound: next?.round ?? null,
            nextLock: next?.lockAt ?? null,
        };
    }, [rounds, now]);
}
