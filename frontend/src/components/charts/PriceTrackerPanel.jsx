import React, { useState, useEffect, useMemo } from 'react';
import { fetchCrHistory } from '../../services/api';
import { loadStored, storeValue } from '../../columns';
import PlayerPicker from '../PlayerPicker';
import PriceHistoryChart from './PriceHistoryChart';
import { colorForIndex } from './palette';

const SELECTION_KEY = 'euroguru.courtVision.priceTracker';
const MAX_LINES = 10;
const DEFAULT_PER_SIDE = 3;
const FULL_SEASON = 100;

/**
 * Narrow every series to the most recent `games` price updates.
 *
 * N+1 points, not N: the price going *into* the stretch is what the following ones
 * are a change from, so "Last game" means the most recent move rather than a single
 * point with nothing to compare it to.
 *
 * Rounds are used when the snapshots carry them, which is only those written after
 * the fetcher started stamping Round. Everything before falls back to snapshot dates
 * — the honest unit for that data, since nothing recorded which round it belonged to.
 * A null-round point is treated as predating round 1, so it appears only when the
 * window reaches back that far.
 */
const applyWindow = (players, games) => {
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
        // Distinct dates across all players, so every line shares one x range rather
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
            // different question from over a season, and the legend has to agree
            // with the lines it is labelling.
            return { ...player, series, first, last, change: Math.round((last - first) * 10) / 10 };
        })
        .filter(Boolean)
        .sort((a, b) => b.change - a.change);
};

/**
 * Default to the extremes: the biggest risers and the biggest fallers.
 *
 * Opening on the top of the price list would mostly show flat lines for players who
 * were expensive all along. The movement is the story — who the market caught up with,
 * and who got cheap enough to be worth a look.
 */
const defaultSelection = (players) => {
    if (players.length <= DEFAULT_PER_SIDE * 2) return players;
    const moved = players.filter(p => p.change !== 0);
    // Pre-season, every price is the opening one and nothing has moved yet.
    if (!moved.length) return players.slice(0, DEFAULT_PER_SIDE);

    // Sorted by change descending from the API, so the ends are the extremes.
    const risers = moved.slice(0, DEFAULT_PER_SIDE);
    const fallers = moved.slice(-DEFAULT_PER_SIDE).reverse();
    return [...new Set([...risers, ...fallers])];
};

// A selection entry keeps both identities a player can have, because which one a
// season uses depends on when its snapshots were written: everything before
// 2026-09-07 is keyed on a full name, everything after on a Dunkest id. Storing the
// pair is what lets a selection survive a switch across that boundary.
const asEntries = (players) => players.map(p => ({ k: p.playerKey, n: p.nameKey }));

/** Tolerate the earlier format, a plain array of playerKeys. */
const normalise = (stored) =>
    (Array.isArray(stored) ? stored : [])
        .map(e => (typeof e === 'string' ? { k: e, n: null } : e))
        .filter(e => e && e.k);

/**
 * Selection -> the players of this season it refers to.
 *
 * Exact key first, then the initial+surname key, which is the same in both eras
 * ("Sasha Vezenkov" and "S. Vezenkov" both reduce to "S|VEZENKOV") and so carries a
 * selection across the id/name change.
 */
const resolve = (entries, players) => {
    const byKey = new Map(players.map(p => [p.playerKey, p]));
    const byName = new Map();
    for (const p of players) if (!byName.has(p.nameKey)) byName.set(p.nameKey, p);

    const hits = entries
        .map(e => byKey.get(e.k) ?? (e.n ? byName.get(e.n) : undefined))
        .filter(Boolean);
    return [...new Set(hits)];
};

/**
 * Price over time for a chosen handful of players.
 *
 * Its own panel rather than a buildable chart: the builder describes a chart as two
 * columns of the aggregated player table, and this is neither — it is a per-player
 * series over dates, from a different endpoint entirely.
 */
export default function PriceTrackerPanel({ season, games = FULL_SEASON, onSelectPlayer }) {
    const [players, setPlayers] = useState([]);
    const [selection, setSelection] = useState([]);
    // Whether the selection is the user's own. An untouched panel follows the games
    // window, because the movers over three games are not the movers over a season;
    // a deliberate pick is left alone.
    const [pinned, setPinned] = useState(false);
    const [loadedSeason, setLoadedSeason] = useState(null);

    // Derived rather than stored, so nothing is set from the effect body: a season
    // whose response has not arrived yet is, by definition, still loading.
    const loading = loadedSeason !== season;

    useEffect(() => {
        let alive = true;
        fetchCrHistory(season).then(data => {
            if (!alive) return;
            const list = data?.players ?? [];
            const saved = resolve(normalise(loadStored(SELECTION_KEY, null)), list);
            setPlayers(list);
            setSelection(asEntries(saved));
            setPinned(saved.length > 0);
            setLoadedSeason(season);
        });
        return () => { alive = false; };
    }, [season]);

    // Windowing is done here rather than server-side: the response is the whole
    // season either way, so narrowing it locally makes the selector instant and keeps
    // one cached response per season instead of one per season-and-window.
    const windowed = useMemo(() => applyWindow(players, games), [players, games]);

    const charted = useMemo(() => {
        if (!pinned) return defaultSelection(windowed);
        const hits = resolve(selection, windowed);
        // Rescue only a selection that named players this window does not have - that
        // is the cross-season case, where a blank chart would look broken. An emptied
        // picker is a deliberate choice and must stay empty, or "Clear all" would
        // silently refill itself and the next pick would land on top of the movers.
        if (!hits.length && selection.length) return defaultSelection(windowed);
        return hits;
    }, [pinned, selection, windowed]);

    const choose = (picked) => {
        setSelection(asEntries(picked));
        setPinned(true);
        storeValue(SELECTION_KEY, asEntries(picked));
    };

    // Hands the panel back to the window rather than freezing today's movers.
    const followMovers = () => {
        setSelection([]);
        setPinned(false);
        storeValue(SELECTION_KEY, []);
    };

    const byKey = useMemo(() => new Map(windowed.map(p => [p.playerKey, p])), [windowed]);
    const selectedKeys = useMemo(() => charted.map(p => p.playerKey), [charted]);
    const snapshots = useMemo(
        () => new Set(windowed.flatMap(p => p.series.map(s => s.date))).size,
        [windowed]
    );

    if (loading) {
        return (
            <div className="h-[420px] flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (!players.length) {
        return (
            <div className="h-[200px] flex items-center justify-center text-center text-sm text-gray-500 px-6">
                No price snapshots were recorded for this season, so there is no history to chart.
            </div>
        );
    }

    return (
        <div className="bg-[#ffffff03] rounded-xl p-4 border border-[#ffffff05]">
            <div className="flex flex-wrap items-center gap-2 mb-3">
                <PlayerPicker
                    players={windowed}
                    selected={selectedKeys}
                    onChange={(keys) => choose(keys.map(k => byKey.get(k)).filter(Boolean))}
                    max={MAX_LINES}
                />
                <button
                    onClick={followMovers}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${!pinned
                        ? 'bg-purple-600/20 text-purple-300 border-purple-500/40'
                        : 'bg-[#ffffff05] text-gray-500 border-[#ffffff10] hover:text-gray-300'}`}
                >
                    Biggest movers
                </button>
                <span className="text-xs text-gray-600 ml-auto">
                    {windowed.length} players · {snapshots} {snapshots === 1 ? 'snapshot' : 'snapshots'}
                </span>
            </div>

            {/* A flat chart is worth explaining: without this, a window in which nobody
                was repriced looks like the panel failed rather than like news. */}
            {windowed.length > 0 && windowed.every(p => p.change === 0) && (
                <p className="text-xs text-amber-400/80 mb-3">
                    No player was repriced across {snapshots === 2 ? 'these two snapshots' : 'this window'} —
                    widen “Based on” to see movement.
                </p>
            )}

            {/* Legend doubles as the change summary — the numbers people came for. */}
            {charted.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3">
                    {charted.map((player, i) => (
                        <button
                            key={player.playerKey}
                            onClick={() => onSelectPlayer?.(player.playerName)}
                            disabled={!onSelectPlayer}
                            className="flex items-center gap-1.5 text-xs rounded px-1 -mx-1
                                       enabled:hover:bg-[#ffffff08] enabled:cursor-pointer transition-colors"
                        >
                            <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: colorForIndex(i) }}
                            />
                            <span className="text-gray-300">{player.playerName}</span>
                            <span className="text-gray-600 tabular-nums">
                                {player.first.toFixed(1)}→{player.last.toFixed(1)}
                            </span>
                            <span className={`tabular-nums font-medium ${player.change > 0 ? 'text-emerald-400'
                                : player.change < 0 ? 'text-red-400' : 'text-gray-600'}`}>
                                {player.change > 0 ? '+' : ''}{player.change.toFixed(1)}
                            </span>
                        </button>
                    ))}
                </div>
            )}

            <PriceHistoryChart players={charted} />
        </div>
    );
}
