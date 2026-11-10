import React from 'react';
import { LayoutGroup } from 'framer-motion';
import WatchCard from '../WatchCard';
import CoachCard from '../CoachCard';
import { decimalsFor } from '../../../lib/live/format';

const fixed = (x) => x.toFixed(decimalsFor(x));

/**
 * A scored team as stat cards - starters, the sixth man, the bench, then the coach -
 * each section with its counted total. Read-only: teams are edited in My Teams.
 */
export default function LineupCards({ group, history, lastEvent, now, onOpenPlayer, alsoIn }) {
    return (
        <LayoutGroup id={group.id}>
            {[
                ['Starters', group.rows.filter(r => !r.benched), null],
                ['6th man', group.rows.filter(r => r.sixth), 'counts in full'],
                ['Bench', group.rows.filter(r => r.benched && !r.sixth), 'count half'],
            ].filter(([, rows], i) => i === 0 || rows.length).map(([title, rows, note]) => (
                <div key={title} className="space-y-2">
                    <div className="flex items-baseline justify-between px-1 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                        <span>
                            {title} · {rows.length}
                            {note && <span className="normal-case tracking-normal font-normal text-gray-600"> · {note}</span>}
                        </span>
                        <span className="font-mono normal-case tracking-normal text-gray-400">
                            {fixed(rows.reduce((s, r) => s + (r.counted ?? 0), 0))}
                        </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2">
                        {rows.map(row => (
                            <WatchCard
                                key={row.key}
                                row={row}
                                history={history[row.key]}
                                lastEvent={lastEvent.get(row.key)}
                                now={now}
                                alsoIn={alsoIn ? alsoIn(row.key) : []}
                                onOpen={() => onOpenPlayer(row.player.PlayerName)}
                            />
                        ))}
                    </div>
                </div>
            ))}
            {group.coachRow && (
                <div className="space-y-2">
                    <div className="flex items-baseline justify-between px-1 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                        <span>Coach <span className="normal-case tracking-normal font-normal text-gray-600"> · scores the club's margin</span></span>
                        <span className="font-mono normal-case tracking-normal text-gray-400">{fixed(group.coachRow.counted ?? 0)}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2">
                        <CoachCard row={group.coachRow} history={history[group.coachRow.key]} lastEvent={lastEvent.get(group.coachRow.key)} now={now} />
                    </div>
                </div>
            )}
        </LayoutGroup>
    );
}
