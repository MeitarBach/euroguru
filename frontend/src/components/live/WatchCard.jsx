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

/** Where the player's game is: "Q3 04:12", "Final W 81–80", "19:00 · in 2h". */
function GameNote({ row, now }) {
    const { state, game } = row;
    if (['live', 'bench', 'waiting'].includes(state)) {
        return <span className="text-red-300">{[game.period, game.clock].filter(Boolean).join(' ') || 'Live'}</span>;
    }
    if (['final', 'dnp', 'out'].includes(state)) {
        const won = row.mine > row.theirs;
        return (
            <span>
                Final <span className={won ? 'text-emerald-400' : ''}>{won ? 'W' : 'L'} {row.mine}–{row.theirs}</span>
            </span>
        );
    }
    if (state === 'upcoming') {
        const until = game.tipoff - now;
        return <span>{whenLabel(game.tipoff, now)}{until > 0 && until < 6 * 3_600_000 ? ` · in ${countdown(until)}` : ''}</span>;
    }
    return <span>No game this round</span>;
}

/** The counting stats that are not zero, then minutes and (when they matter) fouls. */
function StatLine({ line }) {
    const parts = [['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'], ['tov', 'TO']]
        .filter(([stat]) => line[stat])
        .map(([stat, label]) => (
            <span key={stat} className={stat === 'tov' ? 'text-orange-300/90' : 'text-gray-300'}>
                <span className="font-mono tabular-nums">{line[stat]}</span> {label}
            </span>
        ));
    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500 min-w-0">
            {parts.length ? parts : <span>0 PTS</span>}
            <span>· <span className="font-mono tabular-nums">{line.min}</span></span>
            {line.pf >= 3 && (
                <span className={line.pf >= 5 ? 'text-red-400' : line.pf >= 4 ? 'text-amber-300' : ''}>
                    · {line.pf} PF{line.pf >= 5 ? ' (out)' : ''}
                </span>
            )}
        </div>
    );
}

const PLACEHOLDER = {
    bench: 'On the bench, yet to play',
    waiting: 'Game on, reading the boxscore',
    out: 'Not in the squad',
    dnp: 'Did not play',
};

/**
 * One followed player, live - compact enough that a phone shows several at once.
 *
 * Everything that moves does so in the direction of the news: the number counts to its
 * new value and flashes, a "+2.0" floats off it, and a big play rings the card. The card
 * glides when the order changes, so an overtake reads as a move, not as a jump.
 */
export default function WatchCard({ row, history, lastEvent, now, onRemove, onOpen, alsoIn = [] }) {
    const { player, line, state, score, pending, bonus } = row;
    const recent = lastEvent && now - lastEvent.at < BUBBLE_MS ? lastEvent : null;
    const glowing = recent && Math.abs(recent.delta) >= BIG_PLAY && now - recent.at < GLOW_MS;
    const points = history ?? [];
    const live = state === 'live';
    const injury = player.InjuryStatus
        ? (String(player.InjuryStatus).toUpperCase().startsWith('OUT') ? 'OUT' : 'GTD')
        : null;

    return (
        <MotionDiv
            layout
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            className={`group relative rounded-xl border px-3 py-2.5 bg-[#ffffff05] transition-shadow duration-500
                ${live ? 'border-red-500/25' : 'border-white/5'}
                ${glowing ? 'ring-2 ring-emerald-400/50 shadow-[0_0_28px_-8px_rgba(52,211,153,0.55)]' : ''}`}
        >
            <div className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                        {live && (line?.onCourt
                            ? <span title="On the court"><LiveDot color="green" /></span>
                            : <span title="On the bench" className="h-2 w-2 rounded-full bg-gray-600 shrink-0" />)}
                        <button
                            type="button"
                            onClick={onOpen}
                            className="text-sm font-semibold text-white truncate hover:text-purple-200 transition-colors"
                        >
                            {player.PlayerName}
                        </button>
                        {injury && <span className="text-[9px] px-1 rounded bg-red-500/15 text-red-300 shrink-0">{injury}</span>}
                        {alsoIn.map(g => (
                            <span key={g.id} title={`Also in ${g.name}`} className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: g.color }} />
                        ))}
                    </div>
                    <div className="text-[11px] text-gray-500 truncate">
                        {player.position} · {row.code}{row.opp && <> {row.home ? 'vs' : '@'} {row.opp}</>} · <GameNote row={row} now={now} />
                    </div>
                </div>

                <div className="relative text-right shrink-0">
                    <AnimatePresence>
                        {recent && recent.delta !== 0 && (
                            <MotionSpan
                                key={recent.id}
                                initial={{ opacity: 0, y: 6, scale: 0.85 }}
                                animate={{ opacity: 1, y: -2, scale: 1 }}
                                exit={{ opacity: 0, y: -14 }}
                                transition={{ duration: 0.45, ease: 'easeOut' }}
                                className={`absolute right-full mr-1.5 top-0.5 whitespace-nowrap text-xs font-bold font-mono ${
                                    recent.delta > 0 ? 'text-emerald-300' : 'text-red-300'}`}
                            >
                                {signed(recent.delta)}
                            </MotionSpan>
                        )}
                    </AnimatePresence>
                    {score !== null ? (
                        <AnimatedNumber
                            value={score}
                            className={`block text-2xl leading-none font-bold font-mono ${score < 0 ? 'text-red-300' : 'text-white'}`}
                        />
                    ) : (
                        <span className="block text-2xl leading-none font-bold font-mono text-gray-700">–</span>
                    )}
                    <span className="block mt-0.5 text-[10px] leading-tight text-gray-500 whitespace-nowrap">
                        {pending > 0 && <span className="text-emerald-300/90">+{pending.toFixed(1)} if win</span>}
                        {bonus > 0 && <span className="text-emerald-400">incl. +{bonus.toFixed(1)} W</span>}
                        {!pending && !bonus && (score === null && row.avg !== null ? `avg ${row.avg.toFixed(1)}` : 'FPT')}
                    </span>
                </div>

                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={`Remove ${player.PlayerName} from this group`}
                    className="p-1 -mr-1.5 -mt-0.5 rounded-md text-gray-600 hover:text-white hover:bg-[#ffffff0a] transition-colors md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                >
                    <X size={13} />
                </button>
            </div>

            {line && !line.dnp ? (
                <div className="mt-1.5 flex items-center justify-between gap-2">
                    <StatLine line={line} />
                    {points.length > 2 && (
                        <span className="shrink-0">
                            <Sparkline
                                values={points}
                                change={points[points.length - 1] - points[0]}
                                width={56}
                                height={16}
                                title="FPT through the game"
                            />
                        </span>
                    )}
                </div>
            ) : PLACEHOLDER[state] ? (
                <div className="mt-1 text-[11px] text-gray-600">{PLACEHOLDER[state]}</div>
            ) : null}
        </MotionDiv>
    );
}
