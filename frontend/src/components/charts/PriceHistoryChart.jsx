import React, { useMemo } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Label,
} from 'recharts';
import { colorForIndex } from './palette';

const formatDay = (t) =>
    new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** Round 0 is the price the season opened at, before anybody had played. */
const roundLabel = (round) => (round === 0 ? 'Start' : `R${round}`);

/**
 * Tooltip for a shared-axis, multi-series chart.
 *
 * Reads the WHOLE payload array — one entry per line at the hovered date — which is
 * the opposite of the rule in ScatterPlot. There, several <Scatter> series with a
 * `payload[0]` read reported the first series' point no matter which dot was under
 * the cursor. Here the series are genuinely simultaneous: they share an x, and every
 * one of them has a value worth showing. Taking payload[0] would quietly label every
 * line with the first player's price.
 */
const CustomTooltip = ({ active, payload, label, names }) => {
    if (!active || !payload || !payload.length) return null;

    const rows = payload
        .filter(entry => entry.value !== null && entry.value !== undefined)
        .sort((a, b) => b.value - a.value);
    if (!rows.length) return null;

    // The round is the headline; the date it was read stays available underneath,
    // because "which round" and "when exactly" are both worth knowing on hover.
    const readOn = payload[0]?.payload?.date;

    return (
        <div className="rounded-lg bg-[#16161a] border border-white/15 shadow-2xl px-3 py-2 text-xs">
            <p className="font-bold text-white">{label}</p>
            {readOn && (
                <p className="text-[10px] text-gray-500 mb-1.5">{formatDay(Date.parse(readOn))}</p>
            )}
            {rows.map(entry => (
                <p key={entry.dataKey} className="flex items-center gap-1.5 text-gray-300">
                    <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: entry.stroke }}
                    />
                    <span className="truncate max-w-[150px]">{names[entry.dataKey]}</span>
                    <span className="ml-auto pl-2 font-medium text-white tabular-nums">
                        {entry.value.toFixed(1)}
                    </span>
                </p>
            ))}
        </div>
    );
};

/**
 * CR over time, one line per selected player.
 *
 * `players` are the API's per-player records: { playerKey, playerName, series: [...] }.
 */
export default function PriceHistoryChart({ players, height = 420 }) {
    // Recharts wants one row per x with a column per series, so the per-player series
    // are pivoted onto a shared round axis. A player absent from a round gets no key
    // on that row at all — undefined leaves a gap that connectNulls bridges, whereas a
    // 0 would draw a spike down to the floor.
    const { rows, names } = useMemo(() => {
        // Rounds once the season has a schedule to date them with; a season without
        // one keeps its snapshot dates, which the axis spaces evenly just the same —
        // the unit changes, the geometry does not. Decided once for the whole chart,
        // never per point: a payload with only some rounds dated would otherwise mix
        // round numbers and epoch milliseconds in one ordering and sort every dated
        // point ahead of every undated one.
        const byRound = players.every(player =>
            player.series.every(p => p.round !== null && p.round !== undefined));

        const byX = new Map();
        const labels = {};

        for (const player of players) {
            labels[player.playerKey] = player.playerName;
            for (const point of player.series) {
                const time = Date.parse(point.date);
                if (!byRound && Number.isNaN(time)) continue;

                const key = byRound ? `r${point.round}` : `d${point.date}`;
                if (!byX.has(key)) {
                    byX.set(key, {
                        label: byRound ? roundLabel(point.round) : formatDay(time),
                        order: byRound ? point.round : time,
                        date: point.date,
                    });
                }
                const row = byX.get(key);
                // The newest reading in the round names it. Players are not all read
                // on the same day — someone priced once, weeks before the rest, still
                // belongs to that round — and without this the tooltip's date would be
                // whichever player happened to be drawn first.
                if (point.date > row.date) row.date = point.date;
                row[player.playerKey] = point.cr;
            }
        }

        return {
            rows: [...byX.values()].sort((a, b) => a.order - b.order),
            names: labels,
        };
    }, [players]);

    if (!players.length || rows.length === 0) {
        return (
            <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height }}>
                {players.length
                    ? 'No price snapshots for these players in this season.'
                    : 'Pick some players to chart their price.'}
            </div>
        );
    }

    // Past eight or so, upright labels start colliding; angling them buys room
    // without dropping any, the same treatment BarChartPanel gives its categories.
    const crowded = rows.length > 8;
    // Angling stops being enough somewhere past two dozen, and a full season runs to
    // ~38 rounds. Thinning only hides labels - every round keeps its point and its
    // place, so the line and the spacing are untouched.
    const tickStep = rows.length > 24 ? Math.ceil(rows.length / 24) - 1 : 0;

    return (
        <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 10, right: 24, bottom: 30, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                    {/*
                      A category axis, one step per round, evenly spaced. Prices move
                      once a round, so rounds — not the days the fetcher happened to
                      run — are the unit this line is actually drawn in. Rounds nobody
                      recorded a price for are simply absent rather than stretched
                      across: the tick labels carry the gap, so R3 sitting next to R13
                      reads as the jump it is.
                    */}
                    <XAxis
                        dataKey="label"
                        interval={tickStep}
                        padding={{ left: 12, right: 12 }}
                        tick={{ fill: '#9ca3af', fontSize: 12 }}
                        axisLine={{ stroke: '#4b5563' }}
                        angle={crowded ? -35 : 0}
                        textAnchor={crowded ? 'end' : 'middle'}
                        height={crowded ? 60 : 30}
                    />
                    <YAxis
                        tick={{ fill: '#9ca3af', fontSize: 12 }}
                        axisLine={{ stroke: '#4b5563' }}
                        domain={['auto', 'auto']}
                        width={44}
                    >
                        <Label value="CR" angle={-90} position="insideLeft" fill="#9ca3af" />
                    </YAxis>
                    <Tooltip
                        content={<CustomTooltip names={names} />}
                        cursor={{ stroke: '#6b7280', strokeDasharray: '3 3' }}
                    />
                    {players.map((player, i) => (
                        <Line
                            key={player.playerKey}
                            type="monotone"
                            dataKey={player.playerKey}
                            name={player.playerName}
                            stroke={colorForIndex(i)}
                            strokeWidth={2}
                            dot={{ r: 2.5, strokeWidth: 0, fill: colorForIndex(i) }}
                            activeDot={{ r: 4.5 }}
                            connectNulls
                            isAnimationActive={false}
                        />
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
