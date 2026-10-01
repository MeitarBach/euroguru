import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { currentRound } from '../lib/live/schedule';
import { matchLines } from '../lib/live/names';
import { euroleagueCode } from '../lib/live/teams';
import { RateLimitedError, winBonus, round1 } from '../lib/live/feed';
import { scoreOf } from '../lib/live/rows';

// Start asking this long before a tip-off: the feed often fills in a little early.
const NEAR_TIPOFF_MS = 10 * 60_000;
// Past tip-off with no data yet, or about to tip off.
const WAITING_POLL_MS = 20_000;
const IDLE_MAX_MS = 5 * 60_000;
// A hidden tab keeps listening, more slowly: the chime is for exactly the moments the
// viewer is looking at the TV rather than the page, and catching up is instant anyway.
const HIDDEN_POLL_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_EVENTS = 50;
const MAX_HISTORY = 120;

// How a change in a player's line reads in the feed, in the order it is listed. Every
// stat that moves PIR is here, so a score change always comes with its reason.
const plural = (d, one, many) => (d > 1 ? many(d) : one);
const STAT_PARTS = [
    ['pts', d => `+${d} PTS`],
    ['reb', d => `+${d} REB`],
    ['ast', d => `+${d} AST`],
    ['stl', d => `+${d} STL`],
    ['blk', d => `+${d} BLK`],
    ['fd', d => plural(d, 'drew a foul', n => `drew ${n} fouls`)],
    ['tov', d => plural(d, 'turnover', n => `${n} turnovers`)],
    ['pf', d => plural(d, 'foul', n => `${n} fouls`)],
    ['blka', d => plural(d, 'got blocked', n => `blocked ${n} times`)],
];
const missed = (l) => (l.fga2 - l.fgm2) + (l.fga3 - l.fgm3) + (l.fta - l.ftm);

const storageKey = (seasonCode, round) => `euroguru.live.${seasonCode}.r${round}`;

function loadSession(key) {
    try {
        const saved = JSON.parse(window.sessionStorage.getItem(key) || 'null');
        return saved && Array.isArray(saved.events) && saved.history ? saved : null;
    } catch {
        return null;
    }
}

/** PlayerKey -> line for both teams of one game. */
function indexLines(lines, rosterByCode) {
    const byKey = {};
    for (const code of new Set(lines.map(l => l.code))) {
        const matched = matchLines(rosterByCode.get(code) ?? [], lines.filter(l => l.code === code));
        for (const [key, line] of matched) byKey[key] = line;
    }
    return byKey;
}

/**
 * The live state of one round, polled from `source`.
 *
 * Polls only what is needed: a game's header once it is near tip-off, its boxscore only
 * while a watched player is in it, and a finished game exactly once. Slows down while
 * the page is hidden and catches up the moment it is shown again; backs off on failures.
 *
 * Also turns successive boxscores into a feed of events and an FPT history per watched
 * player, both kept in sessionStorage so a reload mid-game keeps them.
 */
export default function useLiveRound({ source, seasonCode, roster, watchKeys, onEvents }) {
    const [schedule, setSchedule] = useState(null);
    const [scheduleError, setScheduleError] = useState(null);
    const [gameStates, setGameStates] = useState({});
    const [connection, setConnection] = useState({ state: 'connecting', lastOk: null, failures: 0 });
    const [journal, setJournal] = useState({ round: null, events: [], history: {} });
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let alive = true;
        source.schedule()
            .then(games => { if (alive) setSchedule(games); })
            .catch(error => { if (alive) setScheduleError(error); });
        return () => { alive = false; };
    }, [source, attempt]);

    const retry = useCallback(() => {
        setScheduleError(null);
        setAttempt(a => a + 1);
    }, []);

    // The round is chosen once per schedule load: switching rounds under someone's
    // nose mid-session would be stranger than a page that needs a reload the next day.
    const round = useMemo(
        () => (schedule ? currentRound(schedule, Date.now()) : null),
        [schedule],
    );
    const games = useMemo(
        () => (schedule ?? []).filter(g => g.round === round).sort((a, b) => a.tipoff - b.tipoff),
        [schedule, round],
    );

    const rosterByCode = useMemo(() => {
        const map = new Map();
        for (const player of roster ?? []) {
            const code = euroleagueCode(player);
            if (!code) continue;
            if (!map.has(code)) map.set(code, []);
            map.get(code).push(player);
        }
        return map;
    }, [roster]);

    const watchedCodes = useMemo(() => {
        const byKey = new Map((roster ?? []).map(p => [p.PlayerKey, p]));
        return new Set(watchKeys.map(k => euroleagueCode(byKey.get(k))).filter(Boolean));
    }, [roster, watchKeys]);

    // Everything the polling loop reads, refreshed after each render so the loop never
    // has to restart when a player is added or the roster lands.
    const live = useRef({});
    useEffect(() => {
        live.current = { ...live.current, source, games, rosterByCode, watchedCodes, watchKeys, onEvents };
    });

    // Restore this round's feed and sparklines from earlier in the session.
    useEffect(() => {
        if (round === null) return;
        const saved = loadSession(storageKey(seasonCode, round));
        live.current.journal = saved ? { round, ...saved } : { round, events: [], history: {} };
        live.current.states = {};
        setJournal(live.current.journal);
    }, [seasonCode, round]);

    useEffect(() => {
        if (journal.round === null) return;
        try {
            window.sessionStorage.setItem(
                storageKey(seasonCode, journal.round),
                JSON.stringify({ events: journal.events, history: journal.history }),
            );
        } catch { /* the feed just will not survive a reload */ }
    }, [seasonCode, journal]);

    const ready = Boolean(schedule && roster && round !== null);
    const wake = useRef(() => {});

    useEffect(() => {
        if (!ready) return undefined;
        let timer = null;
        let busy = false;
        let stopped = false;
        let failures = 0;

        const tick = async () => {
            const { source: src, games: roundGames, rosterByCode: rosters, watchedCodes: codes, watchKeys: keys } = live.current;
            const prevStates = live.current.states ?? {};
            const now = Date.now();
            const watching = new Set(keys);

            const due = roundGames.filter(g => now >= g.tipoff - NEAR_TIPOFF_MS);
            const results = await Promise.allSettled(due.map(async (game) => {
                const prev = prevStates[game.code];
                const watched = codes.has(game.homeCode) || codes.has(game.awayCode);
                if (prev?.status === 'final' && (prev.byKey || !watched)) return null;

                const header = prev?.status === 'final' ? prev : await src.header(game);
                const box = watched && header.status !== 'scheduled' ? await src.boxscore(game) : null;
                return { game, header, box };
            }));

            const states = { ...prevStates };
            const events = [];
            const history = { ...(live.current.journal?.history ?? {}) };
            let historyChanged = false;
            let ok = 0;
            let failed = 0;
            let limited = false;

            for (const result of results) {
                if (result.status === 'rejected') {
                    failed++;
                    if (result.reason instanceof RateLimitedError) limited = true;
                    continue;
                }
                ok++;
                if (!result.value) continue;
                const { game, header, box } = result.value;
                const prev = prevStates[game.code];
                const byKey = box ? indexLines(box.lines, rosters) : prev?.byKey;
                const next = {
                    status: header.status,
                    scoreHome: header.scoreHome ?? 0,
                    scoreAway: header.scoreAway ?? 0,
                    period: header.period ?? null,
                    clock: header.clock ?? null,
                    lastModified: Math.max(header.lastModified ?? 0, box?.lastModified ?? 0) || null,
                    byKey,
                };
                states[game.code] = next;

                const view = { ...game, ...next };
                const label = `${game.homeCode} ${next.scoreHome}–${next.scoreAway} ${game.awayCode}`;
                // Only transitions seen happening are news; a game that was already over
                // when the page opened is just a result. And only games with someone in
                // them the viewer follows - the feed is about their players.
                const followed = codes.has(game.homeCode) || codes.has(game.awayCode);
                if (followed && prev && prev.status === 'scheduled' && next.status === 'live') {
                    events.push({ kind: 'tipoff', game: game.code, at: now, text: `${game.homeCode} vs ${game.awayCode} tipped off` });
                }
                if (followed && prev && prev.status === 'live' && next.status === 'final') {
                    events.push({ kind: 'final', game: game.code, at: now, text: `Final: ${label}` });
                }

                for (const key of watching) {
                    const line = byKey?.[key];
                    if (!line) continue;
                    const code = line.code;
                    const score = scoreOf(line, view, code);
                    const before = prev?.byKey?.[key];

                    // The sparkline: one point per change, starting from zero at tip-off.
                    const points = history[key] ?? (next.status !== 'final' ? [0] : []);
                    if (points[points.length - 1] !== score) {
                        history[key] = [...points, score].slice(-MAX_HISTORY);
                        historyChanged = true;
                    }

                    if (!before) continue;
                    const prevScore = scoreOf(before, { ...game, ...prev }, code);
                    const delta = round1(score - prevScore);
                    const parts = STAT_PARTS
                        .map(([stat, label]) => [line[stat] - before[stat], label])
                        .filter(([d]) => d > 0)
                        .map(([d, label]) => label(d));
                    const misses = missed(line) - missed(before);
                    if (misses > 0) parts.push(plural(misses, 'missed shot', n => `${n} missed shots`));
                    const mine = code === game.homeCode ? next.scoreHome : next.scoreAway;
                    const theirs = code === game.homeCode ? next.scoreAway : next.scoreHome;
                    if (prev.status === 'live' && next.status === 'final' && mine > theirs && line.pir !== 0) {
                        parts.push(`win bonus +${winBonus(line.pir)}`);
                    }
                    if (!parts.length && delta === 0) continue;
                    events.push({
                        kind: 'player', key, game: game.code, at: now, delta, score,
                        parts, period: next.period, clock: next.clock,
                    });
                }
            }

            live.current.states = states;
            setGameStates(states);

            if (events.length || historyChanged) {
                const stamped = events.map((e, i) => ({ ...e, id: `${now}-${i}` }));
                const journalNext = {
                    round: live.current.journal?.round ?? null,
                    events: [...stamped.reverse(), ...(live.current.journal?.events ?? [])].slice(0, MAX_EVENTS),
                    history,
                };
                live.current.journal = journalNext;
                setJournal(journalNext);
                if (stamped.length) live.current.onEvents?.(stamped);
            }

            if (failed && !ok) failures++;
            else failures = 0;
            setConnection(c => ({
                state: failures ? (limited ? 'limited' : 'reconnecting') : 'ok',
                lastOk: ok || !due.length ? now : c.lastOk,
                failures,
            }));

            if (failures) {
                return limited ? MAX_BACKOFF_MS : Math.min(MAX_BACKOFF_MS, src.pollMs * 2 ** failures);
            }
            const statusOf = (g) => states[g.code]?.status ?? 'scheduled';
            if (roundGames.some(g => statusOf(g) === 'live')) return src.pollMs;
            const pending = roundGames.filter(g => statusOf(g) !== 'final');
            if (pending.some(g => now >= g.tipoff - NEAR_TIPOFF_MS)) return Math.min(WAITING_POLL_MS, src.pollMs * 2);
            if (!pending.length) return IDLE_MAX_MS;
            const nextWake = Math.min(...pending.map(g => g.tipoff - NEAR_TIPOFF_MS)) - now;
            return Math.max(5_000, Math.min(IDLE_MAX_MS, nextWake));
        };

        const run = async () => {
            if (busy || stopped) return;
            clearTimeout(timer);
            busy = true;
            let delay = MAX_BACKOFF_MS;
            try {
                delay = await tick();
            } catch (error) {
                console.warn('[live] update failed:', error);
            } finally {
                busy = false;
            }
            if (document.hidden && !live.current.source.keepPaceHidden) delay = Math.max(delay, HIDDEN_POLL_MS);
            if (!stopped) timer = setTimeout(run, delay);
        };

        const onVisibility = () => { if (!document.hidden) run(); };
        document.addEventListener('visibilitychange', onVisibility);
        wake.current = run;
        run();
        return () => {
            stopped = true;
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisibility);
            wake.current = () => {};
        };
    }, [ready]);

    // A player just added may be in a game that is on right now: fetch it at once
    // rather than at the next scheduled poll.
    const watchSignature = watchKeys.join('|');
    useEffect(() => { wake.current(); }, [watchSignature]);

    const roundGames = useMemo(
        () => games.map(g => ({ ...g, status: 'scheduled', ...gameStates[g.code] })),
        [games, gameStates],
    );

    return {
        status: scheduleError ? 'error' : ready ? 'ready' : 'loading',
        error: scheduleError,
        retry,
        round,
        games: roundGames,
        events: journal.events,
        history: journal.history,
        connection,
    };
}
