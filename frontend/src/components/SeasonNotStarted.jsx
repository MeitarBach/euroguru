import React from 'react';
import { ArrowRight } from 'lucide-react';

/**
 * A chart with nothing in it yet.
 *
 * Inline rather than an asset so there is nothing to ship, nothing to cache-bust and
 * nothing to keep in sync with the palette. The shapes are deliberately the ones the
 * real widgets use - bars, a trend line, a price dot - so the panel reads as "this is
 * where your data goes" rather than as a generic shrug.
 *
 * The dot pulses because a still frame of an empty chart looks like a chart that
 * failed. Movement is what says "waiting". It stops for anyone who has asked their OS
 * for reduced motion.
 */
function WaitingChart() {
    return (
        <svg
            viewBox="0 0 200 110"
            className="w-44 h-24 shrink-0"
            role="img"
            aria-label="An empty chart waiting for data"
        >
            {/* Frame */}
            <line x1="18" y1="8" x2="18" y2="92" stroke="#ffffff10" strokeWidth="2" strokeLinecap="round" />
            <line x1="18" y1="92" x2="188" y2="92" stroke="#ffffff10" strokeWidth="2" strokeLinecap="round" />

            {/* Where the bars will be */}
            {[
                { x: 36, h: 26 },
                { x: 72, h: 42 },
                { x: 108, h: 34 },
                { x: 144, h: 54 },
            ].map(({ x, h }) => (
                <rect
                    key={x}
                    x={x}
                    y={92 - h}
                    width="20"
                    height={h}
                    rx="4"
                    fill="#8b5cf6"
                    opacity="0.09"
                />
            ))}

            {/* Where the trend will be */}
            <path
                d="M 28 74 C 60 70, 74 54, 100 52 S 146 36, 172 26"
                fill="none"
                stroke="#8b5cf6"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="5 6"
                opacity="0.45"
            />

            {/* The next price update */}
            <circle cx="172" cy="26" r="9" fill="#8b5cf6" opacity="0.15"
                className="animate-pulse motion-reduce:animate-none" />
            <circle cx="172" cy="26" r="3.5" fill="#8b5cf6"
                className="animate-pulse motion-reduce:animate-none" />
        </svg>
    );
}

/**
 * Shown in place of the three insight widgets while a season has no games on record.
 *
 * One panel rather than three empty columns: the same illustration repeated across a
 * row reads as three separate failures. Naming the widgets that are coming keeps the
 * page informative - someone arriving before tip-off still learns what the dashboard
 * is for.
 *
 * The injury panel below this is unaffected and still has real data, so the page is
 * never actually blank.
 */
export default function SeasonNotStarted({ seasonLabel, previousLabel, onViewPrevious }) {
    return (
        // Centred rather than left-aligned: this panel spans the full width the three
        // widgets used to, and pinning a short message to the left edge of that leaves
        // a screen's worth of dead space beside it that reads as a layout bug.
        <div className="glass-panel p-6 sm:p-10 flex flex-col sm:flex-row items-center
                        justify-center gap-6 sm:gap-8">
            <WaitingChart />

            <div className="min-w-0 text-center sm:text-left">
                <h3 className="font-bold text-lg text-white">
                    The {seasonLabel} season hasn’t tipped off yet
                </h3>
                <p className="text-sm text-gray-400 mt-1.5 max-w-lg">
                    Who’s Hot, Consistent Elite and Budget Picks appear here once the first
                    games are in. Prices and the injury report below are already live.
                </p>

                {/* py-2.5 rather than py-2, matching the sidebar's Sign in and the
                    modal's Google button: py-2 measures 38px here, just under a usable
                    tap target on a phone. */}
                {onViewPrevious && (
                    <button
                        type="button"
                        onClick={onViewPrevious}
                        className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg
                                   bg-[#ffffff08] border border-[#ffffff10] text-sm font-medium
                                   text-gray-300 hover:text-white hover:bg-[#ffffff12] transition-colors"
                    >
                        View the {previousLabel} season instead
                        <ArrowRight size={15} />
                    </button>
                )}
            </div>
        </div>
    );
}
