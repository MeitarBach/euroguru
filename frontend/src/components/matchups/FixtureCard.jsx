import React from 'react';
import { POSITIONS, heatStyle, pctVs } from './heat';

const formatDate = (iso) => {
    if (!iso) return 'Date TBC';
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

// One game of the round. Each side's chips are the defense it faces, per position,
// relative to the league. Once the game is played, a line under each side shows what
// its G / F / C actually scored against the team's own average.
export default function FixtureCard({ fixture, teams, league }) {
    const { home, away, played } = fixture;

    const side = (me, opp) => {
        const mine = teams[me];
        const theirs = teams[opp];
        if (!mine || !theirs) return null;
        return (
            <>
                <div className="grid grid-cols-[1fr_repeat(3,52px)] gap-1.5 items-center py-1">
                    <div className="min-w-0">
                        <span className="font-medium text-white">{mine.name}</span>
                        {played && <span className="ml-1.5 font-mono text-gray-300">{fixture.score[me]}</span>}
                        <span className="ml-1.5 text-xs text-gray-600">vs {opp}</span>
                    </div>
                    {POSITIONS.map(p => (
                        <span
                            key={p}
                            className="text-center text-xs font-mono rounded-md py-1 text-gray-100"
                            style={heatStyle(theirs.pos[p].p36, league[p].p36)}
                        >
                            {pctVs(theirs.pos[p].p36, league[p].p36)}
                        </span>
                    ))}
                </div>
                {played && (
                    <div className="grid grid-cols-[1fr_repeat(3,52px)] gap-1.5 items-center pb-1.5 text-xs">
                        <span className="text-gray-600">actual vs own avg</span>
                        {POSITIONS.map(p => {
                            const act = fixture.actual[me][p];
                            const d = act - mine.off[p];
                            return (
                                <span key={p} className={`text-center font-mono ${d >= 0 ? 'text-green-400' : 'text-red-400'}`} title={`own average ${mine.off[p]}`}>
                                    {act.toFixed(0)} <span className="text-[10px] opacity-80">{d >= 0 ? '+' : ''}{d.toFixed(0)}</span>
                                </span>
                            );
                        })}
                    </div>
                )}
            </>
        );
    };

    return (
        <div className="glass-panel p-4">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                <span>{formatDate(fixture.date)}{fixture.time ? ` · ${fixture.time} CET` : ''}</span>
                <span className={`font-semibold ${played ? 'text-gray-300' : 'text-purple-300'}`}>{played ? 'Final' : 'Upcoming'}</span>
            </div>
            <div className="grid grid-cols-[1fr_repeat(3,52px)] gap-1.5 text-[10px] uppercase tracking-wider text-gray-600">
                <span />
                {POSITIONS.map(p => <span key={p} className="text-center">{p}</span>)}
            </div>
            {side(home, away)}
            {side(away, home)}
        </div>
    );
}
