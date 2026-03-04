import React, { useState, useEffect } from 'react';
import { fetchFilters, fetchStats, fetchAggregatedStats } from '../services/api';
import { Search, Filter, Download, List, TrendingUp, BarChart2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ScatterPlot from './charts/ScatterPlot';

export default function StatsView() {
    const [viewMode, setViewMode] = useState('table'); // 'table', 'consistency', 'efficiency'
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

    const [players, setPlayers] = useState([]);
    const [chartData, setChartData] = useState([]);
    const [loading, setLoading] = useState(false);

    // Sorting State
    const [sortConfig, setSortConfig] = useState({ key: 'PIR', direction: 'desc' });

    // Load initial filters options
    useEffect(() => {
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
            setFilters(prev => ({
                ...prev,
                min_cr: data.min_cr || 0,
                max_cr: data.max_cr || 35,
                position: 'All'
            }));
        }
    };

    useEffect(() => {
        if (viewMode === 'table') {
            loadTableStats();
        } else {
            loadChartStats();
        }
    }, [filters, viewMode, aggregation]);

    const loadTableStats = async () => {
        setLoading(true);
        // Pass last_x_games if aggregation > 0
        const params = { ...filters };
        if (aggregation > 0) {
            params.last_x_games = aggregation;
        } else {
            params.last_x_games = 0;
        }

        const data = await fetchStats(params);
        setPlayers(data || []);
        setLoading(false);
    };

    const loadChartStats = async () => {
        setLoading(true);
        // Charts always use aggregation, usually large window
        const data = await fetchAggregatedStats({ ...filters, last_x_games: 100 });
        setChartData(data || []);
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

    const getSortedPlayers = () => {
        let sortableItems = [...players];
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];

                // Handle numeric conversions if needed (though API returns mixed, usually numbers are numbers)
                // For aggregation fields which are strings sometimes or numbers
                if (typeof aValue === 'string' && !isNaN(aValue)) aValue = parseFloat(aValue);
                if (typeof bValue === 'string' && !isNaN(bValue)) bValue = parseFloat(bValue);

                // Handle nulls/undefined (push to bottom)
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
    };

    const sortedPlayers = getSortedPlayers();

    const SortIcon = ({ column }) => {
        if (sortConfig.key !== column) return <div className="w-4 h-4 inline-block ml-1 opacity-20">↕</div>;
        return (
            <div className="w-4 h-4 inline-block ml-1 text-purple-400">
                {sortConfig.direction === 'asc' ? '↑' : '↓'}
            </div>
        );
    };

    // Header helper to handle click and mapping to correct data key
    const Th = ({ label, sortKey, align = 'left' }) => (
        <th
            className={`px-6 py-4 cursor-pointer hover:bg-[#ffffff05] transition-colors text-${align}`}
            onClick={() => requestSort(sortKey)}
        >
            <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
                {label} <SortIcon column={sortKey} />
            </div>
        </th>
    );

    const HeaderButton = ({ mode, icon: Icon, label }) => (
        <button
            onClick={() => setViewMode(mode)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === mode
                ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20'
                : 'text-gray-400 hover:text-white hover:bg-[#ffffff05]'
                }`}
        >
            <Icon size={16} /> {label}
        </button>
    );

    return (
        <div className="space-y-6">
            <header className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold">Player Statistics</h2>
                    <p className="text-gray-400 text-sm">Explore performance data and aggregated analytics.</p>
                </div>
                <div className="flex gap-2 bg-[#ffffff03] p-1 rounded-xl border border-[#ffffff05]">
                    <HeaderButton mode="table" icon={List} label="Table" />
                    <HeaderButton mode="consistency" icon={BarChart2} label="Consistency" />
                    <HeaderButton mode="efficiency" icon={TrendingUp} label="Value" />
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
                        <option value="2025">2024-25</option>
                        <option value="2024">2023-24</option>
                        <option value="2023">2022-23</option>
                    </select>
                </div>

                {viewMode === 'table' && (
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">View As</label>
                        <select
                            value={aggregation}
                            onChange={(e) => setAggregation(parseInt(e.target.value))}
                            className="input-dark bg-[#0a0a0c] min-w-[140px] text-purple-400 font-medium"
                        >
                            <option value="100">Season Average</option>
                            <option value="3">Last 3 Games</option>
                            <option value="5">Last 5 Games</option>
                            <option value="10">Last 10 Games</option>
                            <option value="0">All Games (Raw)</option>
                        </select>
                    </div>
                )}

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

                <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                    <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
                        Cost Range ({filters.min_cr} - {filters.max_cr} CR)
                    </label>
                    <div className="flex items-center gap-2">
                        <input
                            type="range"
                            min={options.min_cr_limit}
                            max={options.max_cr_limit}
                            value={filters.max_cr}
                            onChange={(e) => setFilters(prev => ({ ...prev, max_cr: parseFloat(e.target.value) }))}
                            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        />
                    </div>
                </div>
            </div>

            {loading && (
                <div className="w-full h-[400px] flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            )}

            {!loading && viewMode === 'table' && (
                <div className="glass-panel overflow-hidden relative min-h-[400px]">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-[#ffffff05] text-gray-400 font-medium uppercase text-xs">
                                <tr>
                                    <Th label="Player" sortKey="PlayerName" />
                                    <Th label="Position" sortKey="position" />
                                    <Th label="Team" sortKey="Team" />
                                    <Th label="Cost (CR)" sortKey="CR" align="right" />

                                    <Th
                                        label={aggregation > 0 ? "Avg PIR" : "PIR"}
                                        sortKey={aggregation > 0 ? "Average_PIR" : "PIR"}
                                        align="right"
                                    />
                                    <Th
                                        label={aggregation > 0 ? "Avg Pts" : "Points"}
                                        sortKey={aggregation > 0 ? "Average_Points" : "Points"}
                                        align="right"
                                    />
                                    <Th
                                        label={aggregation > 0 ? "Avg Reb" : "Reb"}
                                        sortKey={aggregation > 0 ? "Average_Rebounds" : "TotalRebounds"}
                                        align="right"
                                    />
                                    <Th
                                        label={aggregation > 0 ? "Avg Ast" : "Ast"}
                                        sortKey={aggregation > 0 ? "Average_Assists" : "Assistances"}
                                        align="right"
                                    />

                                    <Th
                                        label={aggregation > 0 ? "Games" : "Round"}
                                        sortKey={aggregation > 0 ? "GamesPlayed" : "GameCode"}
                                        align="center"
                                    />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#ffffff08]">
                                <AnimatePresence>
                                    {sortedPlayers.map((player, idx) => (
                                        <motion.tr
                                            key={idx}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ delay: idx * 0.005, duration: 0.2 }}
                                            className="hover:bg-[#ffffff03] transition-colors"
                                        >
                                            <td className="px-6 py-3 font-medium text-white">
                                                {player.PlayerName}
                                                {player.InjuryStatus && (
                                                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">
                                                        {player.InjuryStatus}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-3 text-gray-300">{player.position}</td>
                                            <td className="px-6 py-3 text-gray-300">{player.Team || '-'}</td>
                                            <td className="px-6 py-3 text-right font-mono text-purple-300">{player.CR}</td>

                                            <td className="px-6 py-3 text-right font-mono font-bold text-white">
                                                {aggregation > 0
                                                    ? (player.Average_PIR || player.PIR || '-')
                                                    : (player.PIR || '-')}
                                            </td>
                                            <td className="px-6 py-3 text-right font-mono text-gray-400">
                                                {aggregation > 0
                                                    ? (player.Average_Points || player.Points || '-')
                                                    : (player.Points || '-')}
                                            </td>
                                            <td className="px-6 py-3 text-right font-mono text-gray-400">
                                                {aggregation > 0
                                                    ? (player.Average_Rebounds || player.TotalRebounds || '-')
                                                    : (player.TotalRebounds || '-')}
                                            </td>
                                            <td className="px-6 py-3 text-right font-mono text-gray-400">
                                                {aggregation > 0
                                                    ? (player.Average_Assists || player.Assistances || '-')
                                                    : (player.Assistances || '-')}
                                            </td>

                                            <td className="px-6 py-3 text-center text-gray-400">
                                                {aggregation > 0
                                                    ? (player.GamesPlayed || '-')
                                                    : (player.GameCode || '-')}
                                            </td>
                                        </motion.tr>
                                    ))}
                                </AnimatePresence>

                                {sortedPlayers.length === 0 && (
                                    <tr>
                                        <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
                                            No players found matching these filters.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {!loading && viewMode === 'consistency' && (
                <ScatterPlot
                    data={chartData}
                    xKey="StdDev_PIR"
                    yKey="Average_PIR"
                    xLabel="Consistency Risk (Std Dev)"
                    yLabel="Performance (Avg PIR)"
                    title="Consistency Analysis: Higher Performance & Lower Risk"
                />
            )}

            {!loading && viewMode === 'efficiency' && (
                <ScatterPlot
                    data={chartData}
                    xKey="CR"
                    yKey="Average_PIR"
                    xLabel="Cost (CR)"
                    yLabel="Performance (Avg PIR)"
                    title="Value Analysis: Cost vs Performance"
                />
            )}
        </div>
    );
}

