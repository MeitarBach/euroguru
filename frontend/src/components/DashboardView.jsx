import React, { useState, useEffect } from 'react';
import { fetchDashboardData } from '../services/api';
import { TrendingUp, Activity, AlertCircle, Award, Flame, Target, Banknote } from 'lucide-react';
import { useOpenPlayer } from '../hooks/playerDetailContext';
import usePriceTrend from '../hooks/usePriceTrend';
import PriceTrend from './charts/PriceTrend';

// The dashboard has no season selector; it has always reported on this one. Named so
// the price history and the detail view cannot drift from the widgets.
const DASHBOARD_SEASON = '2025';

// Rendered as plain elements rather than animated ones. A staggered entrance that
// starts at opacity 0 leaves the widgets blank whenever the animation frames do not
// run - a backgrounded tab, for instance - and the delay only postponed content the
// user is waiting for.
const PlayerCard = ({ player, rank, type, metric = 'PIR', trend, onOpen }) => (
    <div
        onClick={() => onOpen?.(player.PlayerName)}
        className="flex items-center gap-3 p-3 rounded-xl bg-[#ffffff05] hover:bg-[#ffffff08] transition-colors border border-white/5 cursor-pointer"
    >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm
            ${rank === 1 ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30' :
                rank === 2 ? 'bg-gray-400/20 text-gray-300 border border-gray-400/30' :
                    rank === 3 ? 'bg-orange-700/20 text-orange-400 border border-orange-700/30' :
                        'bg-gray-800 text-gray-500'}`}
        >
            {rank}
        </div>
        <div className="flex-1 min-w-0">
            <div className="font-medium text-white truncate">{player.PlayerName}</div>
            <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>{player.Team}</span>
                <span>•</span>
                <span>{player.position}</span>
            </div>
            {/* Price movement sits under the identity line, where it reads as a fact
                about the player rather than competing with the widget's own metric. */}
            <PriceTrend trend={trend} width={56} className="mt-1" />
        </div>

        {/* Right side stats based on widget type */}
        <div className="text-right flex flex-col items-end">
            {type === 'consistency' && (
                <>
                    <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-purple-400">{player.Average_Score?.toFixed(1)}</span>
                        <span className="text-[10px] text-gray-500">{metric}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-blue-400">{player.StdDev_Score?.toFixed(1)}</span>
                        <span className="text-[10px] text-gray-500">SD</span>
                        <span className="text-gray-300 ml-1">{player.CR} CR</span>
                    </div>
                </>
            )}

            {type === 'budget' && (
                <>
                    <div className="font-mono font-bold text-green-400">{player.Average_Score?.toFixed(1)}</div>
                    <div className="text-[10px] text-gray-500">Avg {metric}</div>
                    <div className="text-xs text-gray-300">{player.CR} CR</div>
                </>
            )}

            {type === 'hot' && (
                <>
                    <div className="font-mono font-bold text-orange-400">{player.Average_Score?.toFixed(1)}</div>
                    <div className="text-[10px] text-gray-500">Avg {metric}</div>
                </>
            )}
        </div>
    </div>
);

const WidgetColumn = ({ title, subtitle, icon: Icon, players, type, color, metric, trendFor, onOpen }) => (
    <div className="glass-panel p-4 flex flex-col gap-4">
        <div>
            <h3 className={`font-bold text-gray-200 flex items-center gap-2`}>
                <Icon size={18} className={color} /> {title}
            </h3>
            {subtitle && <p className="text-xs text-gray-500 mt-1 ml-6">{subtitle}</p>}
        </div>
        <div className="space-y-2">
            {players && players.map((p, i) => (
                <PlayerCard
                    key={p.PlayerName}
                    player={p}
                    rank={i + 1}
                    type={type}
                    metric={metric}
                    trend={trendFor?.(p)}
                    onOpen={onOpen}
                />
            ))}
            {(!players || players.length === 0) && (
                <div className="text-gray-500 text-sm text-center py-4">No players found</div>
            )}
        </div>
    </div>
);

export default function DashboardView() {
    const [data, setData] = useState({ widgets: {}, injuries: [] });
    const [metric, setMetric] = useState('PIR');
    const [loading, setLoading] = useState(true);
    const { trendFor } = usePriceTrend(DASHBOARD_SEASON);
    const openPlayer = useOpenPlayer();
    const open = (name) => openPlayer(name, DASHBOARD_SEASON);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const res = await fetchDashboardData(DASHBOARD_SEASON);
            // Ensure default structure if api fails or returns partial
            setData({
                widgets: res?.widgets || {},
                injuries: res?.injuries || []
            });
            setMetric(res?.score_metric || 'PIR');
            setLoading(false);
        };
        load();
    }, []);

    if (loading) return (
        <div className="w-full h-[400px] flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
    );

    return (
        <div className="space-y-6">
            <header>
                <h2 className="text-2xl font-bold">Season Dashboard</h2>
                <p className="text-gray-400 text-sm">Smart insights and critical updates.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <WidgetColumn
                    title="Who's Hot"
                    subtitle="Based on last 3 games"
                    icon={Flame}
                    color="text-orange-500"
                    players={data.widgets.hot}
                    metric={metric}
                    type="hot"
                    trendFor={trendFor}
                    onOpen={open}
                />
                <WidgetColumn
                    title="Consistent Elite"
                    subtitle={`Last 5 games (top by ${metric})`}
                    icon={Target}
                    color="text-blue-500"
                    players={data.widgets.consistent}
                    metric={metric}
                    type="consistency"
                    trendFor={trendFor}
                    onOpen={open}
                />
                <WidgetColumn
                    title="Budget Picks"
                    subtitle="Last 5 games (<10 CR)"
                    icon={Banknote}
                    color="text-green-500"
                    players={data.widgets.budget}
                    metric={metric}
                    type="budget"
                    trendFor={trendFor}
                    onOpen={open}
                />
            </div>

            <div className="glass-panel p-5">
                <h3 className="font-bold text-gray-200 mb-4 flex items-center gap-2">
                    <Activity size={18} className="text-red-500" /> Recent Injuries
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {data.injuries.length > 0 ? data.injuries.map((inj, i) => (
                        // The injury feed is a separate source (Rotowire) and names a
                        // player as `Player`, which does not always match a PlayerName
                        // in the stats. Clicking still works; the detail view says so
                        // plainly when the name resolves to nothing.
                        <div
                            key={i}
                            onClick={() => open(inj.Player)}
                            className="flex items-start gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/10
                                       hover:bg-red-500/10 transition-colors cursor-pointer"
                        >
                            <AlertCircle size={16} className="text-red-500 mt-1" />
                            <div>
                                <div className="font-medium text-gray-200">{inj.Player} <span className="text-gray-500 text-xs">({inj.Team})</span></div>
                                <div className="text-sm text-red-400 font-medium">{inj.InjuryStatus}</div>
                                <div className="text-xs text-gray-500 mt-1">{inj.Injury}</div>
                            </div>
                        </div>
                    )) : (
                        <div className="text-gray-500 col-span-3">No recent injury reports available.</div>
                    )}
                </div>
            </div>
        </div>
    );
}
