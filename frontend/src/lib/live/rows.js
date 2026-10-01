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
const RANK = { live: 0, bench: 1, waiting: 1, final: 2, dnp: 3, upcoming: 4, out: 5, nogame: 6 };

/**
 * Everything a watch card shows about one player, derived from the round's games.
 *
 * state: live | final | upcoming | bench (in a live game, yet to play) | waiting (game on,
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
    if (line.dnp) return { ...row, line, state: game.status === 'final' ? 'dnp' : 'bench' };

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

export function sortRows(rows) {
    return [...rows].sort((a, b) =>
        (RANK[a.state] - RANK[b.state])
        || ((b.score ?? -Infinity) - (a.score ?? -Infinity))
        || ((a.game?.tipoff ?? Infinity) - (b.game?.tipoff ?? Infinity))
        || ((b.avg ?? 0) - (a.avg ?? 0)));
}

/** The round so far, what the win bonuses would add, and a projection for the rest. */
export function totals(rows) {
    const scored = rows.filter(r => r.score !== null);
    const toPlay = rows.filter(r => ['upcoming', 'bench', 'waiting'].includes(r.state));
    const total = scored.reduce((s, r) => s + r.score, 0);
    return {
        total: Math.round(total * 10) / 10,
        pending: Math.round(rows.reduce((s, r) => s + r.pending, 0) * 10) / 10,
        projected: Math.round((total + toPlay.reduce((s, r) => s + (r.avg ?? 0), 0)) * 10) / 10,
        live: rows.filter(r => r.state === 'live').length,
        final: rows.filter(r => ['final', 'dnp'].includes(r.state)).length,
        toPlay: toPlay.length,
    };
}
