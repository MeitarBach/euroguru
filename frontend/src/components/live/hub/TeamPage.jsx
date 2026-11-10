import React from 'react';
import { Tv, Pencil, Shirt } from 'lucide-react';
import AnimatedNumber from '../AnimatedNumber';
import TeamCourt from '../TeamCourt';
import ViewSwitch from '../ViewSwitch';
import ActivityFeed from '../ActivityFeed';
import { decimalsFor } from '../../../lib/live/format';
import LineupCards from './LineupCards';
import { RoundStatus, RoomChip, LockLine } from './MyTeamsWidget';
import { softBtn, linkBtn, primaryBtn } from './ui';

/**
 * One of your teams, live: its total and who is playing, the rooms it is in, the lineup
 * on the court (or as stat cards), and the plays of its own players beside it.
 */
export default function TeamPage({
    group, rooms, photos, crests, now, lock, round, nextRound, lastEvent, history, view, onChangeView,
    feed, nameOf, groupsOf, onOpenPlayer, onBring, onMyTeams, onOpenRoom,
}) {
    const keys = new Set([...group.keys, group.coach].filter(Boolean));
    const events = feed.filter(e => keys.has(e.key));
    return (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
            <section className="xl:col-span-2 space-y-3">
                <div className="glass-panel p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
                                <Shirt size={18} className="text-purple-300 shrink-0" />
                                <span className="truncate">{group.name}</span>
                            </h3>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                                <RoundStatus group={group} />
                            </div>
                            <div className="mt-0.5 text-xs text-gray-500"><LockLine lock={lock} now={now} /></div>
                            {group.edited && round && (
                                <div className="mt-1 text-xs text-amber-200/80">
                                    The lineup that played Round {round} - your changes count from Round {nextRound?.round ?? round + 1}
                                </div>
                            )}
                        </div>
                        <div className="text-right">
                            <AnimatedNumber
                                value={group.sums.total}
                                decimals={decimalsFor(group.sums.total)}
                                className="block text-3xl leading-none font-bold font-mono text-white"
                            />
                            <span className="text-[11px] text-gray-500">FPT</span>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {rooms.map(r => <RoomChip key={r.id} room={r} onOpen={() => onOpenRoom(r.id)} />)}
                        <button type="button" onClick={onBring} className={softBtn}><Tv size={13} /> Bring to a room</button>
                        <button type="button" onClick={onMyTeams} className={`${linkBtn} ml-auto`}><Pencil size={12} /> Edit lineup in My Teams</button>
                    </div>
                </div>

                {group.rows.length === 0 ? (
                    <div className="glass-panel p-6 text-center">
                        <p className="text-sm text-gray-400">{group.name} has no players yet.</p>
                        <button type="button" onClick={onMyTeams} className={`mt-3 ${primaryBtn}`}><Shirt size={15} /> Pick them in My Teams</button>
                    </div>
                ) : (
                    <>
                        <div className="flex justify-end"><ViewSwitch view={view} onChange={onChangeView} /></div>
                        {view === 'court' ? (
                            <TeamCourt group={group} photos={photos} crests={crests} now={now} lastEvent={lastEvent} onOpenPlayer={onOpenPlayer} />
                        ) : (
                            <LineupCards group={group} history={history} lastEvent={lastEvent} now={now} onOpenPlayer={onOpenPlayer} />
                        )}
                    </>
                )}
            </section>
            <aside className="space-y-4">
                <ActivityFeed title={group.name} events={events} nameOf={nameOf} groupsOf={groupsOf} />
            </aside>
        </div>
    );
}
