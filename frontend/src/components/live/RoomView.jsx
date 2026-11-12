import React, { useEffect, useRef, useState } from 'react';
import {
    Tv, Link2, Pencil, Trash2, RefreshCw, Plus, Lock, Globe, Check, UserMinus, Shirt, MoreHorizontal, LogOut,
} from 'lucide-react';
import TeamCourt from './TeamCourt';
import ViewSwitch from './ViewSwitch';
import RoomChat from './RoomChat';
import ActivityFeed from './ActivityFeed';
import { GroupBoard } from './GroupBoard';
import LineupCards from './hub/LineupCards';
import { RoomBadges, NameForm, primaryBtn, softBtn, linkBtn, Spinner } from './hub/ui';
import { countdown, decimalsFor } from '../../lib/live/format';
import { roomLink, ROOM_NAME_MAX } from '../../lib/rooms';

const fixed = (x) => x.toFixed(decimalsFor(x));
const btn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium';
const TABS = [['standings', 'Standings'], ['lineup', 'Lineup'], ['chat', 'Chat']];

/** The admin's room actions, behind a ⋯ so the header stays about watching. */
function AdminMenu({ board, onRename, onVisibility, onReset, onClose }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const item = 'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-sm hover:bg-white/[0.07]';
    const pick = (fn) => () => { setOpen(false); fn(); };

    // A click anywhere else, or Escape, closes it. (Not a full-screen backdrop: inside a
    // glass panel, `position: fixed` covers only the panel - its blur makes it the frame.)
    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button type="button" onClick={() => setOpen(o => !o)} aria-label="Room settings" aria-expanded={open} className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/5">
                <MoreHorizontal size={16} />
            </button>
            {open && (
                <>
                    <div className="absolute right-0 top-full mt-1 z-40 w-52 rounded-xl border border-white/10 bg-[#141418] shadow-2xl p-1">
                        <button type="button" className={`${item} text-gray-200`} onClick={pick(onRename)}><Pencil size={14} /> Rename</button>
                        {!board.official && (
                            <button type="button" className={`${item} text-gray-200`} onClick={pick(onVisibility)}>
                                {board.visibility === 'public' ? <><Lock size={14} /> Make private</> : <><Globe size={14} /> Make public</>}
                            </button>
                        )}
                        {board.visibility === 'private' && (
                            <button type="button" className={`${item} text-gray-200`} onClick={pick(onReset)}><RefreshCw size={14} /> New invite link</button>
                        )}
                        <button type="button" className={`${item} text-red-300`} onClick={pick(onClose)}><Trash2 size={14} /> Close the room</button>
                    </div>
                </>
            )}
        </div>
    );
}

/**
 * A Watch Room's page: the room and your teams in it (with a clear way to bring more),
 * the standings and the chat beside the chosen team's lineup. On a phone those three are
 * tabs. `groups` are the room's teams, scored live; `team` the one shown.
 */
export default function RoomView({
    rooms, groups, team, onSelectTeam, lock, now, history, lastEvent, onOpenPlayer, flash,
    view = 'court', onChangeView, photos, crests, onBring, onMyTeams, myTeams, round, userId,
    feed, nameOf, groupsOf,
}) {
    const [editing, setEditing] = useState(null); // 'room' | 'nickname'
    const [confirm, setConfirm] = useState(null); // 'close' | 'reset' | team id to remove
    const [tab, setTab] = useState('standings');
    const board = rooms.board;
    if (!board) return <Spinner className="h-[240px]" />;

    const isAdmin = Boolean(board.is_admin);
    const isMember = Boolean(board.is_member);
    const inRoom = isMember || isAdmin;
    const mineIn = groups.filter(g => g.mine);
    const revealed = Boolean(team?.lineupSaved);
    const full = groups.length >= board.cap;
    const keys = new Set(groups.flatMap(g => [...g.keys, g.coach]).filter(Boolean));
    const events = feed.filter(e => keys.has(e.key));

    const copyLink = async () => {
        if (!board.invite_code) return;
        const link = roomLink(board.invite_code);
        try {
            await navigator.clipboard.writeText(link);
            flash('Invite link copied - send it to your friends');
        } catch {
            flash(link);
        }
    };

    return (
        <div className="space-y-4">
            {/* The room, and you in it. Raised above the panels below: a glass panel's blur
                makes it a stacking context, so without this the ⋯ menu opens underneath them. */}
            <div className="glass-panel relative z-20 p-4 space-y-3">
                {editing === 'room' ? (
                    <NameForm
                        initial={board.name}
                        submitLabel="Save"
                        onSubmit={(name) => { rooms.update(board.id, { name: name.trim().slice(0, ROOM_NAME_MAX) }); setEditing(null); }}
                        onCancel={() => setEditing(null)}
                    />
                ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <Tv size={18} className={board.official ? 'text-amber-200 shrink-0' : 'text-purple-300 shrink-0'} />
                            <h3 className="text-lg font-semibold text-white truncate">{board.name}</h3>
                            <RoomBadges room={board} />
                            <span className="text-xs text-gray-500 shrink-0">{groups.length} of {board.cap} teams · run by {isAdmin ? 'you' : board.admin}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            {!inRoom ? (
                                <button type="button" onClick={onBring} disabled={full} className={primaryBtn}>
                                    <Plus size={15} /> {full ? 'Room is full' : 'Join with a team'}
                                </button>
                            ) : board.invite_code && (
                                <button type="button" onClick={copyLink} className={softBtn}>
                                    <Link2 size={13} /> Copy invite link
                                </button>
                            )}
                            {isAdmin && (
                                <AdminMenu
                                    board={board}
                                    onRename={() => setEditing('room')}
                                    onVisibility={() => rooms.update(board.id, { visibility: board.visibility === 'public' ? 'private' : 'public' })}
                                    onReset={() => setConfirm('reset')}
                                    onClose={() => setConfirm('close')}
                                />
                            )}
                        </div>
                    </div>
                )}

                {confirm === 'reset' && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-gray-300">Make a new invite link? The old one stops working.</span>
                        <button type="button" onClick={() => { rooms.newInvite(board.id); setConfirm(null); }} className={`${btn} bg-purple-600 text-white`}>New link</button>
                        <button type="button" onClick={() => setConfirm(null)} className={`${btn} text-gray-400`}>Cancel</button>
                    </div>
                )}
                {confirm === 'close' && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-gray-300">Close {board.name} for everyone? The room and its chat are deleted; teams are kept.</span>
                        <button type="button" onClick={() => { rooms.close(board.id); setConfirm(null); }} className={`${btn} bg-red-500/15 text-red-300`}>
                            <Check size={12} /> Close room
                        </button>
                        <button type="button" onClick={() => setConfirm(null)} className={`${btn} text-gray-400`}>Keep</button>
                    </div>
                )}

                {inRoom && (
                    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/[0.06]">
                        <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Your teams here</span>
                        {mineIn.map(g => (
                            <span key={g.id} className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full text-xs bg-purple-500/10 border border-purple-500/25 text-gray-100">
                                <span className="w-2 h-2 rounded-full" style={{ background: g.colorHex }} />
                                {g.teamName}
                                <button
                                    type="button"
                                    onClick={() => rooms.removeTeam(board.id, g.id)}
                                    title={`Take ${g.teamName} out of this room`}
                                    aria-label={`Take ${g.teamName} out of this room`}
                                    className="p-0.5 rounded-full text-gray-500 hover:text-red-300"
                                >
                                    <LogOut size={12} />
                                </button>
                            </span>
                        ))}
                        {!mineIn.length && <span className="text-xs text-gray-500">none yet</span>}
                        {myTeams.length > 0 ? (
                            <button type="button" onClick={onBring} disabled={full} className={softBtn}>
                                <Plus size={13} /> Bring a team
                            </button>
                        ) : (
                            <button type="button" onClick={onMyTeams} className={softBtn}><Shirt size={13} /> Build a team</button>
                        )}
                        <span className="ml-auto text-xs text-gray-500">
                            {editing === 'nickname' ? (
                                <span className="inline-block w-60">
                                    <NameForm
                                        initial={rooms.nickname ?? ''}
                                        max={24}
                                        submitLabel="Save"
                                        onSubmit={async (name) => { if (await rooms.changeNickname(name)) setEditing(null); }}
                                        onCancel={() => setEditing(null)}
                                    />
                                </span>
                            ) : (
                                <>You appear as <b className="text-gray-300">{rooms.nickname ?? '…'}</b>{' '}
                                    <button type="button" onClick={() => setEditing('nickname')} className={linkBtn}>edit</button></>
                            )}
                        </span>
                    </div>
                )}
            </div>

            {/* A phone shows one of the three at a time */}
            <div role="tablist" className="xl:hidden grid grid-cols-3 p-1 rounded-xl bg-white/[0.04] border border-white/10">
                {TABS.map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        onClick={() => setTab(id)}
                        className={`py-1.5 rounded-lg text-sm ${tab === id ? 'bg-purple-500/20 text-white font-medium' : 'text-gray-400'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
                {/* The chosen team */}
                <section className={`xl:col-span-2 space-y-3 ${tab === 'lineup' ? '' : 'hidden xl:block'}`}>
                    {team ? (
                        <>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: team.colorHex }} />
                                    <h3 className="text-base font-semibold text-white truncate">{team.teamName}</h3>
                                    <span className="text-xs text-gray-500 shrink-0">{team.nickname} · {fixed(team.sums.total)} FPT</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {revealed && onChangeView && <ViewSwitch view={view} onChange={onChangeView} />}
                                    {isAdmin && !team.mine && (confirm === team.id ? (
                                        <span className="flex items-center gap-1.5 text-xs">
                                            <span className="text-gray-400">Remove {team.teamName}?</span>
                                            <button type="button" onClick={() => { rooms.removeTeam(board.id, team.id); setConfirm(null); onSelectTeam(null); }} className={`${btn} bg-red-500/15 text-red-300`}>Remove</button>
                                            <button type="button" onClick={() => setConfirm(null)} className={`${btn} text-gray-400`}>Keep</button>
                                        </span>
                                    ) : (
                                        <button type="button" onClick={() => setConfirm(team.id)} title="Remove this team from the room" className="p-1.5 rounded-md text-gray-600 hover:text-red-300 hover:bg-red-500/10">
                                            <UserMinus size={14} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {!revealed ? (
                                <div className="glass-panel p-6 text-center">
                                    <Lock size={20} className="mx-auto text-gray-500" />
                                    <p className="mt-2 text-sm text-gray-300">
                                        {(!board.round || board.round.locked === false) && lock.nextLock
                                            ? <>Lineups are revealed at Round {lock.nextRound}'s first tip-off, in {countdown(lock.nextLock - now)}.</>
                                            : <>This team had no lineup when the round locked.</>}
                                    </p>
                                    {team.mine && <p className="mt-1 text-xs text-gray-500">Yours is in My teams until then.</p>}
                                </div>
                            ) : view === 'court' ? (
                                <TeamCourt group={team} photos={photos} crests={crests} now={now} lastEvent={lastEvent} onOpenPlayer={onOpenPlayer} />
                            ) : (
                                <LineupCards group={team} history={history} lastEvent={lastEvent} now={now} onOpenPlayer={onOpenPlayer} />
                            )}
                        </>
                    ) : (
                        <div className="glass-panel p-6 sm:p-8 text-center">
                            <Tv size={22} className="mx-auto text-purple-300" />
                            <h3 className="mt-2 text-base font-semibold text-white">No teams here yet</h3>
                            <p className="mt-1 text-sm text-gray-400 max-w-sm mx-auto">
                                {inRoom
                                    ? 'Bring one of your teams, then copy the invite link and send it to your friends.'
                                    : 'Be the first to bring a team.'}
                            </p>
                            <button type="button" onClick={onBring} className={`mt-4 ${primaryBtn}`}><Plus size={15} /> {inRoom ? 'Bring a team' : 'Join with a team'}</button>
                        </div>
                    )}
                </section>

                <aside className="space-y-4">
                    <div className={tab === 'standings' ? '' : 'hidden xl:block'}>
                        {groups.length > 0 ? (
                            <GroupBoard
                                round={round}
                                groups={groups}
                                selectedId={team?.id}
                                onSelect={(id) => { onSelectTeam(id); setTab('lineup'); }}
                                onCreate={null}
                                noun="standings"
                            />
                        ) : (
                            <div className="glass-panel p-4 text-sm text-gray-500 xl:hidden">The standings start when the first team comes in.</div>
                        )}
                    </div>
                    <div className={tab === 'chat' ? '' : 'hidden xl:block'}>
                        <RoomChat key={board.id} board={board} userId={userId} notify={flash} onJoin={onBring} />
                    </div>
                    <div className="hidden xl:block">
                        <ActivityFeed events={events} nameOf={nameOf} groupsOf={groupsOf} />
                    </div>
                </aside>
            </div>
        </div>
    );
}
