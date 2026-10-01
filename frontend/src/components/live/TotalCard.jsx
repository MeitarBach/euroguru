import React from 'react';
import AnimatedNumber from './AnimatedNumber';
import LiveDot from './LiveDot';

/** The watch list as one number: the round so far, what is pending, where it is heading. */
export default function TotalCard({ round, sums }) {
    return (
        <div className="glass-panel p-5">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                Round {round} · your players
            </div>
            <div className="mt-1 flex items-baseline gap-2">
                <AnimatedNumber value={sums.total} className="text-5xl font-bold font-mono text-white" />
                <span className="text-sm text-gray-500">FPT</span>
            </div>
            {sums.pending > 0 && (
                <div className="mt-1 text-xs text-emerald-300">+{sums.pending.toFixed(1)} more if the leading teams hold on</div>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {sums.live > 0 && (
                    <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/10 text-red-300">
                        <LiveDot /> {sums.live} playing now
                    </span>
                )}
                {sums.final > 0 && <span className="px-2 py-1 rounded-md bg-white/5 text-gray-300">{sums.final} finished</span>}
                {sums.toPlay > 0 && <span className="px-2 py-1 rounded-md bg-white/5 text-gray-400">{sums.toPlay} to play</span>}
            </div>
            {sums.toPlay > 0 && (
                <div className="mt-3 text-xs text-gray-500">
                    Projected <span className="font-mono text-gray-200">{sums.projected.toFixed(1)}</span>
                    <span className="text-gray-600"> · so far + season average of those still to play</span>
                </div>
            )}
        </div>
    );
}
