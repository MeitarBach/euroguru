import React, { useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Label, Cell,
} from 'recharts';

const POSITION_COLORS = { G: '#8b5cf6', F: '#22d3ee', C: '#f59e0b' };
const DEFAULT_COLOR = '#8b5cf6';

const CustomTooltip = ({ active, payload, valueLabel }) => {
    if (!active || !payload || !payload.length) return null;
    const row = payload[0].payload;
    return (
        <div className="rounded-lg bg-[#16161a] border border-white/15 shadow-2xl px-3 py-2 text-xs">
            <p className="font-bold text-white mb-1">{row.group}</p>
            <p className="text-gray-400">{valueLabel}: {row.value.toFixed(2)}</p>
            {/* The player count is the guard against reading a three-player bar as a
                league-wide truth. */}
            <p className="text-gray-500">{row.count} player{row.count === 1 ? '' : 's'}</p>
        </div>
    );
};

/**
 * Average of a numeric column grouped by a categorical one.
 *
 * Used when exactly one chosen axis is categorical (position, team) — a scatter
 * cannot place a category on a number line, but a grouped average answers the
 * question the user was actually asking.
 */
export default function BarChartPanel({ data, categoryKey, valueKey, categoryLabel, valueLabel, title }) {
    const rows = useMemo(() => {
        const groups = new Map();
        for (const row of data ?? []) {
            const key = row[categoryKey];
            const value = row[valueKey];
            if (key === null || key === undefined || key === '') continue;
            if (typeof value !== 'number' || Number.isNaN(value)) continue;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(value);
        }
        return [...groups.entries()]
            .map(([group, values]) => ({
                group,
                value: values.reduce((a, b) => a + b, 0) / values.length,
                count: values.length,
            }))
            .sort((a, b) => b.value - a.value);
    }, [data, categoryKey, valueKey]);

    return (
        <div className="bg-[#ffffff03] rounded-xl p-4 border border-[#ffffff05]">
            {title && <h3 className="font-semibold text-gray-200 mb-4">{title}</h3>}
            {rows.length === 0 ? (
                <div className="h-[360px] flex items-center justify-center text-gray-500 text-sm">
                    No players have data for both of these metrics in this season.
                </div>
            ) : (
                <div className="h-[280px] md:h-[420px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={rows} margin={{ top: 10, right: 24, bottom: 40, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                            <XAxis
                                dataKey="group"
                                tick={{ fill: '#9ca3af', fontSize: 12 }}
                                axisLine={{ stroke: '#4b5563' }}
                                interval={0}
                                angle={rows.length > 8 ? -35 : 0}
                                textAnchor={rows.length > 8 ? 'end' : 'middle'}
                                height={rows.length > 8 ? 70 : 40}
                            >
                                <Label value={categoryLabel} offset={-4} position="insideBottom" fill="#9ca3af" />
                            </XAxis>
                            <YAxis
                                tick={{ fill: '#9ca3af', fontSize: 12 }}
                                axisLine={{ stroke: '#4b5563' }}
                                domain={[0, 'auto']}
                            >
                                <Label value={valueLabel} angle={-90} position="insideLeft" fill="#9ca3af" />
                            </YAxis>
                            <Tooltip
                                content={<CustomTooltip valueLabel={valueLabel} />}
                                cursor={{ fill: '#ffffff08' }}
                            />
                            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                {rows.map(row => (
                                    <Cell key={row.group} fill={POSITION_COLORS[row.group] ?? DEFAULT_COLOR} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
