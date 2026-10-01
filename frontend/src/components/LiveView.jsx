import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Radio, UserPlus, Volume2, VolumeX, FlaskConical, Plus, RefreshCw } from 'lucide-react';
import { fetchStats } from '../services/api';
import { CURRENT_SEASON } from '../seasons';
import useWatchlist from '../hooks/useWatchlist';
import useLiveRound from '../hooks/useLiveRound';
import useNow from '../hooks/useNow';
import { useOpenPlayer } from '../hooks/playerDetailContext';
import { euroleagueSource } from '../lib/live/source';
import { demoSource } from '../lib/live/demo';
import { watchRow, sortRows, totals } from '../lib/live/rows';
import { countdown, ago } from '../lib/live/format';
import { chime, enableChime } from '../lib/live/chime';
import { euroleagueCode } from '../lib/live/teams';
import GameStrip from './live/GameStrip';
import WatchCard from './live/WatchCard';
import TotalCard from './live/TotalCard';
import ActivityFeed from './live/ActivityFeed';
import LivePicker from './live/LivePicker';
import LiveDot from './live/LiveDot';

const SEASON_CODE = `E${CURRENT_SEASON}`;
// Every priced player, with season averages: the same request the stats table makes
// for its widest view, so it is usually already cached.
const ROSTER_QUERY = { season: CURRENT_SEASON, position: 'All', min_cr: 0, max_cr: 100, last_x_games: 100 };
const SOUND_KEY = 'euroguru.liveSound';
const BIG_PLAY = 3;
// Euroleague's edge holds an answer for up to a minute; much older than that while a
// game is on means their feed has stalled, which is worth saying out loud.
const STALE_FEED_MS = 150_000;

const loadSound = () => {
    try {
        return window.localStorage.getItem(SOUND_KEY) === 'on';
    } catch {
        return false;
    }
};

function StatusPill({ games, now }) {
    const live = games.filter(g => g.status === 'live');
    if (live.length) {
        return (
            <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-red-500/15 border border-red-500/30 text-xs font-semibold text-red-200">
                <LiveDot /> LIVE · {live.length} {live.length === 1 ? 'game' : 'games'}
            </span>
        );
    }
    const next = games.filter(g => g.status === 'scheduled').sort((a, b) => a.tipoff - b.tipoff)[0];
    if (next) {
        return (
            <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-gray-300">
                {next.tipoff > now ? <>Next tip-off in {countdown(next.tipoff - now)}</> : 'Tipping off…'}
            </span>
        );
    }
    if (games.length) {
        return <span className="px-2.5 py-1 rounded-full bg-white/5 text-xs text-gray-400">Round complete</span>;
    }
    return null;
}

function Freshness({ connection, games, now }) {
    if (connection.state === 'limited') {
        return <span className="text-amber-300">Euroleague is rate-limiting us · retrying in a minute</span>;
    }
    if (connection.state === 'reconnecting') {
        return <span className="text-amber-300">Connection lost · reconnecting…</span>;
    }
    const stalled = games.some(g => g.status === 'live' && g.lastModified && now - g.lastModified > STALE_FEED_MS);
    return (
        <span>
            {connection.lastOk ? `Updated ${ago(now - connection.lastOk)}` : 'Connecting…'}
            {stalled && <span className="text-amber-300"> · Euroleague's feed is running behind</span>}
        </span>
    );
}

function EmptyState({ suggestions, onAdd, onPick }) {
    return (
        <div className="glass-panel p-6 sm:p-8 text-center">
            <div className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center bg-purple-500/15 border border-purple-500/30 text-purple-300">
                <Radio size={22} />
            </div>
            <h3 className="text-lg font-semibold text-white">Pick the players you want to follow</h3>
            <p className="mt-1 text-sm text-gray-400 max-w-md mx-auto">
                Their fantasy points update live while they play, with every basket, board and turnover as it happens.
            </p>
            <button
                type="button"
                onClick={onPick}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400"
            >
                <UserPlus size={16} /> Choose players
            </button>
            {suggestions.length > 0 && (
                <div className="mt-6">
                    <div className="text-[11px] uppercase tracking-wider text-gray-600 mb-2">Or start with the top scorers in this round</div>
                    <div className="flex flex-wrap justify-center gap-2">
                        {suggestions.map(p => (
                            <button
                                key={p.PlayerKey}
                                type="button"
                                onClick={() => onAdd(p.PlayerKey)}
                                className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-full text-xs border border-white/10 bg-white/5 text-gray-200 hover:bg-purple-500/15 hover:border-purple-500/30"
                            >
                                <Plus size={12} /> {p.PlayerName}
                                <span className="font-mono text-gray-500">{p.Average_Score.toFixed(1)}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Live fantasy points for the players you choose, while their games are on.
 *
 * The browser reads Euroleague's live feed directly (see lib/live/feed.js) and scores it
 * exactly as the fantasy game does. ?demo replays a finished round instead, for trying
 * the tab when nothing is on.
 */
export default function LiveView() {
    const demo = useMemo(() => new URLSearchParams(window.location.search).has('demo'), []);
    const [source] = useState(() => (demo ? demoSource(SEASON_CODE) : euroleagueSource(SEASON_CODE)));
    const [roster, setRoster] = useState(null);
    const [picker, setPicker] = useState({ open: false, game: null });
    const [sound, setSound] = useState(loadSound);
    const now = useNow(1000);
    const watch = useWatchlist();
    const openPlayer = useOpenPlayer();

    useEffect(() => {
        let alive = true;
        fetchStats(ROSTER_QUERY).then(rows => { if (alive) setRoster(rows ?? []); });
        return () => { alive = false; };
    }, []);

    // A big play chimes - when the viewer has turned sound on.
    const soundOn = useRef(sound);
    useEffect(() => { soundOn.current = sound; });
    const onEvents = useCallback((events) => {
        if (soundOn.current && events.some(e => e.kind === 'player' && e.delta >= BIG_PLAY)) chime();
    }, []);

    // Audio may only start from a gesture, so a saved "on" waits for the first click.
    useEffect(() => {
        if (!sound) return undefined;
        const wake = () => enableChime();
        document.addEventListener('pointerdown', wake, { once: true });
        return () => document.removeEventListener('pointerdown', wake);
    }, [sound]);

    const toggleSound = () => {
        const next = !sound;
        if (next) {
            enableChime();
            chime(); // the sound that is being switched on
        }
        setSound(next);
        try {
            window.localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
        } catch { /* the choice just lasts this visit */ }
    };

    const live = useLiveRound({
        source,
        seasonCode: demo ? `${SEASON_CODE}-demo` : SEASON_CODE,
        roster,
        watchKeys: watch.keys,
        onEvents,
    });

    const rosterByKey = useMemo(() => new Map((roster ?? []).map(p => [p.PlayerKey, p])), [roster]);
    const rows = useMemo(
        () => sortRows(watch.keys.map(k => rosterByKey.get(k)).filter(Boolean).map(p => watchRow(p, live.games))),
        [watch.keys, rosterByKey, live.games],
    );
    const sums = useMemo(() => totals(rows), [rows]);
    const lastEvent = useMemo(() => {
        const latest = new Map();
        for (const e of live.events) if (e.kind === 'player' && !latest.has(e.key)) latest.set(e.key, e);
        return latest;
    }, [live.events]);
    const teamNames = useMemo(() => {
        const names = new Map();
        for (const g of live.games) {
            names.set(g.homeCode, g.homeName);
            names.set(g.awayCode, g.awayName);
        }
        return names;
    }, [live.games]);
    const suggestions = useMemo(() => {
        const playing = new Set(live.games.filter(g => g.status !== 'final').flatMap(g => [g.homeCode, g.awayCode]));
        return (roster ?? [])
            .filter(p => playing.has(euroleagueCode(p)) && typeof p.Average_Score === 'number')
            .sort((a, b) => b.Average_Score - a.Average_Score)
            .slice(0, 8);
    }, [roster, live.games]);

    const nameOf = useCallback((key) => rosterByKey.get(key)?.PlayerName ?? 'Player', [rosterByKey]);
    const openPicker = (game = null) => setPicker({ open: true, game });
    const closePicker = useCallback(() => setPicker({ open: false, game: null }), []);

    const loading = live.status === 'loading' || roster === null;

    return (
        <div className="space-y-5">
            {demo && (
                <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-sm text-amber-200">
                    <FlaskConical size={16} className="shrink-0" />
                    Demo replay: round {live.round ?? ''} played back at speed. Not live data.
                </div>
            )}

            <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-2xl font-bold flex flex-wrap items-center gap-3">
                        Live
                        {live.status === 'ready' && <StatusPill games={live.games} now={now} />}
                    </h2>
                    <p className="text-gray-400 text-sm mt-1">
                        {live.round ? `Round ${live.round} · ` : ''}
                        {live.status === 'ready'
                            ? <Freshness connection={live.connection} games={live.games} now={now} />
                            : 'Fantasy points as the games happen'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={toggleSound}
                        title={sound ? 'Chime on big plays: on' : 'Chime on big plays: off'}
                        aria-pressed={sound}
                        className={`p-2.5 rounded-lg border transition-colors ${sound
                            ? 'border-purple-500/40 bg-purple-500/15 text-purple-200'
                            : 'border-white/10 text-gray-400 hover:text-white hover:bg-white/5'}`}
                    >
                        {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
                    </button>
                    <button
                        type="button"
                        onClick={() => openPicker()}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 disabled:opacity-50"
                    >
                        <UserPlus size={16} /> Add players
                        {watch.limit && (
                            <span className="text-[11px] text-purple-200/80">{watch.keys.length}/{watch.limit}</span>
                        )}
                    </button>
                </div>
            </header>

            {live.status === 'error' && (
                <div className="glass-panel p-5 flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-300">Couldn't load the game schedule from Euroleague.</span>
                    <button
                        type="button"
                        onClick={live.retry}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-white/10 text-gray-200 hover:bg-white/5"
                    >
                        <RefreshCw size={14} /> Try again
                    </button>
                </div>
            )}

            {loading && live.status !== 'error' && (
                <div className="w-full h-[300px] flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            )}

            {!loading && (
                <>
                    <GameStrip games={live.games} now={now} onPick={openPicker} />

                    {rows.length === 0 ? (
                        <EmptyState suggestions={suggestions} onAdd={watch.add} onPick={() => openPicker()} />
                    ) : (
                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
                            <div className="xl:hidden">
                                <TotalCard round={live.round} sums={sums} />
                            </div>
                            <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                                {rows.map(row => (
                                    <WatchCard
                                        key={row.key}
                                        row={row}
                                        history={live.history[row.key]}
                                        lastEvent={lastEvent.get(row.key)}
                                        now={now}
                                        onRemove={() => watch.remove(row.key)}
                                        onOpen={() => openPlayer(row.player.PlayerName, CURRENT_SEASON)}
                                    />
                                ))}
                            </div>
                            <aside className="space-y-4">
                                <div className="hidden xl:block">
                                    <TotalCard round={live.round} sums={sums} />
                                </div>
                                <ActivityFeed events={live.events} nameOf={nameOf} />
                            </aside>
                        </div>
                    )}
                </>
            )}

            {picker.open && roster && (
                <LivePicker
                    roster={roster}
                    games={live.games}
                    focusGame={picker.game}
                    watch={watch}
                    round={live.round}
                    teamNames={teamNames}
                    now={now}
                    onClose={closePicker}
                />
            )}
        </div>
    );
}
