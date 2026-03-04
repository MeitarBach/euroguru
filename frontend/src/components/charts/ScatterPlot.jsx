import React from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Label } from 'recharts';

const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="glass-panel p-3 border border-white/10 text-xs">
                <p className="font-bold text-white mb-1">{data.PlayerName}</p>
                <p className="text-gray-300">Pos: {data.position}</p>
                <p className="text-purple-300">Avg PIR: {data.Average_PIR.toFixed(2)}</p>
                {data.StdDev_PIR !== undefined && <p className="text-gray-400">StdDev: {data.StdDev_PIR.toFixed(2)}</p>}
                <p className="text-gray-400">CR: {data.CR}</p>
            </div>
        );
    }
    return null;
};

export default function ScatterPlot({ data, xKey, yKey, xLabel, yLabel, title }) {
    if (!data || data.length === 0) return (
        <div className="h-[400px] flex items-center justify-center text-gray-500">
            No data for chart
        </div>
    );

    return (
        <div className="bg-[#ffffff03] rounded-xl p-4 border border-[#ffffff05]">
            <h3 className="text-lg font-semibold mb-4 text-gray-200">{title}</h3>
            <div className="h-[500px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#444" opacity={0.2} />
                        <XAxis
                            type="number"
                            dataKey={xKey}
                            name={xLabel}
                            tick={{ fill: '#9ca3af', fontSize: 12 }}
                            axisLine={{ stroke: '#4b5563' }}
                        >
                            <Label value={xLabel} offset={-10} position="insideBottom" fill="#9ca3af" />
                        </XAxis>
                        <YAxis
                            type="number"
                            dataKey={yKey}
                            name={yLabel}
                            tick={{ fill: '#9ca3af', fontSize: 12 }}
                            axisLine={{ stroke: '#4b5563' }}
                        >
                            <Label value={yLabel} angle={-90} position="insideLeft" fill="#9ca3af" />
                        </YAxis>
                        <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />
                        <Scatter name="Players" data={data} fill="#8b5cf6" shape="circle" />
                    </ScatterChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
