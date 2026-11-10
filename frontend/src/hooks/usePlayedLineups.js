import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { listPlayedLineups, cleanLineup } from '../lib/teams';

const NONE = {};

/**
 * The lineups your teams played `round` with, by team id: { [teamId]: lineup }.
 *
 * Between rounds the Live tab keeps showing the last round, while the teams themselves
 * are open for the next one - so a team is scored on the lineup it had at that round's
 * lock, not on whatever it has been changed to since. Only asked for when `enabled`
 * (signed in, lineups unlocked); while a round is locked a team cannot have changed.
 */
export default function usePlayedLineups(season, round, { userId, enabled }) {
    const key = enabled && userId && db && round !== null ? `${userId}:${season}:${round}` : null;
    const [loaded, setLoaded] = useState({ key: null, lineups: NONE });

    useEffect(() => {
        if (!key) return undefined;
        let alive = true;
        listPlayedLineups(season, round)
            .then(rows => {
                if (!alive) return;
                const lineups = Object.fromEntries((rows ?? []).map(r => [r.team_id, cleanLineup(r.lineup)]));
                setLoaded({ key, lineups });
            })
            // Without them each team shows its current lineup, as during a round.
            .catch(() => { if (alive) setLoaded({ key, lineups: NONE }); });
        return () => { alive = false; };
    }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- `key` carries season and round

    return loaded.key === key ? loaded.lineups : NONE;
}
