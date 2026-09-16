import React, { useMemo } from 'react';
import { trendColor } from './palette';

/**
 * A price line small enough to sit inside a card.
 *
 * Hand-rolled SVG rather than recharts on purpose: a dashboard renders 15 of these and
 * the recommendations table another 20, and recharts' ResponsiveContainer both
 * misbehaves at ~64x18px and costs a measuring pass per instance. A polyline needs
 * none of that.
 *
 * `values` is a plain array of numbers, oldest first.
 */
export default function Sparkline({ values, change = 0, width = 64, height = 18, title }) {
    const points = useMemo(() => {
        const nums = (values ?? []).filter(v => typeof v === 'number' && !Number.isNaN(v));
        // One point is a dot, not a line - there is no movement to draw.
        if (nums.length < 2) return null;

        const min = Math.min(...nums);
        const max = Math.max(...nums);
        // A flat series has no range to normalise against; draw it down the middle
        // rather than dividing by zero and sending every point to the top.
        const span = max - min || 1;
        const pad = 2;
        const usable = height - pad * 2;

        return nums.map((v, i) => {
            const x = (i / (nums.length - 1)) * width;
            const y = pad + (max === min ? usable / 2 : (1 - (v - min) / span) * usable);
            return [x, y];
        });
    }, [values, width, height]);

    if (!points) return null;

    const colour = trendColor(change);
    const [lastX, lastY] = points[points.length - 1];

    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="overflow-visible shrink-0"
            role="img"
            aria-label={title}
        >
            {title && <title>{title}</title>}
            <polyline
                points={points.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none"
                stroke={colour}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
            {/* The end dot marks where the price is now, which is the point the eye
                looks for first. */}
            <circle cx={lastX} cy={lastY} r="1.8" fill={colour} />
        </svg>
    );
}
