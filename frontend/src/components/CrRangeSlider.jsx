import React from 'react';

/**
 * Two-ended cost filter.
 *
 * Every view already tracked min_cr and max_cr and debounced both, but only ever
 * rendered a control for the maximum - so the label read "Cost Range (4 - 21.3 CR)"
 * while the lower bound was stuck wherever the season's filters had left it. This
 * gives the minimum a thumb of its own.
 *
 * HTML has no dual range input, so it is two of them stacked on one track. The inputs
 * themselves ignore the pointer (see .range-dual in index.css) and only their thumbs
 * accept it, which is what lets the lower one stay reachable underneath the upper.
 */
export default function CrRangeSlider({ min, max, limitMin, limitMax, step = 0.1, onChange }) {
    // A degenerate range would divide by zero below and pin both thumbs to one spot.
    const span = limitMax - limitMin || 1;
    const pct = (value) => ((value - limitMin) / span) * 100;

    const setMin = (raw) => onChange({ min: Math.min(parseFloat(raw), max), max });
    const setMax = (raw) => onChange({ min, max: Math.max(parseFloat(raw), min) });

    // Whichever thumb sits at the very top of the track would otherwise be buried by
    // the other input's full-width hit area and become impossible to drag back down.
    const minOnTop = pct(min) > 90;

    return (
        <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
            <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
                Cost Range{' '}
                <span className="text-purple-400 normal-case tracking-normal">
                    {min.toFixed(1)} – {max.toFixed(1)} CR
                </span>
            </label>

            <div className="range-dual relative h-4 flex items-center">
                {/* Track, then the selected span highlighted over it. */}
                <div className="absolute inset-x-0 h-1 rounded-lg bg-gray-700" />
                <div
                    className="absolute h-1 rounded-lg bg-purple-500"
                    style={{ left: `${pct(min)}%`, right: `${100 - pct(max)}%` }}
                />
                <input
                    type="range"
                    aria-label="Minimum cost"
                    min={limitMin} max={limitMax} step={step} value={min}
                    onChange={(e) => setMin(e.target.value)}
                    style={{ zIndex: minOnTop ? 4 : 3 }}
                />
                <input
                    type="range"
                    aria-label="Maximum cost"
                    min={limitMin} max={limitMax} step={step} value={max}
                    onChange={(e) => setMax(e.target.value)}
                    style={{ zIndex: minOnTop ? 3 : 4 }}
                />
            </div>
        </div>
    );
}
