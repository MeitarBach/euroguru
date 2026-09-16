import React from 'react';

// The window of games every stat on the page is computed over. Labelled "Based on"
// because that is what it does — "View As" said nothing about games at all.
const GAMES_WINDOWS = [
    { value: 1, label: 'Last game' },
    { value: 3, label: 'Last 3 games' },
    { value: 5, label: 'Last 5 games' },
    { value: 10, label: 'Last 10 games' },
    { value: 100, label: 'Full season' },
];

export default function GamesWindowSelect({ value, onChange }) {
    return (
        <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Based on</label>
            <select
                value={value}
                onChange={(e) => onChange(parseInt(e.target.value, 10))}
                className="input-dark bg-[#0a0a0c] min-w-[150px] text-purple-400 font-medium"
            >
                {GAMES_WINDOWS.map(w => (
                    <option key={w.value} value={w.value}>{w.label}</option>
                ))}
            </select>
        </div>
    );
}
