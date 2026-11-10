import React from 'react';
import { COACH_OUTCOMES, coachScore, pct } from '../../lib/optimizer/score';

/**
 * The chance of each score a coach can make in his next game, the most likely one
 * marked - `outlook` is /api/expected's coach entry ({ likely, dist, ... }).
 */
export default function CoachOdds({ outlook, className = '' }) {
    if (!outlook?.opp || !outlook.dist) return null;
    return (
        <span className={`flex flex-wrap gap-1 ${className}`}>
            {COACH_OUTCOMES.map(pts => {
                const likely = pts === outlook.likely;
                return (
                    <span
                        key={pts}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums ${likely
                            ? 'bg-purple-500/20 text-purple-100 font-semibold'
                            : 'bg-white/[0.04] text-gray-500'}`}
                    >
                        {coachScore(pts)} <span className={likely ? 'text-purple-200' : 'text-gray-600'}>{pct(outlook.dist[String(pts)])}</span>
                    </span>
                );
            })}
        </span>
    );
}
