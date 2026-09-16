import React, { useMemo } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Label,
} from 'recharts';
import { colorForIndex } from './palette';

const DAY_MS = 86_400_000;

const formatDay = (t) =>
    new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

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

    return (
        <div className="rounded-lg bg-[#16161a] border border-white/15 shadow-2xl px-3 py-2 text-xs">
            <p className="font-bold text-white mb-1.5">{formatDay(label)}</p>
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
    // are pivoted onto a shared date axis. A player absent from a snapshot gets no key
    // on that row at all — undefined leaves a gap that connectNulls bridges, whereas a
    // 0 would draw a spike down to the floor.
    const { rows, names } = useMemo(() => {
        const byTime = new Map();
        const labels = {};

        for (const player of players) {
            labels[player.playerKey] = player.playerName;
            for (const point of player.series) {
                const t = Date.parse(point.date);
                if (Number.isNaN(t)) continue;
                if (!byTime.has(t)) byTime.set(t, { t });
                byTime.get(t)[player.playerKey] = point.cr;
            }
        }

        return {
            rows: [...byTime.values()].sort((a, b) => a.t - b.t),
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

    // Pad the ends so the first and last markers are not clipped by the plot edge.
    const domain = [rows[0].t - DAY_MS * 2, rows[rows.length - 1].t + DAY_MS * 2];

    return (
        <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 10, right: 24, bottom: 30, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                    {/*
                      A real time axis, not a category one. Snapshots are irregular —
                      four days in a row in October, then a two-month gap — and category
                      spacing would draw that gap as one even step, making a slow drift
                      look like a sudden jump.
                    */}
                    <XAxis
                        dataKey="t"
                        type="number"
                        scale="time"
                        domain={domain}
                        tickFormatter={formatDay}
                        tick={{ fill: '#9ca3af', fontSize: 12 }}
                        axisLine={{ stroke: '#4b5563' }}
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
