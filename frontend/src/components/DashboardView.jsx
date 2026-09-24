import React, { useState, useEffect, useMemo } from 'react';
import { fetchDashboardData } from '../services/api';
import { Activity, ChevronDown, ChevronUp, Flame, Target, Banknote } from 'lucide-react';
import { statusOf, statusRank } from '../injuries';
import { useOpenPlayer } from '../hooks/playerDetailContext';
import usePriceTrend from '../hooks/usePriceTrend';
import PriceTrend from './charts/PriceTrend';
import SeasonNotStarted from './SeasonNotStarted';

// The dashboard reports on the current season and falls back only when the user asks
// it to. Named so the price history and the detail view cannot drift from the widgets.
//
// It used to be a lone constant pinned to the finished season, which quietly hid the
// fact that the new one has no games yet. Pointing at the current season means the
// page tells the truth about where we are, and SeasonNotStarted handles the stretch
// between prices going up and the first tip-off.
const CURRENT_SEASON = '2026';
const PREVIOUS_SEASON = '2025';

// Written out here as well as in CourtVisionView and RecommendationsView. A shared
// seasons module is the tidy fix, and worth doing the next time one of those changes.
const SEASON_LABEL = { '2026': '2026-27', '2025': '2025-26' };

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

// How many rows the panel shows before "Show all". Enough to be useful at a glance
// without the list pushing the widgets above it off the screen.
const INJURY_PREVIEW = 9;

const InjuryRow = ({ inj, onOpen }) => {
    const status = statusOf(inj.InjuryStatus);
    return (
        // The injury feed is a separate source (Rotowire) and names a player as
        // `Player`, which does not always match a PlayerName in the stats. Clicking
        // still works; the detail view says so plainly when the name resolves to nothing.
        <button
            onClick={() => onOpen?.(inj.Player)}
            title={inj.InjuryStatus}
            className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-sm
                       hover:bg-[#ffffff08] transition-colors"
        >
            <span className={`w-2 h-2 rounded-full shrink-0 ${status.dot}`} />
            <span className="text-gray-200 truncate">{inj.Player}</span>
            <span className="text-[11px] text-gray-600 shrink-0">{inj.Team}</span>
            <span className="ml-auto flex items-center gap-2.5 shrink-0 pl-2">
                <span className="text-xs text-gray-500 truncate max-w-[140px]">{inj.Injury}</span>
                <span className={`text-[10px] font-medium w-8 text-right ${status.text}`}>
                    {status.short}
                </span>
            </span>
        </button>
    );
};

/**
 * Every injured player, grouped by how badly, collapsed until asked.
 *
 * The count in the header is the point: this panel used to render whatever the API
 * sent and the API silently sent the first ten of twenty-nine, so there was no way to
 * tell the list was partial.
 */
const InjuryPanel = ({ injuries, onOpen }) => {
    const [expanded, setExpanded] = useState(false);

    // Ruled-out players force a lineup change, so they sort first; the backend's
    // Team/Player ordering is preserved within each group.
    const groups = useMemo(() => {
        const byStatus = new Map();
        for (const inj of injuries) {
            const { key, label, short, text } = statusOf(inj.InjuryStatus);
            if (!byStatus.has(key)) byStatus.set(key, { key, label, short, text, rows: [] });
            byStatus.get(key).rows.push(inj);
        }
        return [...byStatus.values()].sort(
            (a, b) => statusRank(a.key) - statusRank(b.key)
        );
    }, [injuries]);

    // Each group's visible slice. Derived from how many rows precede the group rather
    // than by decrementing a running counter - a reassignment like that outlives the
    // render and the React compiler rejects it. The preview budget is therefore spent
    // in group order, so a collapsed panel leads with OUT and only then shows GTD.
    const visible = useMemo(() => {
        const limit = expanded ? Infinity : INJURY_PREVIEW;
        return groups.map((group, i) => {
            const before = groups.slice(0, i).reduce((n, g) => n + g.rows.length, 0);
            return { ...group, shown: group.rows.slice(0, Math.max(0, limit - before)) };
        });
    }, [groups, expanded]);

    if (!injuries.length) {
        return (
            <div className="glass-panel p-5">
                <h3 className="font-bold text-gray-200 mb-2 flex items-center gap-2">
                    <Activity size={18} className="text-red-500" /> Injuries
                </h3>
                <p className="text-gray-500 text-sm">No injury reports available.</p>
            </div>
        );
    }

    return (
        <div className="glass-panel p-5">
            <div className="flex items-center justify-between gap-4 mb-3">
                <h3 className="font-bold text-gray-200 flex items-center gap-2">
                    <Activity size={18} className="text-red-500" /> Injuries
                </h3>
                <div className="flex items-center gap-3 text-xs">
                    {groups.map(g => (
                        <span key={g.key} className={g.text}>
                            {g.rows.length} {g.short || 'other'}
                        </span>
                    ))}
                </div>
            </div>

            <div className="space-y-3">
                {visible.map(group => (
                    group.shown.length === 0 ? null : (
                        <div key={group.key}>
                            <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-gray-600 font-semibold">
                                {group.label || 'Other'} ({group.rows.length})
                            </div>
                            {/* Up to three columns: a single column leaves most of the
                                panel empty and strands the injury text far from the name
                                it belongs to, since each row spreads to fill its width. */}
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-5">
                                {group.shown.map((inj, i) => (
                                    <InjuryRow key={`${inj.Player}-${i}`} inj={inj} onOpen={onOpen} />
                                ))}
                            </div>
                        </div>
                    )
                ))}
            </div>

            {injuries.length > INJURY_PREVIEW && (
                <button
                    onClick={() => setExpanded(v => !v)}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 py-2.5 md:py-1.5 rounded-lg
                               text-xs font-medium text-gray-500 hover:text-gray-300
                               hover:bg-[#ffffff05] transition-colors"
                >
                    {expanded
                        ? <>Show less <ChevronUp size={14} /></>
                        : <>Show all {injuries.length} <ChevronDown size={14} /></>}
                </button>
            )}
        </div>
    );
};

export default function DashboardView() {
    const [season, setSeason] = useState(CURRENT_SEASON);
    const [data, setData] = useState({ widgets: {}, injuries: [], games_recorded: null });
    const [metric, setMetric] = useState('PIR');
    const [loading, setLoading] = useState(true);
    const { trendFor } = usePriceTrend(season);
    const openPlayer = useOpenPlayer();
    const open = (name) => openPlayer(name, season);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const res = await fetchDashboardData(season);
            // Ensure default structure if api fails or returns partial
            setData({
                widgets: res?.widgets || {},
                injuries: res?.injuries || [],
                games_recorded: res?.games_recorded ?? null
            });
            setMetric(res?.score_metric || 'PIR');
            setLoading(false);
        };
        load();
    }, [season]);

    if (loading) return (
        <div className="w-full h-[400px] flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
    );

    // Null rather than 0 when the field is absent, so an API that predates it is not
    // mistaken for a season with no games. The two Vercel projects deploy separately
    // and the frontend can briefly be ahead of the backend; erring towards showing the
    // widgets keeps that window harmless.
    const started = (data.games_recorded ?? 1) > 0;

    return (
        <div className="space-y-6">
            <header>
                <h2 className="text-2xl font-bold">Season Dashboard</h2>
                <p className="text-gray-400 text-sm">
                    Smart insights and critical updates · {SEASON_LABEL[season] ?? season}
                </p>
            </header>

            {!started && (
                <SeasonNotStarted
                    seasonLabel={SEASON_LABEL[season] ?? season}
                    previousLabel={SEASON_LABEL[PREVIOUS_SEASON]}
                    onViewPrevious={season === CURRENT_SEASON
                        ? () => setSeason(PREVIOUS_SEASON)
                        : undefined}
                />
            )}

            {/* Only reachable by choosing it from the empty state, so it says why the
                page is showing a finished season and offers the way back. Without this
                the dashboard would silently be about last year. */}
            {started && season !== CURRENT_SEASON && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 rounded-xl
                                bg-[#8b5cf610] border border-[#8b5cf630] text-sm">
                    <span className="text-gray-300">
                        Showing the finished {SEASON_LABEL[season]} season.
                    </span>
                    <button
                        type="button"
                        onClick={() => setSeason(CURRENT_SEASON)}
                        className="text-purple-300 hover:text-purple-200 font-medium"
                    >
                        Back to {SEASON_LABEL[CURRENT_SEASON]}
                    </button>
                </div>
            )}

            {started && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
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
            )}

            {/* Outside the gate on purpose: the injury feed does not wait for a season
                to start, so this still has real data before tip-off. */}
            <InjuryPanel injuries={data.injuries} onOpen={open} />
        </div>
    );
}
