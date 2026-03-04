import React, { useState, useEffect } from 'react';
import { fetchFilters, fetchRecommendations } from '../services/api';
import { TrendingUp, Sliders, Award, Target } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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

    const [recommendations, setRecommendations] = useState([]);
    const [loading, setLoading] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: 'Score', direction: 'desc' });
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Load initial filters options
    useEffect(() => {
        loadFilters(filters.season);
    }, [filters.season]);

    const loadFilters = async (season) => {
        const data = await fetchFilters(season);
        if (data) {
            setOptions({
                min_cr_limit: data.min_cr || 0,
                max_cr_limit: data.max_cr || 35
            });
            setFilters(prev => ({
                ...prev,
                min_cr: data.min_cr || 0,
                max_cr: data.max_cr || 35
            }));
        }
    };

    useEffect(() => {
        loadRecommendations();
    }, [filters]);

    const loadRecommendations = async () => {
        setLoading(true);
        const data = await fetchRecommendations(filters);
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

    const getSortedRecommendations = () => {
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
    };

    const sortedRecommendations = getSortedRecommendations();

    const SortIcon = ({ column }) => {
        if (sortConfig.key !== column) return <div className="w-4 h-4 inline-block ml-1 opacity-20">↕</div>;
        return (
            <div className="w-4 h-4 inline-block ml-1 text-purple-400">
                {sortConfig.direction === 'asc' ? '↑' : '↓'}
            </div>
        );
    };

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

    return (
        <div className="space-y-6">
            <header className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                        <TrendingUp className="text-purple-400" />
                        Smart Recommendations
                    </h2>
                    <p className="text-gray-400 text-sm">AI-powered player suggestions based on efficiency and consistency.</p>
                </div>
                <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${showAdvanced
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
                            <option value="2025">2024-25</option>
                            <option value="2024">2023-24</option>
                            <option value="2023">2022-23</option>
                        </select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Last X Games</label>
                        <select
                            value={filters.last_x_games}
                            onChange={(e) => setFilters(prev => ({ ...prev, last_x_games: parseInt(e.target.value) }))}
                            className="input-dark bg-[#0a0a0c] min-w-[120px]"
                        >
                            <option value="3">Last 3 Games</option>
                            <option value="5">Last 5 Games</option>
                            <option value="10">Last 10 Games</option>
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
                                value={filters.min_cr}
                                onChange={(e) => setFilters(prev => ({ ...prev, min_cr: parseFloat(e.target.value) }))}
                                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                            />
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
                        <table className="w-full text-left text-sm">
                            <thead className="bg-[#ffffff05] text-gray-400 font-medium uppercase text-xs">
                                <tr>
                                    <th className="px-6 py-4">
                                        <div className="flex items-center gap-1">
                                            Rank
                                        </div>
                                    </th>
                                    <Th label="Player" sortKey="PlayerName" />
                                    <Th label="Position" sortKey="position" />
                                    <Th label="Cost (CR)" sortKey="CR" align="right" />
                                    <Th label="Exp Weighted PIR" sortKey="ExpWeightedPIR" align="right" />
                                    <Th label="Efficiency" sortKey="Efficiency" align="right" />
                                    <Th label="Std Error" sortKey="StdErr" align="right" />
                                    <Th label="Score" sortKey="Score" align="right" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#ffffff08]">
                                <AnimatePresence>
                                    {sortedRecommendations.map((player, idx) => {
                                        const isTopPick = idx < 3;
                                        return (
                                            <motion.tr
                                                key={idx}
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0 }}
                                                transition={{ delay: idx * 0.01, duration: 0.2 }}
                                                className={`hover:bg-[#ffffff03] transition-colors ${isTopPick ? 'bg-gradient-to-r from-purple-500/5 to-transparent' : ''
                                                    }`}
                                            >
                                                <td className="px-6 py-3">
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${isTopPick
                                                        ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-black'
                                                        : 'bg-[#ffffff10] text-gray-400'
                                                        }`}>
                                                        {idx === 0 && '🥇'}
                                                        {idx === 1 && '🥈'}
                                                        {idx === 2 && '🥉'}
                                                        {idx > 2 && (idx + 1)}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-3 font-medium text-white">
                                                    {player.PlayerName}
                                                    {isTopPick && (
                                                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">
                                                            TOP PICK
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-3 text-gray-300">{player.position}</td>
                                                <td className="px-6 py-3 text-right font-mono text-purple-300">
                                                    {typeof player.CR === 'number' ? player.CR.toFixed(1) : player.CR}
                                                </td>
                                                <td className="px-6 py-3 text-right font-mono text-white">
                                                    {typeof player.ExpWeightedPIR === 'number' ? player.ExpWeightedPIR.toFixed(2) : player.ExpWeightedPIR}
                                                </td>
                                                <td className="px-6 py-3 text-right font-mono text-green-400">
                                                    {typeof player.Efficiency === 'number' ? player.Efficiency.toFixed(3) : player.Efficiency}
                                                </td>
                                                <td className="px-6 py-3 text-right font-mono text-gray-400">
                                                    {typeof player.StdErr === 'number' ? player.StdErr.toFixed(2) : player.StdErr}
                                                </td>
                                                <td className="px-6 py-3 text-right font-mono font-bold text-purple-400">
                                                    {typeof player.Score === 'number' ? player.Score.toFixed(2) : player.Score}
                                                </td>
                                            </motion.tr>
                                        );
                                    })}
                                </AnimatePresence>

                                {sortedRecommendations.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
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
