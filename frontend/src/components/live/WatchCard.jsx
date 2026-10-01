import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import AnimatedNumber from './AnimatedNumber';
import LiveDot from './LiveDot';
import Sparkline from '../charts/Sparkline';
import { whenLabel, countdown, signed } from '../../lib/live/format';

// Aliased so the lint config's unused-variable check sees `motion` used.
const MotionDiv = motion.div;
const MotionSpan = motion.span;

// How long a "+2.0" stays up, and how long a big play keeps the card glowing.
const BUBBLE_MS = 4000;
const GLOW_MS = 2500;
const BIG_PLAY = 3;

function StatusBadge({ row, now }) {
    const { state, game } = row;
    if (state === 'live' || state === 'bench' || state === 'waiting') {
        return (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-red-300">
                <LiveDot /> {[game.period, game.clock].filter(Boolean).join(' ') || 'Live'}
            </span>
        );
    }
    if (state === 'final' || state === 'dnp' || state === 'out') {
        const result = row.mine > row.theirs ? 'W' : 'L';
        return (
            <span className="text-[11px] font-semibold text-gray-500">
                FINAL <span className={result === 'W' ? 'text-emerald-400' : 'text-gray-500'}>{result} {row.mine}–{row.theirs}</span>
            </span>
        );
    }
    if (state === 'upcoming') {
        return <span className="text-[11px] text-gray-400">{whenLabel(game.tipoff, now)}</span>;
    }
    return <span className="text-[11px] text-gray-600">No game</span>;
}

function Stat({ value, label, tone = '' }) {
    return (
        <span className={value ? tone || 'text-gray-200' : 'text-gray-600'}>
            <span className="font-mono tabular-nums">{value}</span> {label}
        </span>
    );
}

function StatLine({ line }) {
    const fouls = line.pf >= 5 ? 'text-red-400' : line.pf >= 4 ? 'text-amber-300' : '';
    return (
        <div className="mt-3 space-y-1 text-xs">
            <div className="flex flex-wrap gap-x-2.5 gap-y-1">
                <Stat value={line.pts} label="PTS" />
                <Stat value={line.reb} label="REB" />
                <Stat value={line.ast} label="AST" />
                <Stat value={line.stl} label="STL" />
                <Stat value={line.blk} label="BLK" />
                <Stat value={line.tov} label="TO" tone="text-orange-300" />
            </div>
            <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-gray-500">
                <span><span className="font-mono tabular-nums text-gray-300">{line.min}</span> MIN</span>
                <span className={fouls}>
                    <span className="font-mono tabular-nums">{line.pf}</span> PF{line.pf >= 5 ? ' · fouled out' : ''}
                </span>
                <span>
                    <span className="font-mono tabular-nums text-gray-300">{line.fgm2 + line.fgm3}/{line.fga2 + line.fga3}</span> FG
                </span>
                <span><span className="font-mono tabular-nums text-gray-300">{signed(line.pm).replace('.0', '')}</span> ±</span>
            </div>
        </div>
    );
}

/** How the score compares with the player's season average. */
function PaceBar({ score, avg }) {
    if (!avg || avg <= 0 || score === null) return null;
    const ratio = Math.max(0, Math.min(1.5, score / avg));
    const ahead = score >= avg;
    return (
        <div className="mt-3">
            <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                <div
                    className={`h-full rounded-full transition-[width] duration-700 ${ahead ? 'bg-emerald-400/80' : 'bg-purple-400/70'}`}
                    style={{ width: `${(ratio / 1.5) * 100}%` }}
                />
            </div>
            <div className="mt-1 text-[10px] text-gray-500">
                season avg <span className="font-mono text-gray-400">{avg.toFixed(1)}</span>
                {ahead && <span className="text-emerald-400"> · beating it</span>}
            </div>
        </div>
    );
}

function Placeholder({ row, now }) {
    const { state, game, avg } = row;
    const text = {
        upcoming: game && `Tip-off ${whenLabel(game.tipoff, now)} · in ${countdown(game.tipoff - now)}`,
        bench: 'On the bench - yet to play',
        waiting: 'Game on - reading the boxscore',
        out: 'Not in the squad tonight',
        dnp: 'Did not play',
        nogame: 'No game this round',
    }[state];
    return (
        <div className="mt-3">
            <div className="flex items-baseline gap-1.5 text-gray-600">
                <span className="text-4xl font-bold font-mono">–</span>
                {avg !== null && <span className="text-xs">avg {avg.toFixed(1)} FPT</span>}
            </div>
            <div className="mt-1 text-xs text-gray-500">{text}</div>
        </div>
    );
}

/**
 * One watched player, live.
 *
 * Everything that moves does so in the direction of the news: the number counts to its
 * new value and flashes, a "+2.0" floats up off it, and a big play rings the card. The
 * card itself glides when the order changes, so a player overtaking another reads as
 * a move rather than as the list jumping.
 */
export default function WatchCard({ row, history, lastEvent, now, onRemove, onOpen }) {
    const { player, line, state, score, pending, bonus } = row;
    const scored = score !== null;
    const recent = lastEvent && now - lastEvent.at < BUBBLE_MS ? lastEvent : null;
    const glowing = recent && Math.abs(recent.delta) >= BIG_PLAY && now - recent.at < GLOW_MS;
    const points = history ?? [];

    return (
        <MotionDiv
            layout
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            className={`glass-panel p-4 relative overflow-hidden transition-shadow duration-500 ${
                glowing ? 'ring-2 ring-emerald-400/50 shadow-[0_0_32px_-8px_rgba(52,211,153,0.55)]' : ''}`}
        >
            {state === 'live' && <span className="absolute inset-y-0 left-0 w-0.5 bg-red-500/70" />}

            <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={onOpen} className="min-w-0 text-left group">
                    <div className="flex items-center gap-2">
                        {state === 'live' && (line?.onCourt
                            ? <span title="On the court"><LiveDot color="green" /></span>
                            : <span title="On the bench" className="h-2 w-2 rounded-full bg-gray-600 shrink-0" />)}
                        <span className="font-semibold text-white truncate group-hover:text-purple-200 transition-colors">
                            {player.PlayerName}
                        </span>
                        {player.InjuryStatus && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20 shrink-0">
                                {String(player.InjuryStatus).toUpperCase().startsWith('OUT') ? 'OUT' : 'GTD'}
                            </span>
                        )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                        {player.position} · {row.code}
                        {row.opp && <> {row.home ? 'vs' : '@'} {row.opp}</>}
                        {state === 'live' && line && (line.onCourt ? ' · on court' : ' · bench')}
                    </div>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                    <StatusBadge row={row} now={now} />
                    <button
                        type="button"
                        onClick={onRemove}
                        aria-label={`Stop watching ${player.PlayerName}`}
                        className="p-1.5 -m-0.5 rounded-lg text-gray-600 hover:text-white hover:bg-[#ffffff0a] transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>

            {scored ? (
                <>
                    <div className="mt-3 flex items-end justify-between gap-3">
                        <div className="relative">
                            <div className="flex items-baseline gap-1.5">
                                <AnimatedNumber
                                    value={score}
                                    className={`text-4xl font-bold font-mono ${score < 0 ? 'text-red-300' : 'text-white'}`}
                                />
                                <span className="text-xs text-gray-500">FPT</span>
                            </div>
                            <AnimatePresence>
                                {recent && recent.delta !== 0 && (
                                    <MotionSpan
                                        key={recent.id}
                                        initial={{ opacity: 0, y: 8, scale: 0.85 }}
                                        animate={{ opacity: 1, y: -6, scale: 1 }}
                                        exit={{ opacity: 0, y: -22 }}
                                        transition={{ duration: 0.45, ease: 'easeOut' }}
                                        className={`absolute -top-3 left-full ml-1 whitespace-nowrap text-sm font-bold font-mono ${
                                            recent.delta > 0 ? 'text-emerald-300' : 'text-red-300'}`}
                                    >
                                        {signed(recent.delta)}
                                    </MotionSpan>
                                )}
                            </AnimatePresence>
                            {pending > 0 && (
                                <div className="mt-1 text-[11px] text-emerald-300/90">
                                    +{pending.toFixed(1)} if {row.code} win
                                </div>
                            )}
                            {bonus > 0 && (
                                <div className="mt-1 text-[11px] text-emerald-400">incl. +{bonus.toFixed(1)} win bonus</div>
                            )}
                        </div>
                        {points.length > 2 && (
                            <Sparkline
                                values={points}
                                change={points[points.length - 1] - points[0]}
                                width={96}
                                height={34}
                                title="FPT through the game"
                            />
                        )}
                    </div>
                    <StatLine line={line} />
                    <PaceBar score={score} avg={row.avg} />
                </>
            ) : (
                <Placeholder row={row} now={now} />
            )}
        </MotionDiv>
    );
}
