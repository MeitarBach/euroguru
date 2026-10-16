import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import AnimatedNumber from './AnimatedNumber';
import { GameNote } from './WatchCard';
import Sparkline from '../charts/Sparkline';
import { marginText } from '../../lib/live/format';

// Aliased so the lint config's unused-variable check sees `motion` used.
const MotionSpan = motion.span;

const BUBBLE_MS = 4000;

// The scoring bands, worst to best: [lowest margin in the band, points, label].
const BANDS = [
    [-Infinity, -20, 'L 21+'],
    [-20, -10, 'L 11–20'],
    [-10, -5, 'L 1–10'],
    [1, 10, 'W 1–10'],
    [11, 20, 'W 11–20'],
    [21, 25, 'W 21+'],
];

/** Which band a margin is in (a tie is in none), as an index into BANDS. */
function bandOf(margin) {
    if (margin === null || margin === 0) return -1;
    let found = -1;
    BANDS.forEach(([from], i) => { if (margin >= from) found = i; });
    return found;
}

/**
 * The scale a coach is scored on, with the band the score sits in now lit up - the
 * live question for a coach is how far the margin is from the next band.
 */
function BandScale({ margin }) {
    const active = bandOf(margin);
    return (
        <div className="grid grid-cols-6 gap-0.5 text-[9px] leading-none text-center">
            {BANDS.map(([, points, label], i) => {
                const on = i === active;
                const tone = points > 0
                    ? (on ? 'bg-emerald-500/25 text-emerald-200 border-emerald-400/40' : 'text-gray-600 border-white/5')
                    : (on ? 'bg-red-500/20 text-red-200 border-red-400/40' : 'text-gray-600 border-white/5');
                return (
                    <span key={label} className={`rounded border px-0.5 py-1 ${tone}`} title={`${label}: ${points > 0 ? '+' : ''}${points}`}>
                        <span className="block font-mono font-semibold">{points > 0 ? '+' : ''}{points}</span>
                        <span className="block mt-0.5 opacity-80">{label}</span>
                    </span>
                );
            })}
        </div>
    );
}

/**
 * A group's head coach, live: worth their club's margin as it stands (see coachPoints
 * in lib/live/feed.js), so the number jumps when a lead crosses into another band.
 */
export default function CoachCard({ row, history, lastEvent, now, onRemove }) {
    const { player, state, counted, margin } = row;
    const recent = lastEvent && now - lastEvent.at < BUBBLE_MS ? lastEvent : null;
    const points = history ?? [];
    const playing = state === 'live' || state === 'final';
    const live = state === 'live';

    return (
        <div className={`group relative rounded-xl border px-3 py-2.5 bg-[#ffffff05] ${live ? 'border-red-500/25' : 'border-white/5'}`}>
            <div className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-semibold text-white truncate">{player.PlayerName}</span>
                        <span className="text-[9px] px-1 rounded bg-purple-500/15 text-purple-200 shrink-0">COACH</span>
                    </div>
                    <div className="text-[11px] text-gray-500 truncate">
                        {row.code}{row.opp && <> {row.home ? 'vs' : '@'} {row.opp}</>} · <GameNote row={row} now={now} />
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
                                {recent.delta > 0 ? '+' : ''}{recent.delta}
                            </MotionSpan>
                        )}
                    </AnimatePresence>
                    {playing ? (
                        <AnimatedNumber
                            value={counted}
                            decimals={0}
                            className={`block text-2xl leading-none font-bold font-mono ${
                                counted > 0 ? 'text-emerald-300' : counted < 0 ? 'text-red-300' : 'text-white'}`}
                        />
                    ) : (
                        <span className="block text-2xl leading-none font-bold font-mono text-gray-700">–</span>
                    )}
                    <span className="block mt-0.5 text-[10px] leading-tight text-gray-500 whitespace-nowrap">
                        {playing ? marginText(margin, state === 'final') : player.CR ? `${player.CR} CR` : ''}
                    </span>
                </div>

                {onRemove && (
                    <button
                        type="button"
                        onClick={onRemove}
                        aria-label={`Remove ${player.PlayerName} as coach`}
                        className="p-1 -mr-1.5 -mt-0.5 rounded-md text-gray-600 hover:text-white hover:bg-[#ffffff0a] transition-colors md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                    >
                        <X size={13} />
                    </button>
                )}
            </div>

            {state !== 'nogame' && (
                <div className="mt-2 flex items-end gap-2">
                    <div className="flex-1 min-w-0"><BandScale margin={playing ? margin : null} /></div>
                    {points.length > 2 && (
                        <span className="shrink-0">
                            <Sparkline
                                values={points}
                                change={points[points.length - 1] - points[0]}
                                width={48}
                                height={16}
                                title="Coach points through the game"
                            />
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
