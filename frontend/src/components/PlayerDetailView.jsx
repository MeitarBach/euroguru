import React, { useState, useEffect } from 'react';
import { fetchPlayerDetail } from '../services/api';
import { X } from 'lucide-react';
import InfoTip from './InfoTip';
import usePriceTrend from '../hooks/usePriceTrend';
import PriceHistoryChart from './charts/PriceHistoryChart';

const fmt = (value, digits = 1, suffix = '') => {
    // ?? not ||: a plus-minus of 0 or a scoreless game is data, not a missing value.
    if (value === null || value === undefined || value === '') return '-';
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (Number.isNaN(num)) return value;
    return `${num.toFixed(digits)}${suffix}`;
};

const signed = (value) => {
    if (value === null || value === undefined || value === '') return '-';
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (Number.isNaN(num)) return value;
    return `${num > 0 ? '+' : ''}${num.toFixed(1)}`;
};

const Stat = ({ label, value, hint }) => (
    <div className="rounded-xl bg-[#ffffff05] border border-white/5 p-3">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
            {label}
            {hint && <InfoTip text={hint} />}
        </div>
        <div className="font-mono font-bold text-lg text-white mt-0.5">{value}</div>
    </div>
);

export default function PlayerDetailView({ name, season, onClose }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const { trendFor } = usePriceTrend(season);

    useEffect(() => {
        let active = true;
        fetchPlayerDetail(name, season).then(result => {
            if (!active) return;
            setData(result);
            setLoading(false);
        });
        return () => { active = false; };
    }, [name, season]);

    // Close on Escape, the expected way out of a modal.
    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const summary = data?.summary ?? {};
    const games = data?.games ?? [];
    const metric = data?.score_metric ?? 'PIR';

    // api.js swallows a failed request into a fallback shape, so a name that resolves
    // to nobody arrives looking like an empty player rather than an error. Injury
    // rows come from a different feed and can name someone absent from the stats, so
    // say so instead of rendering a grid of dashes.
    const missing = !loading && !summary.PlayerName && games.length === 0;

    const trend = trendFor({ PlayerKey: summary.PlayerKey, PlayerName: summary.PlayerName ?? name });

    return (
        <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-6"
            onClick={onClose}
        >
            <div
                className="glass-panel w-full max-w-5xl my-8 p-6 space-y-5"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-2xl font-bold text-white">{name}</h2>
                        <p className="text-sm text-gray-400">
                            {summary.Team || '-'} • {summary.position || '-'} • {season} season
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#ffffff08] transition-colors"
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                {loading && (
                    <div className="h-40 flex items-center justify-center">
                        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                )}

                {missing && (
                    <div className="h-40 flex flex-col items-center justify-center text-center gap-1">
                        <p className="text-gray-300">No data for {name} in the {season} season.</p>
                        <p className="text-sm text-gray-500">
                            They may not have been in the league that year, or be listed
                            under a different spelling.
                        </p>
                    </div>
                )}

                {!loading && !missing && (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                            <Stat label={`Avg ${metric}`} value={fmt(summary.Average_Score)} hint={metric === 'FPT' ? 'Fantasy points per game — what this player actually scores in the game you play.' : 'PIR per game (Performance Index Rating): points, rebounds, assists, steals, blocks and fouls drawn, minus missed shots, turnovers, blocks against and fouls committed.'} />
                            <Stat label="Minutes" value={fmt(summary.Average_Minutes)} hint="Average minutes per game. Usually the most predictive number here — a player can only produce while on court." />
                            <Stat label="Cost (CR)" value={fmt(summary.CR)} hint="Credits this player costs against your fantasy budget." />
                            <Stat label="Value" value={fmt(summary.Value, 3)} hint="Score per credit spent — the direct answer to whether this player is worth their price." />
                            <Stat label="Per 36" value={fmt(summary.Per36_Score)} hint="Score projected to 36 minutes, so bench players and starters can be compared on equal footing." />
                            <Stat label="Games" value={summary.GamesPlayed ?? '-'} hint="How many games these averages are based on. Few games means a small sample, not a trend." />
                            <Stat label="TS%" value={fmt(summary.Average_TS, 1, '%')} hint="True Shooting %: scoring efficiency counting twos, threes and free throws together. Around 55% is average, 60%+ is strong." />
                            <Stat label="Usage%" value={fmt(summary.Average_Usage, 1, '%')} hint="Share of the team\u2019s possessions this player finishes while on court. High usage means the offence runs through them." />
                            <Stat label="Form" value={signed(summary.Form)} hint="Last 3 games versus this player\u2019s own season average. Positive means heating up." />
                            <Stat label="Min +/-" value={signed(summary.MinutesTrend)} hint="Change in minutes over the last 3 games versus the season average. A rising role often shows here before the scoring follows." />
                            <Stat label="+/-" value={signed(summary.Average_PlusMinus)} hint="Team points scored minus conceded while this player was on court. Captures impact the box score misses, but noisy over few games." />
                            <Stat label="Start%" value={fmt(summary.StarterPct, 0, '%')} hint="Share of games started. A secure starting spot usually means stable minutes." />
                        </div>

                        {trend && trend.series.length > 1 && (
                            <div>
                                <h3 className="font-semibold text-gray-200 mb-2">
                                    Price over the season{' '}
                                    <span className="text-gray-500 font-normal">
                                        ({trend.first.toFixed(1)} → {trend.last.toFixed(1)} CR,{' '}
                                        {trend.change > 0 ? '+' : ''}{trend.change.toFixed(1)})
                                    </span>
                                </h3>
                                {/* Same chart the Price Tracker draws, one line, shorter. */}
                                <PriceHistoryChart players={[trend]} height={180} />
                            </div>
                        )}

                        <div>
                            <h3 className="font-semibold text-gray-200 mb-2">
                                Game log <span className="text-gray-500 font-normal">({games.length} games)</span>
                            </h3>
                            <div className="overflow-x-auto max-h-[420px] overflow-y-auto rounded-xl border border-white/5">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-[#ffffff08] text-gray-400 uppercase text-xs sticky top-0">
                                        <tr>
                                            {['Round', 'Team', 'Opp', 'Min', metric, 'Pts', 'Reb', 'Ast', 'Stl', 'TO', 'TS%', 'Usage%', '+/-'].map(h => (
                                                <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#ffffff08]">
                                        {games.map((g, i) => (
                                            <tr key={`${g.GameCode}-${i}`} className="hover:bg-[#ffffff03]">
                                                {/* The header has always said "Round" but this rendered
                                                    GameCode, which for archive seasons is a Euroleague
                                                    game id in the 1-406 range. The schedule supplies the
                                                    real round; GameCode remains the fallback, and the
                                                    date rides along as a title rather than a 14th column. */}
                                                <td className="px-3 py-2 text-gray-400" title={g.GameDate ?? undefined}>
                                                    {g.Round ?? g.GameCode ?? '-'}
                                                </td>
                                                <td className="px-3 py-2 text-gray-300 whitespace-nowrap" title={g.Team ?? undefined}>
                                                    {g.TeamCode ?? g.Team ?? '-'}
                                                </td>
                                                <td className="px-3 py-2 text-gray-300 whitespace-nowrap" title={g.OpponentName ?? undefined}>
                                                    {g.Opponent
                                                        ? `${g.IsHome ? 'vs' : '@'} ${g.Opponent}`
                                                        : '-'}
                                                </td>
                                                <td className="px-3 py-2 font-mono text-gray-300">{fmt(g.MinutesPlayed)}</td>
                                                <td className="px-3 py-2 font-mono font-bold text-white">{fmt(g.Score)}</td>
                                                <td className="px-3 py-2 font-mono text-gray-400">{g.Points ?? '-'}</td>
                                                <td className="px-3 py-2 font-mono text-gray-400">{g.TotalRebounds ?? '-'}</td>
                                                <td className="px-3 py-2 font-mono text-gray-400">{g.Assistances ?? '-'}</td>
                                                <td className="px-3 py-2 font-mono text-gray-400">{g.Steals ?? '-'}</td>
                                                <td className="px-3 py-2 font-mono text-gray-400">{g.Turnovers ?? '-'}</td>
                                                <td className="px-3 py-2 font-mono text-gray-400">{fmt(g['TS%'], 1, '%')}</td>
                                                <td className="px-3 py-2 font-mono text-gray-400">{fmt(g['Usage%'], 1, '%')}</td>
                                                <td className="px-3 py-2 font-mono text-gray-400">{signed(g.Plusminus)}</td>
                                            </tr>
                                        ))}
                                        {games.length === 0 && (
                                            <tr>
                                                <td colSpan={13} className="px-3 py-8 text-center text-gray-500">
                                                    No games played in this season.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
