/** The "Full season" value in GamesWindowSelect. */
export const FULL_SEASON = 100;

/**
 * Narrow every series to the most recent `games` price updates.
 *
 * N+1 points, not N: the price going *into* the stretch is what the following ones
 * are a change from, so "Last game" means the most recent move rather than a single
 * point with nothing to compare it to.
 *
 * Rounds are the unit: the API dates every point to the round it belongs to and sends
 * one point per round. Snapshot dates remain the fallback for a season with no
 * schedule to date the rounds with, where nothing can say which round a price belongs
 * to. A null-round point is treated as predating round 1, so it appears only when the
 * window reaches back that far.
 *
 * Note the window counts rounds, not points: rounds nobody recorded a price for are
 * absent from the series, so "last 5" over a sparsely sampled season returns the
 * points falling in the last 5 rounds, which can be fewer than 5.
 *
 * Lived in PriceTrackerPanel until the recommendations table needed the same
 * windowing for its sparkline column.
 */
export function applyWindow(players, games) {
    if (!players.length || games >= FULL_SEASON) return players;

    const rounds = players
        .flatMap(p => p.series.map(s => s.round))
        .filter(r => r !== null && r !== undefined);

    let keep;
    if (rounds.length) {
        const cutoff = Math.max(...rounds) - games;
        keep = (point) => (point.round === null || point.round === undefined
            ? cutoff <= 0
            : point.round >= cutoff);
    } else {
        // Distinct dates across all players, so every series shares one x range rather
        // than each player getting their own last-N.
        const dates = [...new Set(players.flatMap(p => p.series.map(s => s.date)))].sort();
        const window = new Set(dates.slice(-(games + 1)));
        keep = (point) => window.has(point.date);
    }

    return players
        .map(player => {
            const series = player.series.filter(keep);
            if (!series.length) return null;
            const first = series[0].cr;
            const last = series[series.length - 1].cr;
            // Recomputed, not inherited: "who moved most" over three games is a
            // different question from over a season, and a label has to agree with
            // the line it is labelling.
            return { ...player, series, first, last, change: Math.round((last - first) * 10) / 10 };
        })
        .filter(Boolean)
        .sort((a, b) => b.change - a.change);
}
