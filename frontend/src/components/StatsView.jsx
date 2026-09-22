import React, { useState, useEffect, useMemo, useRef } from 'react';
import { fetchFilters, fetchStats } from '../services/api';
import { Search, Filter, Download, List, TrendingUp, BarChart2 } from 'lucide-react';
import useDebouncedValue from '../hooks/useDebouncedValue';
import { statusOf } from '../injuries';
import { useOpenPlayer } from '../hooks/playerDetailContext';
import InfoTip from './InfoTip';
import ColumnPicker from './ColumnPicker';
import CrRangeSlider from './CrRangeSlider';
import GamesWindowSelect from './GamesWindowSelect';
import {
    COLUMNS, COLUMN_CATEGORIES, DEFAULT_COLUMN_IDS,
    columnKey, columnLabel, columnInfo, formatCell,
    loadStoredColumns, storeColumns,
} from '../columns';

const SortIcon = ({ column, sortConfig }) => {
    if (sortConfig.key !== column) return <div className="w-4 h-4 inline-block ml-1 opacity-20">↕</div>;
    return (
        <div className="w-4 h-4 inline-block ml-1 text-purple-400">
            {sortConfig.direction === 'asc' ? '↑' : '↓'}
        </div>
    );
};

// Header helper to handle click and mapping to correct data key
const Th = ({ label, sortKey, align = 'left', sortConfig, onSort, info }) => (
    <th
        className={`px-4 py-4 cursor-pointer hover:bg-[#ffffff05] transition-colors text-${align} whitespace-nowrap`}
        onClick={() => onSort(sortKey)}
    >
        <div className={`flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
            {label}
            {info && <InfoTip text={info} />}
            <SortIcon column={sortKey} sortConfig={sortConfig} />
        </div>
    </th>
);

// One definition per column drives both the header and the body cell. They used to
// be two hand-maintained blocks that had to be edited in lockstep, which is how a
// column ends up labelled as its neighbour.
//   aggKey  - field name when showing averages; key - field name in raw mode
//   fmt     - 'num' rounds to 1dp, 'pct' appends %, 'sign' shows +/-, 'text' as-is
//   group   - 'core' is always visible, 'advanced' hides behind the toggle
export default function StatsView() {
    const [filters, setFilters] = useState({
        season: '2025',
        min_cr: 0,
        max_cr: 35,
        position: 'All'
    });

    // Aggregation State (0 = All Games/Raw, X = Last X Games Average)
    const [aggregation, setAggregation] = useState(100);

    const [options, setOptions] = useState({
        positions: ['All'],
        min_cr_limit: 0,
        max_cr_limit: 35
    });

    // Which metric the backend's Score column holds for the selected season
    // (fantasy points for API-sourced seasons, PIR for the archives).
    const [scoreMetric, setScoreMetric] = useState('PIR');

    const [selectedColumns, setSelectedColumns] = useState(loadStoredColumns);
    // The modal is shared app-wide now, so this view only needs the opener.
    const openPlayer = useOpenPlayer();

    const [filtersReady, setFiltersReady] = useState(false);

    const [players, setPlayers] = useState([]);
    const [loading, setLoading] = useState(false);

    // Sorting State. Null key means "use the order the server sent", which is
    // already sorted by score - the previous default named a raw-mode key that does
    // not exist on aggregated rows, so every comparison hit the null branch and the
    // comparator became inconsistent.
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'desc' });

    // Sliders fire per drag step, so fetches follow the settled values while the
    // controls themselves stay live.
    const minCr = useDebouncedValue(filters.min_cr);
    const maxCr = useDebouncedValue(filters.max_cr);

    // Guards against an earlier, slower response overwriting a newer one.
    const requestSeq = useRef(0);

    // Load initial filters options
    useEffect(() => {
        setFiltersReady(false);
        loadFilters(filters.season);
    }, [filters.season]);

    const loadFilters = async (season) => {
        const data = await fetchFilters(season);
        if (data) {
            setOptions({
                positions: data.positions || ['All'],
                min_cr_limit: data.min_cr || 0,
                max_cr_limit: data.max_cr || 35
            });
            setScoreMetric(data.score_metric || 'PIR');
            // Only touch filters when a value actually changed. Returning a new
            // object unconditionally changed its identity, which refired the fetch
            // effect below and threw away the response already in flight.
            setFilters(prev => {
                const next = {
                    ...prev,
                    min_cr: data.min_cr || 0,
                    max_cr: data.max_cr || 35,
                    position: 'All'
                };
                const unchanged = prev.min_cr === next.min_cr
                    && prev.max_cr === next.max_cr
                    && prev.position === next.position;
                return unchanged ? prev : next;
            });
        }
        setFiltersReady(true);
    };

    // Depend on primitives, not the filters object: identity churn alone must not
    // trigger a refetch.
    // Nothing fetches until /api/filters has supplied the real CR bounds. Without
    // this the first render fired a request with placeholder bounds whose response
    // was immediately superseded - a wasted round trip on every mount.
    // Also wait for the debounced values to catch up with the live ones. Mid-drag
    // they differ, so this is what collapses a drag into a single request - and it
    // stops the mount firing once with placeholder bounds and again once the real
    // ones settle.
    const settled = minCr === filters.min_cr && maxCr === filters.max_cr;

    useEffect(() => {
        if (!filtersReady || !settled) return;
        loadTableStats();
    }, [filtersReady, settled, filters.season, filters.position, minCr, maxCr, aggregation]);

    const loadTableStats = async () => {
        const seq = ++requestSeq.current;
        setLoading(true);
        const params = {
            season: filters.season,
            position: filters.position,
            min_cr: minCr,
            max_cr: maxCr,
            last_x_games: aggregation
        };

        const data = await fetchStats(params);
        if (seq !== requestSeq.current) return; // a newer request has taken over
        setPlayers(data || []);
        setLoading(false);
    };

    const handleSeasonChange = (e) => {
        setFilters(prev => ({ ...prev, season: e.target.value }));
    };

    const requestSort = (key) => {
        let direction = 'desc';
        if (sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        }
        setSortConfig({ key, direction });
    };

    // A one-game window is not an average of anything, so drop the prefix rather
    // than label a single score "Avg".
    const headerFor = (col) => {
        const label = columnLabel(col, true, scoreMetric);
        return aggregation === 1 && typeof label === 'string'
            ? label.replace(/^Avg\s+/, '')
            : label;
    };

    // Memoized: this used to re-copy and re-sort the whole list on every render,
    // including renders caused only by the loading flag toggling.
    const sortedPlayers = useMemo(() => {
        let sortableItems = [...players];
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];

                // Handle numeric conversions if needed (though API returns mixed, usually numbers are numbers)
                // For aggregation fields which are strings sometimes or numbers
                if (typeof aValue === 'string' && !isNaN(aValue)) aValue = parseFloat(aValue);
                if (typeof bValue === 'string' && !isNaN(bValue)) bValue = parseFloat(bValue);

                // Handle nulls/undefined (push to bottom). Both-missing must compare
                // equal, or the comparator is inconsistent and the order scrambles.
                const aMissing = aValue === null || aValue === undefined || aValue === '';
                const bMissing = bValue === null || bValue === undefined || bValue === '';
                if (aMissing && bMissing) return 0;
                if (aMissing) return 1;
                if (bMissing) return -1;

                if (aValue < bValue) {
                    return sortConfig.direction === 'asc' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'asc' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [players, sortConfig]);

    // Which columns this season can actually fill. 2024 never recorded assists or
    // shooting splits, and the fantasy-sourced season has no minutes at all, so those
    // are offered as disabled rather than rendered as a wall of dashes.
    const availableColumns = useMemo(() => {
        const ids = new Set();
        for (const col of COLUMNS) {
            if (col.cat === 'Essentials' || !players.length) { ids.add(col.id); continue; }
            const key = columnKey(col, true);
            if (players.some(p => p[key] !== null && p[key] !== undefined && p[key] !== '')) {
                ids.add(col.id);
            }
        }
        return ids;
    }, [players, aggregation]);

    const visibleColumns = useMemo(
        () => COLUMNS.filter(col =>
            (col.locked || selectedColumns.includes(col.id)) && availableColumns.has(col.id)
        ),
        [selectedColumns, availableColumns]
    );

    const chooseColumns = (ids) => {
        // Keep the canonical column order regardless of the order they were ticked.
        const ordered = COLUMNS.filter(c => ids.includes(c.id)).map(c => c.id);
        setSelectedColumns(ordered);
        storeColumns(ordered);
    };

    const resetColumns = () => {
        setSelectedColumns(DEFAULT_COLUMN_IDS);
        storeColumns(DEFAULT_COLUMN_IDS);
    };

    return (
        <div className="space-y-6">
            <header className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold">Player Statistics</h2>
                    <p className="text-gray-400 text-sm">Explore performance data and aggregated analytics.</p>
                </div>
            </header>

            {/* Filters Bar */}
            <div className="glass-panel p-4 flex flex-wrap items-center gap-4">
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Season</label>
                    <select
                        value={filters.season}
                        onChange={handleSeasonChange}
                        className="input-dark bg-[#0a0a0c] min-w-[100px]"
                    >
                        <option value="2026">2026-27</option>
                        <option value="2025">2025-26</option>
                        <option value="2024">2024-25</option>
                        <option value="2023">2023-24</option>
                    </select>
                </div>

                <GamesWindowSelect value={aggregation} onChange={setAggregation} />

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Position</label>
                    <select
                        value={filters.position}
                        onChange={(e) => setFilters(prev => ({ ...prev, position: e.target.value }))}
                        className="input-dark bg-[#0a0a0c] min-w-[120px]"
                    >
                        {options.positions.map(p => (
                            <option key={p} value={p}>{p}</option>
                        ))}
                    </select>
                </div>

                {(
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Columns</label>
                        <ColumnPicker
                            columns={COLUMNS}
                            categories={COLUMN_CATEGORIES}
                            selected={selectedColumns}
                            available={availableColumns}
                            onChange={chooseColumns}
                            onReset={resetColumns}
                            defaultIds={DEFAULT_COLUMN_IDS}
                        />
                    </div>
                )}

                <CrRangeSlider
                    min={filters.min_cr}
                    max={filters.max_cr}
                    limitMin={options.min_cr_limit}
                    limitMax={options.max_cr_limit}
                    onChange={({ min, max }) => setFilters(prev => ({ ...prev, min_cr: min, max_cr: max }))}
                />
            </div>

            {loading && players.length === 0 && (
                <div className="w-full h-[400px] flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            )}

            {(players.length > 0 || !loading) && (
                <div className={`glass-panel overflow-hidden relative min-h-[400px] transition-opacity ${loading ? 'opacity-60' : ''}`}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-[#ffffff05] text-gray-400 font-medium uppercase text-xs">
                                <tr>
                                    {visibleColumns.map(col => (
                                        <Th
                                            key={col.id}
                                            label={headerFor(col)}
                                            sortKey={columnKey(col, true)}
                                            align={col.align}
                                            info={columnInfo(col, scoreMetric)}
                                            sortConfig={sortConfig}
                                            onSort={requestSort}
                                        />
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#ffffff08]">
                                    {sortedPlayers.map((player, idx) => (
                                        <tr
                                            key={`${player.PlayerID ?? player.PlayerName ?? 'row'}-${idx}`}
                                            onClick={() => openPlayer(player.PlayerName, filters.season)}
                                            className="hover:bg-[#ffffff03] transition-colors cursor-pointer"
                                        >
                                            {visibleColumns.map(col => {
                                                const value = player[columnKey(col, true)];
                                                if (col.fmt === 'player') {
                                                    return (
                                                        <td key={col.id} className="px-4 py-3 font-medium text-white whitespace-nowrap">
                                                            {player.PlayerName}
                                                            {player.InjuryStatus && (
                                                                // Abbreviated and tone-matched via the shared helper: the raw
                                                                // feed value for a game-time decision is the full phrase, which
                                                                // would widen this column well past the name it annotates.
                                                                <span
                                                                    title={player.InjuryStatus}
                                                                    className={`ml-2 text-[10px] px-1.5 py-0.5 rounded border ${statusOf(player.InjuryStatus).chip}`}
                                                                >
                                                                    {statusOf(player.InjuryStatus).short}
                                                                </span>
                                                            )}
                                                        </td>
                                                    );
                                                }
                                                const alignClass = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left';
                                                const toneClass = col.strong ? 'font-bold text-white' : col.id === 'CR' ? 'text-purple-300' : 'text-gray-400';
                                                const mono = col.fmt !== 'text' ? 'font-mono' : '';
                                                return (
                                                    <td key={col.id} className={`px-4 py-3 ${alignClass} ${mono} ${toneClass}`}>
                                                        {formatCell(value, col.fmt)}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}

                                {sortedPlayers.length === 0 && (
                                    <tr>
                                        <td colSpan={visibleColumns.length} className="px-4 py-12 text-center text-gray-500">
                                            No players found matching these filters.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

