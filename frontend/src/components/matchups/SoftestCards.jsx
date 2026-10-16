import React from 'react';
import { POSITIONS, POSITION_NAMES, POSITION_COLORS } from './heat';

// The headline: per position, the defense that gives up the most per 36 minutes and
// the one that gives up the least.
export default function SoftestCards({ teams, league }) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {POSITIONS.map(p => {
                const sorted = [...teams].sort((a, b) => b.pos[p].p36 - a.pos[p].p36);
                const soft = sorted[0];
                const tough = sorted[sorted.length - 1];
                return (
                    <div key={p} className="glass-panel p-4">
                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-gray-500">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: POSITION_COLORS[p] }} />
                            Softest vs {POSITION_NAMES[p]}
                        </div>
                        <div className="mt-1 text-lg font-semibold text-white leading-tight">{soft.name}</div>
                        <div className="mt-1 text-xs text-gray-400">
                            <span className="font-mono text-green-400">{soft.pos[p].p36.toFixed(1)}</span> FPT/36 allowed
                            · league <span className="font-mono">{league[p].p36.toFixed(1)}</span>
                        </div>
                        <div className="text-xs text-gray-500">
                            Toughest: {tough.name} (<span className="font-mono text-red-400">{tough.pos[p].p36.toFixed(1)}</span>)
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
