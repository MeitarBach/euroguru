import { loadSchedule } from './schedule';
import { fetchGame, parseHeader, parseBoxscore } from './feed';

/**
 * A replay of a finished round as if it were live, for trying the Live tab when no game
 * is on. Enabled with ?demo in the URL; the page says so in a banner.
 *
 * It replays real games, not invented ones: each player's actual final line is revealed
 * a piece at a time. Every single unit of every counting stat - each made two, each
 * missed free throw, each rebound - is given its own moment in the game, derived from a
 * hash so a reload replays identically. Stats therefore only ever climb, arrive in a
 * natural trickle, and end exactly on the real totals - which also makes the demo a
 * check on the scoring: a finished replay must show the official round's FPT.
 */

const DEMO_ROUND = 2;
const LEAD_MS = 12_000;      // first tip-off, after opening the page
const STAGGER_MS = 20_000;   // between tip-offs
const GAME_MS = 3 * 60_000;  // one game, start to final whistle

function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
const unit = (seed) => (hash(seed) % 100_000) / 100_000;

function minutesOf(text) {
    const m = /^(\d+):(\d{2})$/.exec(String(text ?? ''));
    return m ? Number(m[1]) + Number(m[2]) / 60 : 0;
}
const clockText = (minutes) => {
    const secs = Math.max(0, Math.round(minutes * 60));
    return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
};

/** A final line as it stood `p` of the way through the game (0 < p < 1). */
function lineAt(line, p) {
    if (line.dnp) return line;
    const seen = (stat, total) => {
        let count = 0;
        for (let i = 0; i < total; i++) if (unit(`${line.id}|${stat}|${i}`) <= p) count++;
        return count;
    };
    const fgm2 = seen('fgm2', line.fgm2);
    const miss2 = seen('miss2', line.fga2 - line.fgm2);
    const fgm3 = seen('fgm3', line.fgm3);
    const miss3 = seen('miss3', line.fga3 - line.fgm3);
    const ftm = seen('ftm', line.ftm);
    const missFt = seen('missft', line.fta - line.ftm);
    const oreb = seen('oreb', line.oreb);
    const dreb = seen('dreb', line.dreb);
    const rest = Object.fromEntries(
        ['ast', 'stl', 'blk', 'blka', 'tov', 'pf', 'fd'].map(stat => [stat, seen(stat, line[stat])]),
    );
    const pts = 2 * fgm2 + 3 * fgm3 + ftm;
    const reb = oreb + dreb;
    return {
        ...line,
        ...rest,
        fgm2, fga2: fgm2 + miss2, fgm3, fga3: fgm3 + miss3, ftm, fta: ftm + missFt,
        oreb, dreb, reb, pts,
        // The same PIR the feed's Valuation carries, from the stats revealed so far.
        pir: pts + reb + rest.ast + rest.stl + rest.blk + rest.fd
            - miss2 - miss3 - missFt - rest.tov - rest.blka - rest.pf,
        min: clockText(minutesOf(line.min) * p),
        pm: Math.round(line.pm * p),
    };
}

/** Who is on the floor: five per team, rotated every couple of game minutes. */
function withRotation(lines, p) {
    const stint = Math.floor(p * 20);
    const onCourt = new Set();
    for (const code of new Set(lines.map(l => l.code))) {
        const squad = lines.filter(l => l.code === code && !l.dnp);
        const ranked = stint === 0
            ? squad.filter(l => l.starter)
            : [...squad].sort((a, b) =>
                (minutesOf(b.finalMin) / 40 + unit(`${b.id}|court|${stint}`) * 0.6)
                - (minutesOf(a.finalMin) / 40 + unit(`${a.id}|court|${stint}`) * 0.6));
        ranked.slice(0, 5).forEach(l => onCourt.add(l.id));
    }
    return lines.map(l => ({ ...l, onCourt: onCourt.has(l.id) }));
}

export function demoSource(seasonCode) {
    const openedAt = Date.now();
    let replay = null;

    // The real finals, fetched once and re-timed to tip off one after another from now.
    const games = () => {
        replay ??= loadSchedule(seasonCode).then(async (all) => {
            const round = all.filter(g => g.round === DEMO_ROUND).sort((a, b) => a.code - b.code);
            return Promise.all(round.map(async (game, i) => {
                const [header, box] = await Promise.all([
                    fetchGame('Header', game.code, seasonCode),
                    fetchGame('Boxscore', game.code, seasonCode),
                ]);
                const final = parseBoxscore(box.data);
                return {
                    ...game,
                    tipoff: openedAt + LEAD_MS + i * STAGGER_MS,
                    finalHeader: parseHeader(header.data),
                    finalLines: (final?.lines ?? []).map(l => ({ ...l, finalMin: l.min })),
                };
            }));
        });
        return replay;
    };

    const find = async (code) => (await games()).find(g => g.code === code);
    const progress = (game) => (Date.now() - game.tipoff) / GAME_MS;

    const linesAt = (game, p) => withRotation(game.finalLines.map(l => lineAt(l, p)), p);

    return {
        kind: 'demo',
        pollMs: 4_000,
        // The replay runs on the wall clock; slowing it while hidden would only skip.
        keepPaceHidden: true,
        schedule: async () => (await games()).map(g => ({
            code: g.code, round: g.round, tipoff: g.tipoff, played: g.played,
            homeCode: g.homeCode, awayCode: g.awayCode, homeName: g.homeName, awayName: g.awayName,
        })),
        header: async ({ code }) => {
            const game = await find(code);
            const p = progress(game);
            const lastModified = Date.now();
            if (p < 0) return { status: 'scheduled', lastModified };
            if (p >= 1) return { ...game.finalHeader, lastModified };

            const lines = linesAt(game, p);
            const score = (team) => lines.filter(l => l.code === team).reduce((s, l) => s + l.pts, 0);
            const quarter = Math.min(4, Math.floor(p * 4) + 1);
            const left = (1 - (p * 4 - (quarter - 1))) * 10;
            return {
                status: 'live',
                scoreHome: score(game.homeCode),
                scoreAway: score(game.awayCode),
                quarter,
                period: `Q${quarter}`,
                clock: clockText(left),
                lastModified,
            };
        },
        boxscore: async ({ code }) => {
            const game = await find(code);
            const p = progress(game);
            if (p < 0) return null;
            if (p >= 1) return { live: false, lines: game.finalLines, lastModified: Date.now() };
            return { live: true, lines: linesAt(game, p), lastModified: Date.now() };
        },
    };
}
