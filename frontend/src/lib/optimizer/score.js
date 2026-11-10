import { ROLE_FACTOR } from '../live/rows';
import { coachPoints } from '../live/feed';

// Every score a coach can make, best first (the table in backend/utils/coaches.py).
export const COACH_OUTCOMES = [25, 20, 10, -5, -10, -20];

/** A coach's score as the game shows it: "+10", "−5" (a real minus), "0". */
export const coachScore = (pts) => (pts > 0 ? `+${pts}` : pts < 0 ? `\u2212${Math.abs(pts)}` : '0');

/** A chance as a whole percentage: 0.331 -> "33%". */
export const pct = (p) => `${Math.round((p ?? 0) * 100)}%`;

/**
 * What a coach counts for in an expected total: the score he most likely makes, not a
 * probability-weighted mean - a coach scores 25, 20, 10, -5, -10 or -20 and nothing in
 * between. 0 without an outlook (no game, or not loaded yet).
 */
export const coachExpected = (outlook) => outlook?.likely ?? 0;

/**
 * A lineup's expected round score and cost, from /api/expected and the roster's prices.
 *
 * The score counts each player by his role exactly as a round does - captain x2, the
 * other starters and the sixth man (first on the bench) x1, the rest of the bench x0.5 -
 * plus the score the coach most likely makes in his club's next game (coachExpected).
 * The cost is every player's
 * CR plus the coach's, as the game's budget counts it.
 *
 * Returns { rows, coach, expected, cost, missing } where each row is
 * { key, player, role, factor, fpt, counted, cr } and `missing` counts keys with no
 * price (a player since dropped from the roster).
 */
export function teamOutlook(lineup, { rosterByKey, coachByKey, expected }) {
    const bench = lineup.bench ?? [];
    const roleOf = (key) => (lineup.captain === key ? 'captain'
        : bench[0] === key ? 'sixth' : bench.includes(key) ? 'bench' : 'starter');
    let missing = 0;
    const rows = (lineup.keys ?? []).map(key => {
        const player = rosterByKey.get(key) ?? null;
        if (!player) missing += 1;
        const role = roleOf(key);
        const factor = ROLE_FACTOR[role];
        const fpt = expected.players?.[key]?.fpt ?? null;
        return {
            key, player, role, factor, fpt,
            counted: fpt === null ? 0 : fpt * factor,
            cr: typeof player?.CR === 'number' ? player.CR : 0,
            avail: expected.players?.[key]?.avail ?? null,
            injury: expected.players?.[key]?.injury ?? null,
        };
    });
    const coachInfo = lineup.coach ? coachByKey.get(lineup.coach) ?? null : null;
    const coach = lineup.coach ? {
        key: lineup.coach,
        coach: coachInfo,
        cr: typeof coachInfo?.CR === 'number' ? coachInfo.CR : 0,
        outlook: expected.coaches?.[lineup.coach] ?? null,
    } : null;
    const expectedTotal = rows.reduce((s, r) => s + r.counted, 0) + coachExpected(coach?.outlook);
    const cost = rows.reduce((s, r) => s + r.cr, 0) + (coach?.cr ?? 0);
    return { rows, coach, expected: expectedTotal, cost: Math.round(cost * 10) / 10, missing };
}

/** "id:<n>" -> { round: CR } from /api/cr-history, built once for teamRound's price changes. */
export function pricesByRound(history) {
    const map = new Map();
    for (const p of history?.players ?? []) {
        const byRound = {};
        for (const point of p.series ?? []) {
            if (point.round !== null && point.round !== undefined) byRound[point.round] = point.cr;
        }
        map.set(p.playerKey, byRound);
    }
    return map;
}

/**
 * A lineup replayed on a played round: the same players in the same roles, each on
 * what he really scored that round (/api/round-scores) - captain x2, the other starters
 * and the sixth man x1, the rest of the bench x0.5 - and the coach on his club's margin.
 * `delta` is how a player's price moved with the round (its settled price minus the one
 * before it; null when he was not priced then). Coaches have no price history.
 *
 * The rows have teamOutlook's shape, so the court and the list draw either. Returns
 * { rows, coach, scored, gain } - the team's round score and its players' value change.
 */
export function teamRound(lineup, { rosterByKey, coachByKey, scores, prices, round }) {
    const bench = lineup.bench ?? [];
    const roleOf = (key) => (lineup.captain === key ? 'captain'
        : bench[0] === key ? 'sixth' : bench.includes(key) ? 'bench' : 'starter');
    const r = String(round);
    const round1 = (x) => Math.round(x * 10) / 10;
    const rows = (lineup.keys ?? []).map(key => {
        const player = rosterByKey.get(key) ?? null;
        const role = roleOf(key);
        const factor = ROLE_FACTOR[role];
        const game = scores.players?.[key]?.[r] ?? null;
        const fpt = game ? game.fpt : null;
        const price = prices.get(key) ?? {};
        const before = price[round - 1];
        const after = price[round];
        return {
            key, player, role, factor, fpt,
            minutes: game ? game.min : null,
            counted: fpt === null ? 0 : fpt * factor,
            cr: typeof player?.CR === 'number' ? player.CR : 0,
            delta: typeof before === 'number' && typeof after === 'number' ? round1(after - before) : null,
        };
    });
    const coachInfo = lineup.coach ? coachByKey.get(lineup.coach) ?? null : null;
    const game = coachInfo ? scores.clubs?.[coachInfo.TeamCode]?.[r] ?? null : null;
    const coach = lineup.coach ? {
        key: lineup.coach,
        coach: coachInfo,
        cr: typeof coachInfo?.CR === 'number' ? coachInfo.CR : 0,
        game,
        points: game ? coachPoints(game.margin) : 0,
    } : null;
    const scored = rows.reduce((s, row) => s + row.counted, 0) + (coach?.points ?? 0);
    const gain = rows.reduce((s, row) => s + (row.delta ?? 0), 0);
    return { rows, coach, scored: round1(scored), gain: round1(gain) };
}

/** A round's price change as shown: "+0.3", "−0.5" (a real minus) or "±0.0", and its colour. */
export function crChange(delta) {
    if (delta === null || delta === undefined) return { text: '–', tone: 'text-gray-600' };
    if (delta > 0) return { text: `+${delta.toFixed(1)}`, tone: 'text-emerald-400' };
    if (delta < 0) return { text: `\u2212${Math.abs(delta).toFixed(1)}`, tone: 'text-red-400' };
    return { text: '\u00b10.0', tone: 'text-gray-500' };
}
