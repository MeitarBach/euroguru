import React, { useState, useEffect, useMemo, useRef } from 'react';
import { fetchFilters, fetchRecommendations } from '../services/api';
import { TrendingUp, Sliders, Award, Target } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import useDebouncedValue from '../hooks/useDebouncedValue';
import { useOpenPlayer } from '../hooks/playerDetailContext';
import usePriceTrend from '../hooks/usePriceTrend';
import PriceTrend from './charts/PriceTrend';
import CrRangeSlider from './CrRangeSlider';
import ColumnPicker from './ColumnPicker';
import InfoTip from './InfoTip';
import { shortName, columnKey, columnLabel, columnInfo, formatCell } from '../columns';
import {
    REC_COLUMNS, REC_COLUMN_CATEGORIES, REC_DEFAULT_IDS,
    loadRecColumns, storeRecColumns,
} from '../recommendationColumns';
import { useIsNarrow } from '../hooks/useMediaQuery';
import GamesWindowSelect from './GamesWindowSelect';

const SortIcon = ({ column, sortConfig }) => {
    if (sortConfig.key !== column) return <div className="w-4 h-4 inline-block ml-1 opacity-20">↕</div>;
    return (
        <div className="w-4 h-4 inline-block ml-1 text-purple-400">
            {sortConfig.direction === 'asc' ? '↑' : '↓'}
        </div>
    );
};

// See StatsView for the derivation: opaque tones matching what the layered translucent
// classes already resolve to, so a sticky cell looks identical but nothing scrolls
// through it.
// ColumnPicker greys out columns a season has no data for. Every field here
// arrives from the same response, so nothing is ever unavailable.
const ALL_AVAILABLE = { has: () => true };

const STICKY_HEAD = 'sticky left-0 z-20 bg-[#19191b]';
const STICKY_CELL = 'sticky left-0 z-10 bg-[#0d0d0f] group-hover:bg-[#141416]';

const Th = ({ label, sortKey, align = 'left', sortConfig, onSort, sticky, info, sortable = true }) => (
    <th
        className={`px-3 md:px-6 py-4 transition-colors text-${align} whitespace-nowrap
                    ${sortable ? 'cursor-pointer hover:bg-[#ffffff05]' : ''} ${sticky ? STICKY_HEAD : ''}`}
        onClick={sortable ? () => onSort(sortKey) : undefined}
    >
        <div className={`flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
            {label}
            {info && <InfoTip text={info} />}
            {sortable && <SortIcon column={sortKey} sortConfig={sortConfig} />}
        </div>
    </th>
);

// Module-level so it keeps a stable component identity. Declared inside the
// component body it was a new type on every render, remounting all four sliders
// mid-drag.
const SliderControl = ({ label, value, onChange, min, max, step, description }) => (
    <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">{label}</label>
            <span className="text-sm font-mono text-purple-400">{value.toFixed(2)}</span>
        </div>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={onChange}
            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
        />
        {description && <p className="text-xs text-gray-500">{description}</p>}
    </div>
);

export default function RecommendationsView() {
    const [filters, setFilters] = useState({
        season: '2025',
        min_cr: 0,
        max_cr: 35,
        last_x_games: 5,
        alpha: 0.85,
        weight_efficiency: 2.0,
        weight_mean_pir: 1.0,
        weight_consistency: 1.0
    });

    const [options, setOptions] = useState({
        min_cr_limit: 0,
        max_cr_limit: 35
    });

    // Windowed to the same games selector the ranking uses, so the sparkline in a
    // row covers the stretch its numbers were computed over.
    const { trendFor } = usePriceTrend(filters.season, filters.last_x_games);
    const openPlayer = useOpenPlayer();
    // Abbreviates the given name on a phone; see StatsView.
    const narrow = useIsNarrow();

    // The endpoint returns the same per-player aggregates the stats table uses, so
    // this tab can offer them too rather than only the four ranking figures.
    const [selectedColumns, setSelectedColumns] = useState(loadRecColumns);
    const visibleColumns = useMemo(
        () => REC_COLUMNS.filter(c => selectedColumns.includes(c.id)),
        [selectedColumns],
    );
    const chooseColumns = (ids) => {
        setSelectedColumns(ids);
        storeRecColumns(ids);
    };

    // Which metric the backend's Score column holds for the selected season.
    const [scoreMetric, setScoreMetric] = useState('PIR');

    const [filtersReady, setFiltersReady] = useState(false);

    const [recommendations, setRecommendations] = useState([]);
    const [loading, setLoading] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: 'RecScore', direction: 'desc' });
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Every one of the six sliders fires per drag step; fetches follow the settled
    // values while the controls stay responsive.
    const minCr = useDebouncedValue(filters.min_cr);
    const maxCr = useDebouncedValue(filters.max_cr);
    const alpha = useDebouncedValue(filters.alpha);
    const wEff = useDebouncedValue(filters.weight_efficiency);
    const wMean = useDebouncedValue(filters.weight_mean_pir);
    const wCons = useDebouncedValue(filters.weight_consistency);

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
                min_cr_limit: data.min_cr || 0,
                max_cr_limit: data.max_cr || 35
            });
            setScoreMetric(data.score_metric || 'PIR');
            // Only update when a value actually changed - a fresh object identity
            // alone used to refire the fetch effect and waste a request.
            setFilters(prev => {
                const min_cr = data.min_cr || 0;
                const max_cr = data.max_cr || 35;
                if (prev.min_cr === min_cr && prev.max_cr === max_cr) return prev;
                return { ...prev, min_cr, max_cr };
            });
        }
        setFiltersReady(true);
    };

    // Primitive deps only: identity churn on the filters object must not refetch.
    // Nothing fetches until /api/filters has supplied the real CR bounds. Without
    // this the first render fired a request with placeholder bounds whose response
    // was immediately superseded - a wasted round trip on every mount.
    // Also wait for every debounced value to catch up with its live counterpart.
    // Mid-drag they differ, which is what collapses a drag into one request.
    const settled = minCr === filters.min_cr
        && maxCr === filters.max_cr
        && alpha === filters.alpha
        && wEff === filters.weight_efficiency
        && wMean === filters.weight_mean_pir
        && wCons === filters.weight_consistency;

    useEffect(() => {
        if (!filtersReady || !settled) return;
        loadRecommendations();
    }, [filtersReady, settled, filters.season, filters.last_x_games, minCr, maxCr, alpha, wEff, wMean, wCons]);

    const loadRecommendations = async () => {
        const seq = ++requestSeq.current;
        setLoading(true);
        const data = await fetchRecommendations({
            season: filters.season,
            last_x_games: filters.last_x_games,
            min_cr: minCr,
            max_cr: maxCr,
            alpha,
            weight_efficiency: wEff,
            weight_mean_pir: wMean,
            weight_consistency: wCons
        });
        if (seq !== requestSeq.current) return; // a newer request has taken over
        setRecommendations(data || []);
        setLoading(false);
    };

    const requestSort = (key) => {
        let direction = 'desc';
        if (sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        }
        setSortConfig({ key, direction });
    };

    // Rank by RecScore, fixed independently of how the table happens to be sorted.
    // It used to be the row index, so sorting by any other column handed the medals
    // and the TOP PICK badge to whoever floated to the top - labelling a 20.37 as the
    // best pick while a 21.29 sat below it.
    const rankByPlayer = useMemo(() => {
        const ranked = [...recommendations].sort((a, b) => (b.RecScore ?? -Infinity) - (a.RecScore ?? -Infinity));
        return new Map(ranked.map((p, i) => [p.PlayerName, i]));
    }, [recommendations]);

    const sortedRecommendations = useMemo(() => {
        let sortableItems = [...recommendations];
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];

                if (typeof aValue === 'string' && !isNaN(aValue)) aValue = parseFloat(aValue);
                if (typeof bValue === 'string' && !isNaN(bValue)) bValue = parseFloat(bValue);

                if (aValue === null || aValue === undefined) return 1;
                if (bValue === null || bValue === undefined) return -1;

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
    }, [recommendations, sortConfig]);

    return (
        <div className="space-y-6">
            {/* Stacks below sm: the title and this button cannot share a phone-width
                row, and justify-between pushed the button past the viewport edge. */}
            <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                        <TrendingUp className="text-purple-400 shrink-0" />
                        Smart Recommendations
                    </h2>
                    <p className="text-gray-400 text-sm">AI-powered player suggestions based on efficiency and consistency.</p>
                </div>
                <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className={`flex items-center gap-2 shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-all ${showAdvanced
                        ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20'
                        : 'text-gray-400 hover:text-white hover:bg-[#ffffff05] border border-[#ffffff10]'
                        }`}
                >
                    <Sliders size={16} />
                    Advanced Settings
                </button>
            </header>

            {/* Basic Filters */}
            <div className="glass-panel p-4 space-y-4">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Season</label>
                        <select
                            value={filters.season}
                            onChange={(e) => setFilters(prev => ({ ...prev, season: e.target.value }))}
                            className="input-dark bg-[#0a0a0c] min-w-[100px]"
                        >
                            <option value="2026">2026-27</option>
                            <option value="2025">2025-26</option>
                            <option value="2024">2024-25</option>
                            <option value="2023">2023-24</option>
                        </select>
                    </div>

                    <GamesWindowSelect
                        value={filters.last_x_games}
                        onChange={(v) => setFilters(prev => ({ ...prev, last_x_games: v }))}
                    />

                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Columns</label>
                        {/* `available` is every column: unlike the stats table, these rows
                            all come from one endpoint that either returns a field for
                            everyone or for no one, so there is nothing to grey out. */}
                        <ColumnPicker
                            columns={REC_COLUMNS}
                            categories={REC_COLUMN_CATEGORIES}
                            selected={selectedColumns}
                            available={ALL_AVAILABLE}
                            onChange={chooseColumns}
                            onReset={() => chooseColumns(REC_DEFAULT_IDS)}
                            defaultIds={REC_DEFAULT_IDS}
                        />
                    </div>

                    {/* Was two independent sliders side by side, which let the minimum be
                        dragged above the maximum and return nothing. One control, two
                        thumbs, each clamped by the other. */}
                    <CrRangeSlider
                        min={filters.min_cr}
                        max={filters.max_cr}
                        limitMin={options.min_cr_limit}
                        limitMax={options.max_cr_limit}
                        onChange={({ min, max }) => setFilters(prev => ({ ...prev, min_cr: min, max_cr: max }))}
                    />
                </div>

                {/* Advanced Settings */}
                <AnimatePresence>
                    {showAdvanced && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.3 }}
                            className="pt-4 border-t border-[#ffffff10]"
                        >
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <SliderControl
                                    label="Alpha (Decay Factor)"
                                    value={filters.alpha}
                                    onChange={(e) => setFilters(prev => ({ ...prev, alpha: parseFloat(e.target.value) }))}
                                    min={0.5}
                                    max={1.0}
                                    step={0.05}
                                    description="Higher = more weight on older games"
                                />
                                <SliderControl
                                    label="Efficiency Weight"
                                    value={filters.weight_efficiency}
                                    onChange={(e) => setFilters(prev => ({ ...prev, weight_efficiency: parseFloat(e.target.value) }))}
                                    min={0.5}
                                    max={3.0}
                                    step={0.1}
                                    description="Importance of PIR/CR ratio"
                                />
                                <SliderControl
                                    label="Mean PIR Weight"
                                    value={filters.weight_mean_pir}
                                    onChange={(e) => setFilters(prev => ({ ...prev, weight_mean_pir: parseFloat(e.target.value) }))}
                                    min={0.5}
                                    max={2.0}
                                    step={0.1}
                                    description="Importance of raw performance"
                                />
                                <SliderControl
                                    label="Consistency Weight"
                                    value={filters.weight_consistency}
                                    onChange={(e) => setFilters(prev => ({ ...prev, weight_consistency: parseFloat(e.target.value) }))}
                                    min={0.5}
                                    max={2.0}
                                    step={0.1}
                                    description="Penalty for volatility"
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Loading State */}
            {loading && (
                <div className="w-full h-[400px] flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            )}

            {/* Recommendations Table */}
            {!loading && (
                <div className="glass-panel overflow-hidden relative min-h-[400px]">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs md:text-sm">
                            <thead className="bg-[#ffffff05] text-gray-400 font-medium uppercase text-xs">
                                <tr>
                                    {/* The medal is decorative on a phone: rows are already in
                                        rank order and the top three carry a TOP PICK badge. Hiding it
                                        frees ~80px and lets Player be the sticky column. */}
                                    <th className="hidden md:table-cell px-6 py-4">
                                        <div className="flex items-center gap-1">
                                            Rank
                                        </div>
                                    </th>
                                    {visibleColumns.map(col => (
                                        <Th
                                            key={col.id}
                                            label={columnLabel(col, true, scoreMetric)}
                                            sortKey={columnKey(col, true)}
                                            align={col.align}
                                            info={columnInfo(col, scoreMetric)}
                                            sortConfig={sortConfig}
                                            onSort={requestSort}
                                            sticky={col.fmt === 'player'}
                                            // The price trend cell is a chart; the figure
                                            // behind it is the CR column, so sort there.
                                            sortable={col.sortable !== false}
                                        />
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#ffffff08]">
                                    {sortedRecommendations.map((player, idx) => {
                                        const rank = rankByPlayer.get(player.PlayerName) ?? idx;
                                        const isTopPick = rank < 3;
                                        return (
                                            <tr
                                                key={player.PlayerName ?? idx}
                                                onClick={() => openPlayer(player.PlayerName, filters.season)}
                                                className={`group hover:bg-[#ffffff03] transition-colors cursor-pointer ${isTopPick ? 'bg-gradient-to-r from-purple-500/5 to-transparent' : ''
                                                    }`}
                                            >
                                                <td className="hidden md:table-cell px-6 py-3">
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${isTopPick
                                                        ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-black'
                                                        : 'bg-[#ffffff10] text-gray-400'
                                                        }`}>
                                                        {rank === 0 && '🥇'}
                                                        {rank === 1 && '🥈'}
                                                        {rank === 2 && '🥉'}
                                                        {rank > 2 && (rank + 1)}
                                                    </div>
                                                </td>
                                                {visibleColumns.map(col => {
                                                    if (col.fmt === 'player') {
                                                        return (
                                                            <td key={col.id} className={`px-3 md:px-6 py-3 font-medium text-white whitespace-nowrap ${STICKY_CELL}`}>
                                                                {narrow ? shortName(player.PlayerName) : player.PlayerName}
                                                                {isTopPick && (
                                                                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">
                                                                        TOP PICK
                                                                    </span>
                                                                )}
                                                            </td>
                                                        );
                                                    }
                                                    if (col.fmt === 'trend') {
                                                        return (
                                                            <td key={col.id} className="px-3 md:px-4 py-3">
                                                                <PriceTrend trend={trendFor(player)} />
                                                            </td>
                                                        );
                                                    }
                                                    const value = player[columnKey(col, true)];
                                                    const alignClass = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left';
                                                    const tone = col.id === 'RecScore' ? 'font-bold text-purple-400'
                                                        : col.id === 'Efficiency' ? 'text-green-400'
                                                        : col.id === 'ExpWeightedScore' ? 'text-white'
                                                        : col.id === 'CR' ? 'text-purple-300'
                                                        : col.strong ? 'font-bold text-white' : 'text-gray-400';
                                                    const mono = col.fmt !== 'text' ? 'font-mono' : '';
                                                    return (
                                                        <td
                                                            key={col.id}
                                                            className={`px-3 md:px-6 py-3 ${alignClass} ${mono} ${tone}`}
                                                            title={col.id === 'Team' ? player.Team : undefined}
                                                        >
                                                            {col.id === 'Team' && narrow
                                                                ? (player.TeamCode ?? formatCell(value, col.fmt))
                                                                : formatCell(value, col.fmt)}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}

                                {sortedRecommendations.length === 0 && (
                                    <tr>
                                        <td colSpan={visibleColumns.length + 1} className="px-6 py-12 text-center text-gray-500">
                                            No recommendations found. Try adjusting your filters.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Info Footer */}
                    {sortedRecommendations.length > 0 && (
                        <div className="px-6 py-4 bg-[#ffffff03] border-t border-[#ffffff08] flex items-center gap-2 text-xs text-gray-500">
                            <Target size={14} className="text-purple-400" />
                            Showing top {sortedRecommendations.length} recommendations based on your criteria
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
