import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { fetchFilters, fetchStats } from '../services/api';
import { useOpenPlayer } from '../hooks/playerDetailContext';
import { Plus, Trash2, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import useDebouncedValue from '../hooks/useDebouncedValue';
import { COLUMNS, columnKey, columnLabel, loadStored, storeValue } from '../columns';
import ChartCanvas from './charts/ChartCanvas';
import ChartBuilderModal from './ChartBuilderModal';
import CrRangeSlider from './CrRangeSlider';
import GamesWindowSelect from './GamesWindowSelect';

const CHARTS_STORAGE_KEY = 'euroguru.courtVision.charts';

// The charts the tab ships with. They can be collapsed and reordered like any
// other, but not deleted. Quadrants are on because reading these is precisely
// about which quarter a player falls in.
const BUILT_INS = [
    {
        id: 'builtin-consistency',
        builtIn: true,
        title: 'Consistency — high output, low volatility',
        x: 'StdDev', y: 'Score',
        layers: { colorBy: false, quadrants: true, labels: true, sizeBy: null },
    },
    {
        id: 'builtin-value',
        builtIn: true,
        title: 'Value — output against price',
        x: 'CR', y: 'Score',
        layers: { colorBy: false, quadrants: true, labels: true, sizeBy: null },
    },
    {
        id: 'builtin-price-history',
        builtIn: true,
        // `kind` marks a chart that draws itself from its own data source rather than
        // from two columns of the player table; it has no x/y at all.
        kind: 'priceHistory',
        title: 'Price Tracker — what players cost over time',
        subtitle: 'CR by snapshot date',
    },
];

/**
 * Restore saved charts, then append any built-in that is not already among them.
 *
 * Order, collapsed state and layers all persist, so a built-in dragged to the
 * bottom stays there. Appending missing built-ins means a new one added in a later
 * release still shows up for someone with existing saved charts.
 */
const initialCharts = () => {
    const saved = loadStored(CHARTS_STORAGE_KEY, null);
    if (!Array.isArray(saved) || !saved.length) return BUILT_INS.map(c => ({ ...c }));

    const known = saved.filter(c => c && (c.kind || (c.x && c.y && c.layers)));
    const missing = BUILT_INS.filter(b => !known.some(c => c.id === b.id));
    return [...known, ...missing.map(c => ({ ...c }))];
};

export default function CourtVisionView() {
    const [filters, setFilters] = useState({ season: '2025', min_cr: 0, max_cr: 35, position: 'All' });
    const [options, setOptions] = useState({ positions: ['All'], min_cr_limit: 0, max_cr_limit: 35 });
    const [scoreMetric, setScoreMetric] = useState('PIR');
    const [loadedSeason, setLoadedSeason] = useState(null);
    const [aggregation, setAggregation] = useState(100);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);

    const [charts, setCharts] = useState(initialCharts);
    const [building, setBuilding] = useState(false);
    const [dragId, setDragId] = useState(null);
    const [dropId, setDropId] = useState(null);

    const openPlayer = useOpenPlayer();
    // Bound to the season in view, and passed only to saved charts - the builder's
    // preview leaves it undefined so its points stay inert.
    const openChartPlayer = useCallback(
        (name) => openPlayer(name, filters.season),
        [openPlayer, filters.season]
    );

    const minCr = useDebouncedValue(filters.min_cr);
    const maxCr = useDebouncedValue(filters.max_cr);
    const requestSeq = useRef(0);
    const nextChartId = useRef(1);

    const loadRows = () => {
        const seq = ++requestSeq.current;
        let done = false;

        // Field order matches StatsView's loadTableStats so the api.js cache key
        // (JSON.stringify of the params) matches and the two tabs share a response.
        fetchStats({
            season: filters.season,
            position: filters.position,
            min_cr: minCr,
            max_cr: maxCr,
            last_x_games: aggregation,
        }).then(data => {
            done = true;
            if (seq !== requestSeq.current) return;
            setRows(data || []);
            setLoading(false);
        });

        // A cached response resolves in a microtask, so only announce loading once
        // the request has proved slow - that avoids a spinner flash on every tab
        // switch and keeps the state update off the effect's synchronous path.
        setTimeout(() => {
            if (!done && seq === requestSeq.current) setLoading(true);
        }, 120);
    };

    // Updates live in the promise callback rather than the effect body: setState
    // straight from an effect cascades a render, and this also gives the season
    // change a cancellation path so a slow response cannot overwrite a newer one.
    useEffect(() => {
        let alive = true;
        const season = filters.season;
        fetchFilters(season).then(data => {
            if (!alive) return;
            if (data) {
                setOptions({
                    positions: data.positions || ['All'],
                    min_cr_limit: data.min_cr || 0,
                    max_cr_limit: data.max_cr || 35,
                });
                setScoreMetric(data.score_metric || 'PIR');
                setFilters(prev => {
                    const min_cr = data.min_cr || 0;
                    const max_cr = data.max_cr || 35;
                    if (prev.min_cr === min_cr && prev.max_cr === max_cr) return prev;
                    return { ...prev, min_cr, max_cr };
                });
            }
            setLoadedSeason(season);
        });
        return () => { alive = false; };
    }, [filters.season]);

    // Derived rather than stored: options belong to whichever season last loaded.
    const filtersReady = loadedSeason === filters.season;

    const settled = minCr === filters.min_cr && maxCr === filters.max_cr;

    useEffect(() => {
        if (!filtersReady || !settled) return;
        loadRows();
    }, [filtersReady, settled, filters.season, filters.position, minCr, maxCr, aggregation]);

    // Which columns this season can actually fill, so an axis that would plot
    // nothing is offered as disabled rather than silently producing an empty chart.
    const available = useMemo(() => {
        const ids = new Set();
        for (const col of COLUMNS) {
            if (col.axis === 'none') continue;
            const key = columnKey(col, true);
            if (!rows.length || rows.some(r => r[key] !== null && r[key] !== undefined && r[key] !== '')) {
                ids.add(col.id);
            }
        }
        return ids;
    }, [rows]);

    const axisCandidates = useMemo(() => COLUMNS.filter(c => c.axis !== 'none'), []);
    const sizeOptions = useMemo(
        () => COLUMNS.filter(c => c.axis === 'numeric' && available.has(c.id)),
        [available]
    );

    const persist = (next) => {
        setCharts(next);
        storeValue(CHARTS_STORAGE_KEY, next);
    };

    const addChart = (config) => {
        persist([...charts, {
            ...config,
            id: `chart-${Date.now().toString(36)}-${nextChartId.current++}`,
            collapsed: false,
        }]);
        setBuilding(false);
    };

    const updateChart = (updated) => persist(charts.map(c => (c.id === updated.id ? updated : c)));
    const removeChart = (id) => persist(charts.filter(c => c.id !== id));
    const toggleCollapse = (id) =>
        persist(charts.map(c => (c.id === id ? { ...c, collapsed: !c.collapsed } : c)));

    // Reorder by dropping one panel onto another; the dragged chart takes the
    // target's slot and everything else closes up around it.
    const handleDrop = (targetId) => {
        if (!dragId || dragId === targetId) return setDropId(null);
        const from = charts.findIndex(c => c.id === dragId);
        const to = charts.findIndex(c => c.id === targetId);
        if (from < 0 || to < 0) return setDropId(null);
        const next = [...charts];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        persist(next);
        setDragId(null);
        setDropId(null);
    };

    const labelFor = (col) => columnLabel(col, true, scoreMetric);
    const colById = (id) => COLUMNS.find(c => c.id === id);

    return (
        <div className="space-y-6">
            {building && (
                <ChartBuilderModal
                    rows={rows}
                    available={available}
                    scoreMetric={scoreMetric}
                    sizeOptions={sizeOptions}
                    axisCandidates={axisCandidates}
                    onSave={addChart}
                    onClose={() => setBuilding(false)}
                />
            )}

            <header className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold">Court Vision</h2>
                    <p className="text-gray-400 text-sm">
                        See the whole player pool at once — and build the view you actually need.
                    </p>
                </div>
                <button
                    onClick={() => setBuilding(true)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors
                               bg-purple-600/20 text-purple-300 border-purple-500/40 hover:bg-purple-600/30"
                >
                    <Plus size={15} /> New chart
                </button>
            </header>

            {/* Filters */}
            <div className="glass-panel p-4 flex flex-wrap items-center gap-4">
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
                <GamesWindowSelect value={aggregation} onChange={setAggregation} />

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Position</label>
                    <select
                        value={filters.position}
                        onChange={(e) => setFilters(prev => ({ ...prev, position: e.target.value }))}
                        className="input-dark bg-[#0a0a0c] min-w-[110px]"
                    >
                        {options.positions.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                </div>
                <CrRangeSlider
                    min={filters.min_cr}
                    max={filters.max_cr}
                    limitMin={options.min_cr_limit}
                    limitMax={options.max_cr_limit}
                    onChange={({ min, max }) => setFilters(prev => ({ ...prev, min_cr: min, max_cr: max }))}
                />
                <span className="text-xs text-gray-500">{rows.length} players</span>
            </div>

            {loading && rows.length === 0 && (
                <div className="w-full h-[300px] flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            )}

            {/* Charts */}
            <div className={`space-y-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
                {charts.map(chart => {
                    const x = colById(chart.x);
                    const y = colById(chart.y);
                    // A `kind` chart supplies its own axes; only column-driven charts
                    // need both ends to resolve before they can be drawn.
                    if (!chart.kind && (!x || !y)) return null;
                    const subtitle = chart.kind
                        ? chart.subtitle
                        : (chart.title !== `${labelFor(y)} vs ${labelFor(x)}`
                            ? `${labelFor(y)} vs ${labelFor(x)}`
                            : null);
                    const isDropTarget = dropId === chart.id && dragId !== chart.id;

                    return (
                        <div
                            key={chart.id}
                            onDragOver={(e) => { e.preventDefault(); setDropId(chart.id); }}
                            onDragLeave={() => setDropId(prev => (prev === chart.id ? null : prev))}
                            onDrop={() => handleDrop(chart.id)}
                            className={`glass-panel p-4 transition-all ${dragId === chart.id ? 'opacity-40' : ''} ${
                                isDropTarget ? 'ring-2 ring-purple-500/60' : ''}`}
                        >
                            <div
                                draggable
                                onDragStart={() => setDragId(chart.id)}
                                onDragEnd={() => { setDragId(null); setDropId(null); }}
                                className="flex items-start justify-between gap-3 cursor-grab active:cursor-grabbing"
                            >
                                <div className="flex items-start gap-2 min-w-0">
                                    <GripVertical size={16} className="text-gray-600 mt-0.5 shrink-0" />
                                    <button
                                        onClick={() => toggleCollapse(chart.id)}
                                        className="flex items-start gap-2 text-left min-w-0"
                                    >
                                        {chart.collapsed
                                            ? <ChevronRight size={16} className="text-gray-500 mt-0.5 shrink-0" />
                                            : <ChevronDown size={16} className="text-gray-500 mt-0.5 shrink-0" />}
                                        <span className="min-w-0">
                                            <span className="block font-semibold text-gray-100 truncate">{chart.title}</span>
                                            {subtitle && (
                                                <span className="block text-xs text-gray-500">{subtitle}</span>
                                            )}
                                        </span>
                                    </button>
                                </div>
                                {!chart.builtIn && (
                                    <button
                                        onClick={() => removeChart(chart.id)}
                                        className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10
                                                   transition-colors shrink-0"
                                        aria-label="Remove chart"
                                    >
                                        <Trash2 size={15} />
                                    </button>
                                )}
                            </div>

                            {!chart.collapsed && (
                                <div className="mt-3">
                                    <ChartCanvas
                                        chart={chart}
                                        rows={rows}
                                        available={available}
                                        scoreMetric={scoreMetric}
                                        season={filters.season}
                                        games={aggregation}
                                        onSelectPlayer={openChartPlayer}
                                        showLayers
                                        sizeOptions={sizeOptions}
                                        onChange={updateChart}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
