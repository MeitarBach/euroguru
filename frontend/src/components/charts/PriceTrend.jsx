import React from 'react';
import Sparkline from './Sparkline';

const toneFor = (change) =>
    change > 0 ? 'text-emerald-400' : change < 0 ? 'text-red-400' : 'text-gray-600';

/**
 * A player's price movement: the shape, then the number.
 *
 * Both, because neither is enough on its own — "+2.1" does not say whether the climb
 * was steady or one jump, and the line alone does not say how big it was.
 *
 * `trend` is a record from /api/cr-history, or null when the player has no price
 * history (an unmatched name, or a season with no snapshots). Renders nothing at all
 * in that case rather than a zero, which would claim the price held steady.
 */
export default function PriceTrend({ trend, width = 64, showBadge = true, className = '' }) {
    if (!trend || !trend.series?.length) return null;

    const { change = 0, series, playerName } = trend;
    const values = series.map(point => point.cr);
    const sign = change > 0 ? '+' : '';

    return (
        <span className={`inline-flex items-center gap-1.5 ${className}`}>
            <Sparkline
                values={values}
                change={change}
                width={width}
                title={`${playerName}: ${trend.first} to ${trend.last} CR over ${series.length} snapshots`}
            />
            {showBadge && (
                <span className={`text-[11px] font-medium tabular-nums ${toneFor(change)}`}>
                    {sign}{change.toFixed(1)}
                </span>
            )}
        </span>
    );
}
