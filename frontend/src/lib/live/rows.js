import { euroleagueCode } from './teams';
import { fantasyPoints, winBonus } from './feed';

/** A player's live score: PIR while the game runs, with the win bonus once it ends. */
export function scoreOf(line, game, code) {
    if (!line) return null;
    if (game.status !== 'final') return line.pir;
    const mine = code === game.homeCode ? game.scoreHome : game.scoreAway;
    const theirs = code === game.homeCode ? game.scoreAway : game.scoreHome;
    return fantasyPoints(line.pir, mine > theirs);
}

// Display order: the action first, then the finished, then what is still to come.
const RANK = { live: 0, idle: 1, waiting: 1, final: 2, dnp: 3, upcoming: 4, out: 5, nogame: 6 };

/**
 * Everything a watch card shows about one player, derived from the round's games.
 *
 * state: live | final | upcoming | idle (in a live game, yet to play) | waiting (game on,
 * boxscore not read yet) | out (not in the squad) | dnp | nogame (no game this round).
 */
export function watchRow(player, games) {
    const code = euroleagueCode(player);
    const game = games.find(g => g.homeCode === code || g.awayCode === code) ?? null;
    const avg = typeof player.Average_Score === 'number' ? player.Average_Score : null;
    const base = { key: player.PlayerKey, player, code, game, avg, line: null, score: null, pending: 0, bonus: 0 };
    if (!game) return { ...base, state: 'nogame' };

    const home = game.homeCode === code;
    const opp = home ? game.awayCode : game.homeCode;
    const mine = home ? game.scoreHome : game.scoreAway;
    const theirs = home ? game.scoreAway : game.scoreHome;
    const row = { ...base, home, opp, mine, theirs };

    if (game.status === 'scheduled') return { ...row, state: 'upcoming' };
    if (!game.byKey) return { ...row, state: 'waiting' };

    const line = game.byKey[player.PlayerKey] ?? null;
    if (!line) return { ...row, state: 'out' };
    if (line.dnp) return { ...row, line, state: game.status === 'final' ? 'dnp' : 'idle' };

    const leading = mine > theirs;
    return {
        ...row,
        line,
        state: game.status,
        score: scoreOf(line, game, code),
        pending: game.status === 'live' && leading && line.pir !== 0 ? winBonus(line.pir) : 0,
        bonus: game.status === 'final' && leading && line.pir !== 0 ? winBonus(line.pir) : 0,
    };
}

/** The boxscore's "KALAITZAKIS, PANAGIOTIS" as "P. Kalaitzakis". */
export function boxscoreName(name) {
    const title = (s) => s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());
    const [last, first] = String(name ?? '').split(',').map(s => s.trim());
    return first ? `${first.charAt(0)}. ${title(last)}` : title(last ?? '');
}

/**
 * One game as cards, per team: every priced player (as watchRow sees them) plus every
 * boxscore line the fantasy game does not price, as rows of the same shape with
 * `priced: false` and a "line:<id>" key. `missing` holds priced players who are not in
 * tonight's boxscore.
 */
export function gameRows(game, roster) {
    const matched = new Set(Object.values(game.byKey ?? {}).map(l => l.id));
    return [game.homeCode, game.awayCode].map(code => {
        const home = code === game.homeCode;
        const mine = home ? game.scoreHome : game.scoreAway;
        const theirs = home ? game.scoreAway : game.scoreHome;
        const priced = roster
            .filter(p => euroleagueCode(p) === code)
            .map(p => ({ ...watchRow(p, [game]), priced: true }));
        const unpriced = (game.lines ?? [])
            .filter(l => l.code === code && !matched.has(l.id))
            .map(line => ({
                key: `line:${line.id}`,
                player: { PlayerName: boxscoreName(line.name), position: '', PlayerKey: null },
                priced: false, code, game, home, opp: home ? game.awayCode : game.homeCode, mine, theirs,
                avg: null, line, pending: 0, bonus: 0,
                state: line.dnp ? (game.status === 'final' ? 'dnp' : 'idle') : game.status,
                score: line.dnp ? null : scoreOf(line, game, code),
            }));
        const rows = sortRows([...priced, ...unpriced].map(r => inGroup(r, 'starter')));
        return {
            code,
            name: home ? game.homeName : game.awayName,
            score: mine,
            rows: rows.filter(r => r.state !== 'out'),
            missing: rows.filter(r => r.state === 'out'),
        };
    });
}

// What a fantasy lineup role is worth: a bench player scores half, the captain double.
export const ROLE_FACTOR = { starter: 1, captain: 2, bench: 0.5 };
const round2 = (x) => Math.round(x * 100) / 100;

/**
 * A row as one group counts it, for the player's role in that group: starter, captain
 * or bench. The factor applies to everything - score, pending win bonus and season
 * average alike - while `score` keeps the player's own FPT for display.
 */
export function inGroup(row, role = 'starter') {
    const factor = ROLE_FACTOR[role] ?? 1;
    return {
        ...row,
        role,
        benched: role === 'bench',
        captain: role === 'captain',
        factor,
        counted: row.score === null ? null : round2(row.score * factor),
        countedPending: round2(row.pending * factor),
        countedBonus: round2(row.bonus * factor),
        countedAvg: row.avg === null ? null : row.avg * factor,
    };
}

export function sortRows(rows) {
    return [...rows].sort((a, b) =>
        (RANK[a.state] - RANK[b.state])
        || ((b.counted ?? b.score ?? -Infinity) - (a.counted ?? a.score ?? -Infinity))
        || ((a.game?.tipoff ?? Infinity) - (b.game?.tipoff ?? Infinity))
        || ((b.countedAvg ?? b.avg ?? 0) - (a.countedAvg ?? a.avg ?? 0)));
}

/** A group's round so far, what its win bonuses would add, and a projection for the rest. */
export function totals(rows) {
    const toPlay = rows.filter(r => ['upcoming', 'idle', 'waiting'].includes(r.state));
    const total = rows.reduce((s, r) => s + (r.counted ?? 0), 0);
    return {
        total: round2(total),
        pending: round2(rows.reduce((s, r) => s + r.countedPending, 0)),
        projected: round2(total + toPlay.reduce((s, r) => s + (r.countedAvg ?? 0), 0)),
        live: rows.filter(r => r.state === 'live').length,
        final: rows.filter(r => ['final', 'dnp'].includes(r.state)).length,
        toPlay: toPlay.length,
        benched: rows.filter(r => r.benched).length,
    };
}
