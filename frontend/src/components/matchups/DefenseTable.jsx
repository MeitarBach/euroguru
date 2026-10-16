import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { POSITIONS, POSITION_NAMES, POSITION_COLORS, heatStyle } from './heat';
import { GateFade } from '../Gate';
import { PREVIEW_ROWS, BLURRED_ROWS, BLURRED_ROW } from '../../lib/gate';

const METRICS = [
    { id: 'p36', label: 'Per 36 min' },
    { id: 'pg', label: 'Per game' },
];

// Every team x position: FPT allowed, its rank (1 = softest) and a heat colour against
// the league. Clicking a team opens its round-by-round breakdown underneath.
export default function DefenseTable({ teams, league, locked, unlock, openPlayer }) {
    const [metric, setMetric] = useState('p36');
    const [sort, setSort] = useState({ key: 'G', dir: -1 });
    const [open, setOpen] = useState(null);

    const rows = useMemo(() => {
        const value = t => (sort.key === 'name' ? t.name : t.pos[sort.key][metric]);
        return [...teams].sort((a, b) => {
            const x = value(a), y = value(b);
            return sort.dir * (typeof x === 'string' ? x.localeCompare(y) : x - y);
        });
    }, [teams, sort, metric]);

    const shown = locked ? rows.slice(0, PREVIEW_ROWS.matchups + BLURRED_ROWS) : rows;

    const onSort = (key) => {
        if (locked) return unlock('Sort the defense table');
        setSort(s => ({ key, dir: s.key === key ? -s.dir : (key === 'name' ? 1 : -1) }));
    };
    const onRow = (code) => {
        if (locked) return unlock("See each team's breakdown");
        setOpen(o => (o === code ? null : code));
    };

    const arrow = key => (sort.key === key ? (sort.dir < 0 ? ' ↓' : ' ↑') : '');

    return (
        <div className="space-y-3">
            <div className="inline-flex p-1 rounded-lg bg-[#0a0a0c] border border-white/5">
                {METRICS.map(m => (
                    <button
                        key={m.id}
                        onClick={() => setMetric(m.id)}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${metric === m.id
                            ? 'bg-purple-600/25 text-purple-200'
                            : 'text-gray-400 hover:text-gray-200'}`}
                    >
                        {m.label}
                    </button>
                ))}
            </div>

            <div className="glass-panel overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-[#19191b] text-[11px] uppercase tracking-wider text-gray-500">
                                <th className="px-4 py-3 text-left font-semibold cursor-pointer hover:text-gray-300" onClick={() => onSort('name')}>
                                    Team{arrow('name')}
                                </th>
                                {POSITIONS.map(p => (
                                    <th key={p} className="px-4 py-3 text-right font-semibold whitespace-nowrap cursor-pointer hover:text-gray-300" onClick={() => onSort(p)}>
                                        <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: POSITION_COLORS[p] }} />
                                        vs {POSITION_NAMES[p]}{arrow(p)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#ffffff08]">
                            <tr className="text-gray-500">
                                <td className="px-4 py-2">League average</td>
                                {POSITIONS.map(p => (
                                    <td key={p} className="px-4 py-2 text-right font-mono">{league[p][metric].toFixed(1)}</td>
                                ))}
                            </tr>
                            {shown.map((t, idx) => {
                                const hidden = locked && idx >= PREVIEW_ROWS.matchups;
                                const isOpen = open === t.code;
                                return (
                                    <React.Fragment key={t.code}>
                                        <tr
                                            onClick={() => onRow(t.code)}
                                            aria-hidden={hidden ? true : undefined}
                                            className={`cursor-pointer hover:bg-[#ffffff04] transition-colors ${hidden ? BLURRED_ROW : ''}`}
                                        >
                                            <td className="px-4 py-2.5 whitespace-nowrap">
                                                <span className="inline-flex items-center gap-1.5">
                                                    {isOpen ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-600" />}
                                                    <span className="font-medium text-white">{t.name}</span>
                                                    <span className="text-xs text-gray-600">{t.code}</span>
                                                </span>
                                            </td>
                                            {POSITIONS.map(p => (
                                                <td key={p} className="px-4 py-2 text-right">
                                                    <span
                                                        className="inline-flex items-baseline justify-between gap-2 min-w-[88px] px-2 py-1 rounded-md"
                                                        style={heatStyle(t.pos[p][metric], league[p][metric])}
                                                    >
                                                        <span className="text-[11px] text-gray-400">#{t.pos[p][`rank_${metric}`]}</span>
                                                        <span className="font-mono text-gray-100">{t.pos[p][metric].toFixed(1)}</span>
                                                    </span>
                                                </td>
                                            ))}
                                        </tr>
                                        {isOpen && (
                                            <tr className="bg-[#ffffff03]">
                                                <td colSpan={4} className="px-4 py-4">
                                                    <TeamBreakdown team={t} teams={teams} openPlayer={openPlayer} />
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {locked && rows.length > PREVIEW_ROWS.matchups && (
                    <GateFade title={`See all ${rows.length} teams`} />
                )}
            </div>
        </div>
    );
}

// One team: what each position scored against it, game by game, and the biggest
// single games against it. Bars share one scale across the whole league so a tall bar
// means the same thing on every team.
function TeamBreakdown({ team, teams, openPlayer }) {
    const max = Math.max(1, ...teams.flatMap(t => POSITIONS.flatMap(p => t.pos[p].rounds.map(r => r.fpt))));
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {POSITIONS.map(p => (
                <div key={p}>
                    <div className="flex items-center gap-1.5 mb-2 text-[11px] uppercase tracking-wider font-semibold text-gray-500">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: POSITION_COLORS[p] }} />
                        Allowed to {POSITION_NAMES[p]}
                    </div>
                    <div className="flex items-end gap-1.5 h-20">
                        {team.pos[p].rounds.map(r => (
                            <div key={r.round} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                                <span className="text-[10px] font-mono text-gray-300">{r.fpt.toFixed(0)}</span>
                                <div
                                    className="w-full rounded-t"
                                    style={{ height: `${Math.max(2, (r.fpt / max) * 48)}px`, backgroundColor: POSITION_COLORS[p] }}
                                />
                                <span className="text-[10px] text-gray-500 whitespace-nowrap">R{r.round} {r.vs}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
            <div>
                <div className="mb-2 text-[11px] uppercase tracking-wider font-semibold text-gray-500">Biggest games against them</div>
                <ul className="space-y-1">
                    {team.top.map(g => (
                        <li key={`${g.player}-${g.round}`} className="flex items-center justify-between gap-2 text-sm">
                            <button className="text-left text-gray-200 hover:text-purple-300 truncate" onClick={() => openPlayer(g.player)}>
                                {g.player} <span className="text-xs text-gray-500">{g.team} · R{g.round}</span>
                            </button>
                            <span className="font-mono text-gray-100">{g.fpt.toFixed(1)}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
