import React from 'react';
import { Crown, ArrowDown, ArrowUp, X, Star, Plus } from 'lucide-react';
import { STARTERS, BENCH } from '../../lib/teams';
import { euroleagueCode } from '../../lib/live/teams';
import { marginText } from '../../lib/live/format';
import { crChange, coachExpected, coachScore, pct } from '../../lib/optimizer/score';
import CoachOdds from './CoachOdds';

const ROLE_LABEL = { captain: 'Captain · x2', starter: 'x1', sixth: '6th man · x1', bench: 'Bench · x0.5' };
const one = (x) => (x === null || x === undefined ? '–' : x.toFixed(1));
const iconBtn = 'p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent';

function Injury({ status }) {
    if (!status) return null;
    const out = String(status).toUpperCase().startsWith('OUT');
    return <span className={`ml-1.5 text-[10px] font-semibold ${out ? 'text-red-300' : 'text-amber-300'}`}>{out ? 'OUT' : 'GTD'}</span>;
}

function PlayerLine({ row, editable, past, onAction, onOpenPlayer }) {
    const p = row.player;
    const change = crChange(row.delta);
    const benched = row.role === 'bench' || row.role === 'sixth';
    return (
        <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${row.role === 'captain'
            ? 'border-amber-400/30 bg-amber-400/[0.05]'
            : row.role === 'sixth' ? 'border-emerald-400/25 bg-emerald-400/[0.03]' : 'border-white/10 bg-white/[0.02]'}`}
        >
            <span className="w-6 text-center px-1 rounded bg-violet-500/20 text-violet-200 text-[10px] font-bold shrink-0">{p?.position ?? '?'}</span>
            <button type="button" onClick={() => p && onOpenPlayer(p.PlayerName)} className="min-w-0 flex-1 text-left">
                <span className="flex items-center text-sm text-white truncate">
                    {row.role === 'captain' && <Crown size={12} className="mr-1 text-amber-300 shrink-0" />}
                    <span className="truncate">{p?.PlayerName ?? 'Unknown player'}</span>
                    <Injury status={row.injury} />
                </span>
                <span className="block text-[11px] text-gray-500 truncate">
                    {p ? euroleagueCode(p) : ''} · {past
                        ? <span className={change.tone} title="Price change with this round">{change.text} CR</span>
                        : <>{one(p?.CR)} CR</>} · {ROLE_LABEL[row.role]}
                    {row.avail && row.avail[1] > 0 && row.avail[0] < row.avail[1] && (
                        <span className="text-amber-300/80"> · played {row.avail[0]} of {row.avail[1]}</span>
                    )}
                </span>
            </button>
            <span className="text-right shrink-0">
                <span className="block font-mono text-sm text-white tabular-nums">{one(row.counted)}</span>
                <span className="block text-[10px] text-gray-600 tabular-nums">
                    {!past ? `exp ${one(row.fpt)}` : row.fpt === null ? 'DNP' : `FPT ${one(row.fpt)}`}
                </span>
            </span>
            {editable && (
                <span className="flex items-center shrink-0">
                    {!benched && (
                        <button type="button" onClick={() => onAction('toggleCaptain', row.key)} title={row.role === 'captain' ? 'Take the armband off' : 'Make captain (x2)'} className={`${iconBtn} ${row.role === 'captain' ? '!text-amber-300' : ''}`}>
                            <Crown size={14} />
                        </button>
                    )}
                    {row.role === 'bench' && (
                        <button type="button" onClick={() => onAction('makeSixth', row.key)} title="Make sixth man (counts in full)" className={iconBtn}>
                            <Star size={14} />
                        </button>
                    )}
                    <button type="button" onClick={() => onAction('toggleBench', row.key)} title={benched ? 'Start him' : 'Bench him'} className={iconBtn}>
                        {benched ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                    </button>
                    <button type="button" onClick={() => onAction('remove', row.key)} title="Remove" className={`${iconBtn} hover:!text-red-300`}>
                        <X size={14} />
                    </button>
                </span>
            )}
        </div>
    );
}

function Slot({ label, onClick, editable }) {
    return (
        <button
            type="button"
            disabled={!editable}
            onClick={onClick}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-white/10 text-sm text-gray-500 enabled:hover:text-white enabled:hover:border-purple-500/40"
        >
            <Plus size={14} /> {label}
        </button>
    );
}

function Section({ title, note, total, children }) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-baseline justify-between px-1 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                <span>
                    {title}
                    {note && <span className="normal-case tracking-normal font-normal text-gray-600"> · {note}</span>}
                </span>
                {total !== undefined && <span className="font-mono normal-case tracking-normal text-gray-400">{one(total)}</span>}
            </div>
            {children}
        </div>
    );
}

/**
 * The lineup being built, by role, with each player's expected FPT as he counts in it.
 * `outlook` is lib/optimizer/score.js's teamOutlook; `onAction(op, key)` applies one of
 * lineupOps' changes; `onPick(role)` opens the player list for a spot: 'starter',
 * 'bench' or 'coach'. With `past` (a round number) `outlook` is teamRound's replay of
 * that round instead: what each scored and how his price moved.
 */
export default function LineupEditor({ outlook, editable, past = null, onAction, onPick, onRemoveCoach, onOpenPlayer }) {
    const starters = outlook.rows.filter(r => r.role === 'starter' || r.role === 'captain')
        .sort((a, b) => (b.role === 'captain') - (a.role === 'captain'));
    const sixth = outlook.rows.filter(r => r.role === 'sixth');
    const bench = outlook.rows.filter(r => r.role === 'bench');
    const sum = (rows) => rows.reduce((s, r) => s + r.counted, 0);
    const coach = outlook.coach;
    const o = coach?.outlook;
    const game = coach?.game;
    const line = (r) => <PlayerLine key={r.key} row={r} editable={editable} past={past !== null} onAction={onAction} onOpenPlayer={onOpenPlayer} />;

    return (
        <div className="space-y-4">
            <Section title={`Starters · ${starters.length}/${STARTERS}`} note="captain counts double" total={sum(starters)}>
                {starters.map(line)}
                {Array.from({ length: STARTERS - starters.length }, (_, i) => (
                    <Slot key={i} label="Pick a starter" editable={editable} onClick={() => onPick('starter')} />
                ))}
            </Section>

            <Section title="Sixth man" note="first on the bench, counts in full" total={sum(sixth)}>
                {sixth.map(line)}
                {!sixth.length && <Slot label="Pick a sixth man" editable={editable} onClick={() => onPick('bench')} />}
            </Section>

            <Section title={`Bench · ${bench.length}/${BENCH - 1}`} note="count half" total={sum(bench)}>
                {bench.map(line)}
                {Array.from({ length: Math.max(0, BENCH - 1 - bench.length) }, (_, i) => (
                    <Slot key={i} label="Pick a bench player" editable={editable} onClick={() => onPick('bench')} />
                ))}
            </Section>

            <Section title="Coach" note="scores his club's margin - counted at his most likely score" total={past !== null ? coach?.points : o ? coachExpected(o) : undefined}>
                {coach ? (
                    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-violet-500/25 bg-violet-500/[0.04]">
                        <span className="w-6 text-center px-1 rounded bg-violet-500/20 text-violet-200 text-[10px] font-bold shrink-0">HC</span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm text-white truncate">{coach.coach?.CoachName ?? 'Unknown coach'}</span>
                            <span className="block text-[11px] text-gray-500 truncate">
                                {coach.coach?.TeamCode ?? ''} · {one(coach.coach?.CR)} CR
                                {past !== null
                                    ? (game ? <> · {marginText(game.margin, true)} {game.home ? 'vs' : '@'} {game.opp}</> : ' · no game')
                                    : o?.opp ? <> · {o.home ? 'vs' : '@'} {o.opp} · {pct(o.win)} to win</> : ' · no game'}
                            </span>
                            {past === null && <CoachOdds outlook={o} className="mt-1" />}
                        </span>
                        <span className="text-right shrink-0">
                            <span className="block font-mono text-sm text-white tabular-nums">
                                {past !== null ? one(coach.points) : coachScore(coachExpected(o))}
                            </span>
                            <span className="block text-[10px] text-gray-600">
                                {past !== null ? `Round ${past}` : o?.opp ? `most likely · ${pct(o.chance)}` : 'expected'}
                            </span>
                        </span>
                        {editable && (
                            <span className="flex items-center shrink-0">
                                <button type="button" onClick={() => onPick('coach')} title="Change coach" className={iconBtn}>
                                    <ArrowDown size={14} className="rotate-90" />
                                </button>
                                <button type="button" onClick={onRemoveCoach} title="Remove" className={`${iconBtn} hover:!text-red-300`}>
                                    <X size={14} />
                                </button>
                            </span>
                        )}
                    </div>
                ) : (
                    <Slot label="Pick a coach" editable={editable} onClick={() => onPick('coach')} />
                )}
            </Section>
        </div>
    );
}
