import React, { useState } from 'react';
import {
    Tv, Link2, Pencil, Trash2, RefreshCw, Plus, LogIn, LogOut, Lock, X, Check, UserMinus, Globe, BadgeCheck,
    ChevronLeft, Shirt,
} from 'lucide-react';
import WatchCard from './WatchCard';
import CoachCard from './CoachCard';
import TeamCourt from './TeamCourt';
import ViewSwitch from './ViewSwitch';
import SearchInput from '../SearchInput';
import { countdown, decimalsFor } from '../../lib/live/format';
import { roomLink, ROOM_NAME_MAX } from '../../lib/rooms';
import { TEAM_LIMIT } from '../../lib/teams';

const fixed = (x) => x.toFixed(decimalsFor(x));
const btn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium';
const primary = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 disabled:opacity-50';

function NameForm({ initial = '', placeholder, max = ROOM_NAME_MAX, submitLabel, onSubmit, onCancel, children }) {
    const [value, setValue] = useState(initial);
    return (
        <form className="flex flex-wrap items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}>
            <input
                autoFocus
                value={value}
                maxLength={max}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel(); } }}
                placeholder={placeholder}
                className="input-dark flex-1 min-w-[10rem] py-1.5 text-sm"
            />
            {children}
            <button type="submit" className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-purple-600 hover:bg-purple-500">
                {submitLabel}
            </button>
            {onCancel && (
                <button type="button" onClick={onCancel} aria-label="Cancel" className="p-1.5 rounded-lg text-gray-500 hover:text-white">
                    <X size={14} />
                </button>
            )}
        </form>
    );
}

/** Public | Private, for a new room or an admin's change. */
function VisibilitySwitch({ value, onChange }) {
    return (
        <div className="inline-flex p-0.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs">
            {[['private', 'Private', <Lock key="i" size={11} />], ['public', 'Public', <Globe key="i" size={11} />]].map(([id, label, icon]) => (
                <button
                    key={id}
                    type="button"
                    aria-pressed={value === id}
                    onClick={() => onChange(id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md ${value === id ? 'bg-purple-500/20 text-white font-medium' : 'text-gray-400 hover:text-white'}`}
                >
                    {icon} {label}
                </button>
            ))}
        </div>
    );
}

function RoomBadges({ room }) {
    return (
        <>
            {room.official && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-200 text-[10px] font-semibold uppercase tracking-wide">
                    <BadgeCheck size={11} /> Official
                </span>
            )}
            {!room.official && (room.visibility === 'public'
                ? <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300"><Globe size={11} /> Public</span>
                : <span className="inline-flex items-center gap-1 text-[10px] text-gray-500"><Lock size={11} /> Private</span>)}
        </>
    );
}

function RoomRow({ room, onOpen }) {
    const mine = (room.my_teams ?? []).length;
    return (
        <button
            type="button"
            onClick={() => onOpen(room.id)}
            className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border text-left transition-colors ${room.official
                ? 'border-amber-400/25 bg-amber-400/[0.04] hover:bg-amber-400/[0.08]'
                : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'}`}
        >
            <Tv size={16} className={room.official ? 'text-amber-200 shrink-0' : 'text-purple-300 shrink-0'} />
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-white truncate">{room.name}</span>
                    <RoomBadges room={room} />
                </span>
                <span className="block text-xs text-gray-500 truncate">
                    {room.is_admin ? 'Yours' : `Run by ${room.admin}`} · {room.teams} of {room.cap} teams
                    {mine > 0 && <span className="text-purple-300"> · {mine === 1 ? '1 of your teams' : `${mine} of your teams`}</span>}
                </span>
            </span>
        </button>
    );
}

/**
 * Watch Rooms before one is open: the ones you are in, a new one, and the public
 * directory with the official EuroGuru room pinned on top. Signed out, an invitation.
 */
export function RoomsDirectory({ rooms, onSignIn, onMyTeams }) {
    const [creating, setCreating] = useState(false);
    const [visibility, setVisibility] = useState('private');

    if (!rooms.signedIn) {
        return (
            <section className="xl:col-span-2 glass-panel p-6 sm:p-8 text-center">
                <div className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center bg-purple-500/15 border border-purple-500/30 text-purple-300">
                    <Tv size={22} />
                </div>
                <h3 className="text-lg font-semibold text-white">Watch the round together</h3>
                <p className="mt-1 text-sm text-gray-400 max-w-md mx-auto">
                    Bring your fantasy teams into a Watch Room, see everyone's points move live, and chat while the games
                    are on. Join a public room or make a private one for your friends.
                </p>
                <button type="button" onClick={onSignIn} className={`mt-4 ${primary}`}>
                    <LogIn size={16} /> Sign in free
                </button>
            </section>
        );
    }
    if (rooms.status !== 'ready') {
        return (
            <section className="xl:col-span-2 w-full h-[200px] flex items-center justify-center">
                <div className="w-7 h-7 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
            </section>
        );
    }

    return (
        <section className="xl:col-span-2 space-y-5">
            <div className="glass-panel p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-white">Your rooms</h3>
                    {!creating && (
                        <button type="button" onClick={() => setCreating(true)} className={`${btn} text-purple-300 hover:text-purple-200`}>
                            <Plus size={13} /> New room
                        </button>
                    )}
                </div>
                {creating && (
                    <div className="space-y-1.5">
                        <NameForm
                            placeholder="Room name"
                            submitLabel="Create"
                            onSubmit={async (name) => { if (await rooms.create(name, visibility)) setCreating(false); }}
                            onCancel={() => setCreating(false)}
                        >
                            <VisibilitySwitch value={visibility} onChange={setVisibility} />
                        </NameForm>
                        <p className="text-[11px] text-gray-500">
                            {visibility === 'public'
                                ? 'Anyone signed in can find and join it (up to 200 teams).'
                                : 'Only people with the invite link can join (up to 50 teams).'}
                        </p>
                    </div>
                )}
                {rooms.rooms.length ? (
                    <div className="space-y-2">
                        {rooms.rooms.map(r => <RoomRow key={r.id} room={r} onOpen={rooms.open} />)}
                    </div>
                ) : !creating && (
                    <p className="text-sm text-gray-400">
                        You're not in a room yet. Join a public one below, open an invite link a friend sent, or make your own.
                        Build your teams in{' '}
                        <button type="button" onClick={onMyTeams} className="text-purple-300 hover:text-purple-200">My Teams</button>.
                    </p>
                )}
            </div>

            <div className="glass-panel p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-white">Public rooms</h3>
                    <SearchInput
                        className="w-full sm:w-64"
                        value={rooms.search}
                        onChange={rooms.setSearch}
                        placeholder="Search rooms"
                        inputClassName="input-dark w-full py-1.5 text-sm"
                    />
                </div>
                <div className="space-y-2">
                    {rooms.publicRooms.map(r => <RoomRow key={r.id} room={r} onOpen={rooms.open} />)}
                    {rooms.directoryStatus === 'ready' && !rooms.publicRooms.length && (
                        <p className="text-sm text-gray-500">
                            {rooms.search ? `No public room matches “${rooms.search}”.` : 'No public rooms yet - make the first one.'}
                        </p>
                    )}
                    {rooms.directoryStatus === 'error' && <p className="text-sm text-gray-500">Couldn't load the public rooms.</p>}
                </div>
            </div>
        </section>
    );
}

/**
 * Bringing teams into a room - from an invite link, or a public room's Join button:
 * which room it is, and which of your teams come in. With no team yet, one can be made
 * here (its players are picked in My Teams).
 */
export function JoinRoomDialog({ room, myTeams, onCreateTeam, onJoin, onClose }) {
    const joined = new Set(room.my_teams ?? []);
    const open = myTeams.filter(t => !joined.has(t.id));
    const [chosen, setChosen] = useState(() => new Set(open.slice(0, 1).map(t => t.id)));
    const [busy, setBusy] = useState(false);
    const toggle = (id) => setChosen(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const full = room.teams >= room.cap;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
            <div className="w-full max-w-md glass-panel p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                            {room.code ? 'Watch Room invite' : 'Join a Watch Room'}
                        </div>
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">{room.name} <RoomBadges room={room} /></h3>
                        <p className="text-sm text-gray-400">
                            Run by {room.admin} · {room.teams} of {room.cap} teams
                        </p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-gray-500 hover:text-white">
                        <X size={16} />
                    </button>
                </div>

                {full ? (
                    <p className="text-sm text-amber-200">This room is full.</p>
                ) : open.length ? (
                    <div className="space-y-1.5">
                        <div className="text-sm text-gray-300">Which of your teams come in?</div>
                        {open.map(t => (
                            <label key={t.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10 cursor-pointer">
                                <input type="checkbox" checked={chosen.has(t.id)} onChange={() => toggle(t.id)} />
                                <span className="flex-1 text-sm text-white truncate">{t.name}</span>
                                <span className="text-xs text-gray-500">{t.keys.length} players</span>
                            </label>
                        ))}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="text-sm text-gray-300">
                            {myTeams.length ? 'All your teams are already in.' : 'Make a team to bring - you can pick its players in My Teams.'}
                        </div>
                        {myTeams.length < TEAM_LIMIT && <NameForm placeholder="Team name" max={24} submitLabel="Create team" onSubmit={onCreateTeam} />}
                    </div>
                )}

                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white">
                        Not now
                    </button>
                    <button
                        type="button"
                        disabled={full || !chosen.size || busy}
                        onClick={async () => { setBusy(true); await onJoin([...chosen]); setBusy(false); }}
                        className={primary}
                    >
                        Join{chosen.size > 1 ? ` with ${chosen.size} teams` : ''}
                    </button>
                </div>
            </div>
        </div>
    );
}

/** The open room: its name and link, your teams in it, and the chosen team's lineup. */
export default function RoomView({
    rooms, myTeams, groups, team, onSelectTeam, lock, now, history, lastEvent, onOpenPlayer, flash,
    view = 'court', onChangeView, photos, crests, onJoin, onMyTeams,
}) {
    const [editing, setEditing] = useState(null); // 'room' | 'nickname'
    const [confirm, setConfirm] = useState(null); // 'close' | 'reset' | team id to remove
    const board = rooms.board;
    if (!board) {
        return (
            <section className="xl:col-span-2 w-full h-[200px] flex items-center justify-center">
                <div className="w-7 h-7 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
            </section>
        );
    }

    const isAdmin = Boolean(board.is_admin);
    const isMember = Boolean(board.is_member);
    const inRoom = new Set(groups.map(g => g.id));
    const mineIn = groups.filter(g => g.mine);
    const canAdd = myTeams.filter(t => !inRoom.has(t.id));
    const round = board.round;
    const revealed = Boolean(team?.lineupSaved);

    const copyLink = async () => {
        if (!board.invite_code) return;
        const link = roomLink(board.invite_code);
        try {
            await navigator.clipboard.writeText(link);
            flash('Invite link copied');
        } catch {
            flash(link);
        }
    };

    return (
        <section className="xl:col-span-2 space-y-4">
            <button type="button" onClick={() => rooms.open(null)} className={`${btn} -ml-2 text-gray-400 hover:text-white`}>
                <ChevronLeft size={14} /> All rooms
            </button>

            <div className="glass-panel p-4 space-y-3">
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
                            <Tv size={16} className="text-purple-300 shrink-0" />
                            <h3 className="text-base font-semibold text-white truncate">{board.name}</h3>
                            <RoomBadges room={board} />
                            <span className="text-xs text-gray-500 shrink-0">{groups.length} of {board.cap} teams</span>
                            {isAdmin && (
                                <button type="button" onClick={() => setEditing('room')} aria-label="Rename room" className="p-1 rounded-md text-gray-600 hover:text-white">
                                    <Pencil size={13} />
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5">
                            {!isMember && !isAdmin ? (
                                <button type="button" onClick={onJoin} className={primary}>
                                    <Plus size={15} /> Join with a team
                                </button>
                            ) : board.invite_code && (
                                <button type="button" onClick={copyLink} className={`${btn} text-purple-200 bg-purple-500/15 border border-purple-500/30 hover:bg-purple-500/25`}>
                                    <Link2 size={13} /> Copy invite link
                                </button>
                            )}
                            {isAdmin && confirm === null && (
                                <>
                                    {board.visibility === 'private' && (
                                        <button type="button" onClick={() => setConfirm('reset')} title="Make a new link; the old one stops working" className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-white/5">
                                            <RefreshCw size={14} />
                                        </button>
                                    )}
                                    <button type="button" onClick={() => setConfirm('close')} title="Close the room" className="p-1.5 rounded-md text-gray-600 hover:text-red-300 hover:bg-red-500/10">
                                        <Trash2 size={14} />
                                    </button>
                                </>
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

                {/* You in it */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-gray-400">
                    {editing === 'nickname' ? (
                        <div className="w-60">
                            <NameForm
                                initial={rooms.nickname ?? ''}
                                max={24}
                                submitLabel="Save"
                                onSubmit={async (name) => { if (await rooms.changeNickname(name)) setEditing(null); }}
                                onCancel={() => setEditing(null)}
                            />
                        </div>
                    ) : (
                        <span>
                            You appear as <b className="text-gray-200">{rooms.nickname ?? '…'}</b>
                            <button type="button" onClick={() => setEditing('nickname')} className="ml-1.5 text-purple-300 hover:text-purple-200">edit</button>
                        </span>
                    )}
                    {mineIn.map(g => (
                        <span key={g.id} className="inline-flex items-center gap-1">
                            · {g.teamName}
                            <button
                                type="button"
                                onClick={() => rooms.removeTeam(board.id, g.id)}
                                title={`Take ${g.teamName} out of this room`}
                                className="p-0.5 rounded text-gray-600 hover:text-red-300"
                            >
                                <LogOut size={12} />
                            </button>
                        </span>
                    ))}
                    {isAdmin && !board.official && (
                        <VisibilitySwitch value={board.visibility} onChange={(v) => v !== board.visibility && rooms.update(board.id, { visibility: v })} />
                    )}
                    {(isMember || isAdmin) && canAdd.length > 0 && groups.length < board.cap && (
                        <select
                            value=""
                            onChange={(e) => e.target.value && rooms.join(board, [e.target.value])}
                            className="input-dark py-1 text-xs"
                        >
                            <option value="">+ Bring another team…</option>
                            {canAdd.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                    )}
                    {!myTeams.length && (
                        <button type="button" onClick={onMyTeams} className="inline-flex items-center gap-1 text-purple-300 hover:text-purple-200">
                            <Shirt size={12} /> Build a team
                        </button>
                    )}
                </div>
            </div>

            {/* The chosen team */}
            {team && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: team.colorHex }} />
                            <h3 className="text-base font-semibold text-white truncate">{team.teamName}</h3>
                            <span className="text-xs text-gray-500 shrink-0">
                                {team.nickname} · {fixed(team.sums.total)} FPT
                            </span>
                        </div>
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

                    {revealed && onChangeView && (
                        <div className="flex justify-end">
                            <ViewSwitch view={view} onChange={onChangeView} />
                        </div>
                    )}
                    {!revealed ? (
                        <div className="glass-panel p-6 text-center">
                            <Lock size={20} className="mx-auto text-gray-500" />
                            <p className="mt-2 text-sm text-gray-300">
                                {(!round || round.locked === false) && lock.nextLock
                                    ? <>Lineups are revealed at Round {lock.nextRound}'s first tip-off, in {countdown(lock.nextLock - now)}.</>
                                    : <>This team had no lineup when the round locked.</>}
                            </p>
                            {team.mine && <p className="mt-1 text-xs text-gray-500">Yours is in My teams until then.</p>}
                        </div>
                    ) : view === 'court' ? (
                        <TeamCourt
                            group={team}
                            photos={photos}
                            crests={crests}
                            now={now}
                            lastEvent={lastEvent}
                            onOpenPlayer={onOpenPlayer}
                        />
                    ) : (
                        <>
                            {[['Starters', team.rows.filter(r => !r.benched), null],
                                ['6th man', team.rows.filter(r => r.sixth), 'counts in full'],
                                ['Bench', team.rows.filter(r => r.benched && !r.sixth), 'count half']]
                                .filter(([, rows], i) => i === 0 || rows.length)
                                .map(([title, rows, note]) => (
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
                                                    onOpen={() => onOpenPlayer(row.player.PlayerName)}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            {team.coachRow && (
                                <div className="space-y-2">
                                    <div className="px-1 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Coach</div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2">
                                        <CoachCard row={team.coachRow} history={history[team.coachRow.key]} lastEvent={lastEvent.get(team.coachRow.key)} now={now} />
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {!groups.length && (
                <div className="glass-panel p-6 text-center text-sm text-gray-400">
                    No teams here yet. {isMember || isAdmin ? 'Bring one of yours above, then send the invite link.' : 'Be the first to bring one.'}
                </div>
            )}
        </section>
    );
}
