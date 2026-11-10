import React, { useState } from 'react';
import { LayoutGroup } from 'framer-motion';
import { Radio, UserPlus, Plus } from 'lucide-react';
import WatchCard from '../WatchCard';
import CoachCard from '../CoachCard';
import CoachPicker from '../CoachPicker';
import ActivityFeed from '../ActivityFeed';
import { GroupHeader } from '../GroupBoard';
import { decimalsFor } from '../../../lib/live/format';
import { primaryBtn } from './ui';

const fixed = (x) => x.toFixed(decimalsFor(x));

function EmptyState({ group, suggestions, onAdd, onPick }) {
    return (
        <div className="glass-panel p-6 sm:p-8 text-center">
            <div className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center bg-purple-500/15 border border-purple-500/30 text-purple-300">
                <Radio size={22} />
            </div>
            <h3 className="text-lg font-semibold text-white">Who's in {group.name}?</h3>
            <p className="mt-1 text-sm text-gray-400 max-w-md mx-auto">
                Add the players on this roster. Their fantasy points update live while they play, and the group's total
                moves with every basket, board and turnover.
            </p>
            <button type="button" onClick={onPick} className={`mt-4 ${primaryBtn}`}>
                <UserPlus size={16} /> Choose players
            </button>
            {suggestions.length > 0 && (
                <div className="mt-6">
                    <div className="text-[11px] uppercase tracking-wider text-gray-600 mb-2">Or start with the top scorers in this round</div>
                    <div className="flex flex-wrap justify-center gap-2">
                        {suggestions.map(p => (
                            <button
                                key={p.PlayerKey}
                                type="button"
                                onClick={() => onAdd(p.PlayerKey)}
                                className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-full text-xs border border-white/10 bg-white/5 text-gray-200 hover:bg-purple-500/15 hover:border-purple-500/30"
                            >
                                <Plus size={12} /> {p.PlayerName}
                                <span className="font-mono text-gray-500">{p.Average_Score.toFixed(1)}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * The watchlist's head coach: their card, or a way to pick one. A coach is worth their
 * club's margin, so they count from the first basket of their game.
 */
function CoachSlot({ group, coaches, games, history, lastEvent, now, onPick }) {
    const [picking, setPicking] = useState(false);
    const coach = group.coachRow;
    if (!coach && !coaches.length) return null;
    return (
        <div className="relative space-y-2">
            <div className="flex items-baseline justify-between px-1 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                <span>
                    Coach
                    <span className="normal-case tracking-normal font-normal text-gray-600"> · scores the club's margin</span>
                </span>
                <span className="flex items-baseline gap-3 normal-case tracking-normal">
                    {coach && (
                        <button type="button" onClick={() => setPicking(p => !p)} className="font-normal text-purple-300 hover:text-purple-200">
                            Change
                        </button>
                    )}
                    {coach && <span className="font-mono text-gray-400">{fixed(coach.counted ?? 0)}</span>}
                </span>
            </div>
            {coach ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2">
                    <CoachCard row={coach} history={history[coach.key]} lastEvent={lastEvent.get(coach.key)} now={now} onRemove={() => onPick(coach.key)} />
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setPicking(p => !p)}
                    className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-white/10 text-sm text-gray-400 hover:text-white hover:border-purple-500/40"
                >
                    <Plus size={14} /> Add a coach
                </button>
            )}
            {picking && (
                <CoachPicker
                    coaches={coaches}
                    games={games}
                    selectedKey={coach?.key ?? null}
                    now={now}
                    onPick={(key) => { onPick(key); setPicking(false); }}
                    onClose={() => setPicking(false)}
                />
            )}
        </div>
    );
}

/**
 * One watchlist, live: any players you follow (no account needed), arranged like a team -
 * starters, a captain, the bench and a coach - with its plays beside it.
 */
export default function WatchlistPage({
    group, watch, canDelete, coaches, games, history, lastEvent, now, suggestions, feed, nameOf, groupsOf,
    onAddPlayers, onShare, onDeleted, onOpenPlayer,
}) {
    const keys = new Set([...group.keys, group.coach].filter(Boolean));
    const events = feed.filter(e => keys.has(e.key));
    return (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
            <section className="xl:col-span-2 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                        <GroupHeader
                            key={group.id}
                            group={group}
                            canDelete={canDelete}
                            onRename={(name) => watch.rename(group.id, name)}
                            onShare={onShare}
                            onDelete={() => { watch.destroy(group.id); onDeleted(); }}
                        />
                    </div>
                    <button type="button" onClick={onAddPlayers} className={primaryBtn}>
                        <UserPlus size={15} /> Add players
                        {watch.limit && <span className="text-[11px] text-purple-200/80">{watch.allKeys.length}/{watch.limit}</span>}
                    </button>
                </div>
                {group.rows.length === 0 ? (
                    <EmptyState group={group} suggestions={suggestions} onAdd={(key) => watch.add(group.id, key)} onPick={onAddPlayers} />
                ) : (
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
                                            alsoIn={groupsOf(row.key).filter(g => g.id !== group.id)}
                                            onRemove={() => watch.remove(group.id, row.key)}
                                            onToggleBench={() => watch.toggleBench(group.id, row.key)}
                                            onToggleCaptain={() => watch.toggleCaptain(group.id, row.key)}
                                            onOpen={() => onOpenPlayer(row.player.PlayerName)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </LayoutGroup>
                )}
                <CoachSlot
                    group={group}
                    coaches={coaches}
                    games={games}
                    history={history}
                    lastEvent={lastEvent}
                    now={now}
                    onPick={(key) => watch.toggleCoach(group.id, key)}
                />
            </section>
            <aside className="space-y-4">
                <ActivityFeed title={group.name} events={events} nameOf={nameOf} groupsOf={groupsOf} />
            </aside>
        </div>
    );
}
