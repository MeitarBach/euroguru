import React, { useMemo, useState } from 'react';
import { POSITIONS, POSITION_COLORS, pctVs } from './heat';
import { GateFade, LockedControl } from '../Gate';
import { PREVIEW_ROWS, BLURRED_ROWS, BLURRED_ROW } from '../../lib/gate';
import { shortName } from '../../columns';
import { useIsNarrow } from '../../hooks/useMediaQuery';

const LIMIT = 20;
const CR_CAPS = [
    { value: Infinity, label: 'Any CR' },
    { value: 12, label: '≤ 12 CR' },
    { value: 9, label: '≤ 9 CR' },
];

function Segmented({ options, value, onChange }) {
    return (
        <div className="inline-flex p-1 rounded-lg bg-[#0a0a0c] border border-white/5">
            {options.map(o => (
                <button
                    key={o.label}
                    onClick={() => onChange(o.value)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${value === o.value
                        ? 'bg-purple-600/25 text-purple-200'
                        : 'text-gray-400 hover:text-gray-200'}`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

// Season FPT x how soft the opponent is at the player's position. Not the EuroGuru
// model - a single multiplier, there to show how big the matchup effect is. The Actual
// column fills in as the round's games are played.
export default function MatchupBoost({ picks, locked, openPlayer }) {
    const [pos, setPos] = useState('All');
    const [cap, setCap] = useState(Infinity);
    const narrow = useIsNarrow();

    const rows = useMemo(
        () => picks.filter(x => (pos === 'All' || x.pos === pos) && (x.cr ?? 0) <= cap).slice(0, LIMIT),
        [picks, pos, cap]
    );
    const shown = locked ? rows.slice(0, PREVIEW_ROWS.boost + BLURRED_ROWS) : rows;

    return (
        <div className="space-y-3">
            <LockedControl reason="Filter the matchup boost" className="inline-flex flex-wrap gap-2">
                <div className="flex flex-wrap gap-2">
                    <Segmented options={[{ value: 'All', label: 'All' }, ...POSITIONS.map(p => ({ value: p, label: p }))]} value={pos} onChange={setPos} />
                    <Segmented options={CR_CAPS} value={cap} onChange={setCap} />
                </div>
            </LockedControl>

            <div className="glass-panel overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-[#19191b] text-[11px] uppercase tracking-wider text-gray-500">
                                <th className="px-4 py-3 text-left font-semibold">Player</th>
                                <th className="px-3 py-3 text-left font-semibold">Pos</th>
                                <th className="px-3 py-3 text-right font-semibold">CR</th>
                                <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Season FPT</th>
                                <th className="px-3 py-3 text-left font-semibold">Opp</th>
                                <th className="px-3 py-3 text-right font-semibold">Matchup</th>
                                <th className="px-3 py-3 text-right font-semibold">Projected</th>
                                <th className="px-4 py-3 text-right font-semibold">Actual</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#ffffff08]">
                            {shown.map((x, idx) => {
                                const hidden = locked && idx >= PREVIEW_ROWS.boost;
                                return (
                                    <tr
                                        key={x.player}
                                        onClick={() => openPlayer(x.player)}
                                        aria-hidden={hidden ? true : undefined}
                                        className={`cursor-pointer hover:bg-[#ffffff04] transition-colors ${hidden ? BLURRED_ROW : ''}`}
                                    >
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                            <span className="font-medium text-white">{narrow ? shortName(x.player) : x.player}</span>
                                            <span className="ml-1.5 text-xs text-gray-600">{x.team}</span>
                                            {x.injury && <span className="ml-1.5 text-xs text-red-400" title={x.injury}>⚠</span>}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded border border-white/10" style={{ color: POSITION_COLORS[x.pos] }}>{x.pos}</span>
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-mono text-gray-300">{x.cr ?? '—'}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-gray-300">{x.fpt.toFixed(1)}</td>
                                        <td className="px-3 py-2.5 text-gray-400">{x.vs}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${x.factor >= 1 ? 'text-green-400' : 'text-red-400'}`}>{pctVs(x.factor, 1)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono font-semibold text-white">{x.projected.toFixed(1)}</td>
                                        <td className="px-4 py-2.5 text-right font-mono">
                                            {x.actual === null
                                                ? <span className="text-gray-600 text-xs">upcoming</span>
                                                : <span className={`font-semibold ${x.actual >= x.fpt ? 'text-green-400' : 'text-red-400'}`}>{x.actual.toFixed(1)}</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                            {rows.length === 0 && (
                                <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500">No player fits these filters.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {locked && rows.length > PREVIEW_ROWS.boost && (
                    <GateFade title="See every matchup boost" />
                )}
            </div>
        </div>
    );
}
