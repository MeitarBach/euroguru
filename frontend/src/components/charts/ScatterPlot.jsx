import React, { useMemo } from 'react';
import {
    ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Label, ReferenceLine,
} from 'recharts';

const POSITION_COLORS = { G: '#8b5cf6', F: '#22d3ee', C: '#f59e0b' };
const DEFAULT_COLOR = '#8b5cf6';
const DEFAULT_RADIUS = 4.5;   // matches Recharts' default dot
const MIN_RADIUS = 3;
const MAX_RADIUS = 11;

const DEFAULT_TOOLTIP_FIELDS = [
    { key: 'Average_Score', label: 'Avg' },
    { key: 'StdDev_Score', label: 'StdDev' },
    { key: 'CR', label: 'CR' },
];

const CustomTooltip = ({ active, payload, fields }) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="rounded-lg bg-[#16161a] border border-white/15 shadow-2xl px-3 py-2 text-xs">
                <p className="font-bold text-white mb-1">{data.PlayerName}</p>
                <p className="text-gray-300">Pos: {data.position}</p>
                {/* Priced players with no games yet arrive with a null score, so no
                    value here can be assumed to be a number. */}
                {(fields ?? DEFAULT_TOOLTIP_FIELDS).map(({ key, label, suffix = '' }) => (
                    data[key] === null || data[key] === undefined ? null : (
                        <p key={key} className="text-gray-400">
                            {label}: {typeof data[key] === 'number' ? data[key].toFixed(2) : data[key]}{suffix}
                        </p>
                    )
                ))}
            </div>
        );
    }
    return null;
};

const median = (values) => {
    const sorted = values.filter(v => typeof v === 'number' && !Number.isNaN(v)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const Panel = ({ title, legend, children }) => (
    <div className="bg-[#ffffff03] rounded-xl p-4 border border-[#ffffff05]">
        {title && <h3 className="font-semibold text-gray-200 mb-4">{title}</h3>}
        {legend && legend.length > 0 && (
            <div className="flex items-center justify-center gap-4 mb-2">
                {legend.map(({ value, color }) => (
                    <span key={value} className="flex items-center gap-1.5 text-xs text-gray-400">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                        {value}
                    </span>
                ))}
            </div>
        )}
        {children}
    </div>
);

/**
 * Scatter plot with optional layers, each independently switchable.
 *
 *   colorBy       - field to split into coloured series (adds a legend)
 *   showQuadrants - median cross-hairs, splitting the plot into four regions
 *   labelTop      - label only the N highest points on the y axis
 *   sizeBy        - field encoded as dot area, giving a third dimension
 */
export default function ScatterPlot({
    data, xKey, yKey, xLabel, yLabel, title, tooltipFields,
    colorBy, showQuadrants, labelTop = 0, sizeBy, onSelectPlayer,
}) {
    // Rows missing either axis cannot be positioned, and Recharts would silently
    // drop them at the origin.
    const rows = useMemo(
        () => (data ?? []).filter(d =>
            typeof d[xKey] === 'number' && !Number.isNaN(d[xKey]) &&
            typeof d[yKey] === 'number' && !Number.isNaN(d[yKey])
        ),
        [data, xKey, yKey]
    );

    const colorOf = (row) =>
        (colorBy ? POSITION_COLORS[row[colorBy]] : null) ?? DEFAULT_COLOR;

    // Legend entries come from the categories actually present, so a season with no
    // centres does not advertise an empty "C".
    const legendPayload = useMemo(() => {
        if (!colorBy) return null;
        const seen = [...new Set(rows.map(r => r[colorBy]).filter(v => v !== null && v !== undefined && v !== ''))];
        return seen
            .sort((a, b) => String(a).localeCompare(String(b)))
            .map(value => ({
                value,
                type: 'circle',
                id: String(value),
                color: POSITION_COLORS[value] ?? DEFAULT_COLOR,
            }));
    }, [rows, colorBy]);

    // Memoise the scale's inputs, not a closure: the React compiler cannot preserve
    // memoization of a returned function, and the per-row maths is trivial anyway.
    const sizeScale = useMemo(() => {
        if (!sizeBy) return null;
        const values = rows
            .map(r => r[sizeBy])
            .filter(v => typeof v === 'number' && !Number.isNaN(v));
        if (!values.length) return null;
        const min = Math.min(...values);
        return { min, span: (Math.max(...values) - min) || 1 };
    }, [rows, sizeBy]);

    const radiusOf = (row) => {
        if (!sizeScale) return DEFAULT_RADIUS;
        const value = row[sizeBy];
        if (typeof value !== 'number' || Number.isNaN(value)) return MIN_RADIUS;
        // Area-proportional: a dot twice the value reads as twice as big, rather than
        // four times, which is what scaling the radius linearly would do.
        const t = (value - sizeScale.min) / sizeScale.span;
        return Math.sqrt(MIN_RADIUS ** 2 + t * (MAX_RADIUS ** 2 - MIN_RADIUS ** 2));
    };

    // Median, not mean: these distributions are skewed by a handful of stars, and a
    // mean line lands somewhere nobody actually sits.
    const midX = useMemo(() => (showQuadrants ? median(rows.map(r => r[xKey])) : null), [rows, xKey, showQuadrants]);
    const midY = useMemo(() => (showQuadrants ? median(rows.map(r => r[yKey])) : null), [rows, yKey, showQuadrants]);

    // Labelling ~300 players is unreadable, so only the top few get names — and
    // Recharts does no collision avoidance, so the leaders (who cluster together by
    // definition) would print on top of each other. Walk down by y and keep a
    // candidate only when it is far enough from every label already accepted,
    // measured in normalised axis space so it works whatever the units are.
    const labelled = useMemo(() => {
        if (!labelTop) return new Set();
        const xs = rows.map(r => r[xKey]);
        const ys = rows.map(r => r[yKey]);
        const spanX = Math.max(...xs) - Math.min(...xs) || 1;
        const spanY = Math.max(...ys) - Math.min(...ys) || 1;
        const minGap = 0.045; // ~4.5% of the plot, about one label's height

        const accepted = [];
        for (const row of [...rows].sort((a, b) => b[yKey] - a[yKey])) {
            if (accepted.length >= labelTop) break;
            const clash = accepted.some(other =>
                Math.abs((row[xKey] - other[xKey]) / spanX) < minGap &&
                Math.abs((row[yKey] - other[yKey]) / spanY) < minGap
            );
            if (!clash) accepted.push(row);
        }
        return new Set(accepted.map(r => r.PlayerName));
    }, [rows, xKey, yKey, labelTop]);

    if (!rows.length) {
        return (
            <Panel title={title}>
                <div className="h-[360px] flex items-center justify-center text-gray-500 text-sm">
                    No players have data for both of these metrics in this season.
                </div>
            </Panel>
        );
    }

    return (
        <Panel title={title} legend={legendPayload}>
            <div className="h-[280px] md:h-[420px]">
                <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 24, bottom: 30, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                        <XAxis
                            type="number"
                            dataKey={xKey}
                            name={xLabel}
                            domain={['auto', 'auto']}
                            tick={{ fill: '#9ca3af', fontSize: 12 }}
                            axisLine={{ stroke: '#4b5563' }}
                        >
                            <Label value={xLabel} offset={-16} position="insideBottom" fill="#9ca3af" />
                        </XAxis>
                        <YAxis
                            type="number"
                            dataKey={yKey}
                            name={yLabel}
                            domain={['auto', 'auto']}
                            tick={{ fill: '#9ca3af', fontSize: 12 }}
                            axisLine={{ stroke: '#4b5563' }}
                        >
                            <Label value={yLabel} angle={-90} position="insideLeft" fill="#9ca3af" />
                        </YAxis>
                        {showQuadrants && midX !== null && (
                            <ReferenceLine x={midX} stroke="#6b7280" strokeDasharray="4 4" />
                        )}
                        {showQuadrants && midY !== null && (
                            <ReferenceLine y={midY} stroke="#6b7280" strokeDasharray="4 4" />
                        )}

                        <Tooltip content={<CustomTooltip fields={tooltipFields} />} cursor={{ strokeDasharray: '3 3' }} />

                        {/*
                          Exactly one <Scatter>, deliberately. Recharts activates the
                          tooltip by index, and CustomTooltip reads payload[0] — so
                          splitting the points into a series per category made every
                          hover report the FIRST series' point at that index instead of
                          the one under the cursor (a purple guard would show a centre's
                          name and "Pos: C").

                          The points are drawn by a custom shape. <Cell> children were
                          tried first but Recharts' cell path overrides the point entry
                          and silently drops both the ZAxis size and any LabelList, so
                          dot sizing and labels stopped working. Drawing the circle and
                          its label directly keeps colour, size and labels all under our
                          control, with one series for the tooltip to resolve against.
                        */}
                        <Scatter
                            name="Players"
                            data={rows}
                            shape={(props) => {
                                const row = props.payload;
                                const r = radiusOf(row);
                                return (
                                    <g>
                                        <circle
                                            cx={props.cx}
                                            cy={props.cy}
                                            r={r}
                                            fill={colorOf(row)}
                                            onClick={onSelectPlayer
                                                ? () => onSelectPlayer(row.PlayerName)
                                                : undefined}
                                            style={onSelectPlayer ? { cursor: 'pointer' } : undefined}
                                        />
                                        {labelled.has(row.PlayerName) && (
                                            <text
                                                x={props.cx}
                                                y={props.cy - r - 4}
                                                textAnchor="middle"
                                                fill="#d1d5db"
                                                fontSize={10}
                                            >
                                                {row.PlayerName}
                                            </text>
                                        )}
                                    </g>
                                );
                            }}
                        />
                    </ScatterChart>
                </ResponsiveContainer>
            </div>
        </Panel>
    );
}
