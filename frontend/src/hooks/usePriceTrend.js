import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchCrHistory } from '../services/api';
import { FULL_SEASON, applyWindow } from '../priceWindow';

/**
 * Look a player's CR history up from any card.
 *
 * Costs no extra request: /api/cr-history is one payload per season and api.js already
 * caches it, so the dashboard, the recommendations table and the Price Tracker all
 * share the same response.
 *
 * Returns { trendFor, ready }. `trendFor(player)` takes any object carrying a
 * PlayerKey (every player record the API returns does) and returns that player's
 * history record, or null.
 *
 * `games` narrows each series to the most recent price updates, so a sparkline sitting
 * next to figures from the last five games describes the same stretch rather than the
 * whole season. It defaults to the full season, which is what a surface with no games
 * selector of its own - the dashboard, the player modal - should keep showing.
 */
export default function usePriceTrend(season, games = FULL_SEASON) {
    const [players, setPlayers] = useState([]);
    const [loadedSeason, setLoadedSeason] = useState(null);

    useEffect(() => {
        let alive = true;
        fetchCrHistory(season).then(data => {
            if (!alive) return;
            setPlayers(data?.players ?? []);
            setLoadedSeason(season);
        });
        return () => { alive = false; };
    }, [season]);

    // Windowed before the lookup map is built, so first/last/change on a returned
    // record describe the selected stretch and not the season.
    const windowed = useMemo(() => applyWindow(players, games), [players, games]);

    // nameKey is the backend's _name_key of the player's name, and the API now stamps
    // the same value onto every player row as PlayerKey, so the two join exactly.
    // Matching on the display name does not work - the stats and the price snapshots
    // capitalise names differently ("Mckinley Wright iv" vs "Mckinley Wright Iv").
    const byKey = useMemo(() => {
        const map = new Map();
        for (const player of windowed) {
            const existing = map.get(player.nameKey);
            if (existing) existing.push(player);
            else map.set(player.nameKey, [player]);
        }
        return map;
    }, [windowed]);

    const trendFor = useCallback((player) => {
        const key = player?.PlayerKey;
        if (!key) return null;

        const matches = byKey.get(key);
        if (!matches) return null;
        if (matches.length === 1) return matches[0];

        // A handful of keys genuinely mean two players - Devon and Donta Hall both
        // reduce to "D|HALL" - because the key keeps only a first initial. Fall back
        // to the full name; if that still does not decide it, show nothing, since a
        // wrong price history is worse than a missing one.
        const name = String(player.PlayerName ?? '').trim().toLowerCase();
        return matches.find(m => String(m.playerName).trim().toLowerCase() === name) ?? null;
    }, [byKey]);

    return { trendFor, ready: loadedSeason === season };
}
