import React, { useEffect, useState } from 'react';
import { X, Check, Plus, Tv, Link2, Shirt, LogOut } from 'lucide-react';
import { TEAM_LIMIT } from '../../../lib/teams';
import { parseRoomCode } from '../../../lib/rooms';
import { RoomBadges, NameForm, VisibilitySwitch, softBtn, primaryBtn, ghostBtn } from './ui';
import { visibilityNote } from './format';

/** Whether each id is in, from the server's list plus what was changed in this dialog. */
function useMembership(initial) {
    const [changes, setChanges] = useState({});
    const isIn = (id) => (id in changes ? changes[id] : initial.has(id));
    const set = (id, value) => setChanges(c => ({ ...c, [id]: value }));
    return [isIn, set];
}

/** One row's button: bring it in, or - once in - a check and a way back out. */
function InOut({ isIn, busy, full, onIn, onOut, inLabel = 'Bring' }) {
    if (isIn) {
        return (
            <span className="flex items-center gap-1 shrink-0">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300"><Check size={13} /> In</span>
                <button type="button" disabled={busy} onClick={onOut} title="Take it out" className="p-1 rounded-md text-gray-600 hover:text-red-300 disabled:opacity-40">
                    <LogOut size={13} />
                </button>
            </span>
        );
    }
    return (
        <button type="button" disabled={busy || full} onClick={onIn} className={`${softBtn} shrink-0`}>
            {full ? 'Full' : <><Plus size={13} /> {inLabel}</>}
        </button>
    );
}

function Shell({ kicker, title, sub, onClose, children, footer }) {
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60" onClick={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                className="w-full sm:max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#121016] shadow-2xl p-5 space-y-4"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">{kicker}</div>
                        <h3 className="text-lg font-semibold text-white flex flex-wrap items-center gap-2">{title}</h3>
                        {sub && <p className="text-sm text-gray-400">{sub}</p>}
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-gray-500 hover:text-white shrink-0">
                        <X size={16} />
                    </button>
                </div>
                {children}
                {footer && <div className="flex justify-end gap-2 pt-1">{footer}</div>}
            </div>
        </div>
    );
}

/**
 * A room, and which of your teams play in it: from an invite link, a public room's Join,
 * or "+ Bring a team" on a room's page. Each team goes in (or out) with one tap.
 */
function RoomFixed({ room, myTeams, onJoin, onLeave, onCreateTeam, onOpenRoom, onMyTeams, onClose }) {
    const [isIn, setIn] = useMembership(new Set(room.my_teams ?? []));
    const [busy, setBusy] = useState(null);
    const inCount = myTeams.filter(t => isIn(t.id)).length;
    const full = room.teams + myTeams.filter(t => isIn(t.id) && !(room.my_teams ?? []).includes(t.id)).length >= room.cap;

    const toggle = async (team, bring) => {
        setBusy(team.id);
        const ok = bring ? await onJoin(team.id) : await onLeave(team.id);
        if (ok) setIn(team.id, bring);
        setBusy(null);
    };

    return (
        <Shell
            kicker={room.code ? 'Watch Room invite' : 'Bring your teams'}
            title={<>{room.name} <RoomBadges room={room} /></>}
            sub={`Run by ${room.admin} · ${room.teams} of ${room.cap} teams`}
            onClose={onClose}
            footer={(
                <>
                    <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white">
                        {inCount ? 'Done' : 'Not now'}
                    </button>
                    {inCount > 0 && onOpenRoom && (
                        <button type="button" onClick={() => onOpenRoom(room.id)} className={primaryBtn}>
                            <Tv size={15} /> Open the room
                        </button>
                    )}
                </>
            )}
        >
            {myTeams.length ? (
                <div className="space-y-1.5">
                    <div className="text-sm text-gray-300">Which of your teams play here?</div>
                    {myTeams.map(t => (
                        <div key={t.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10">
                            <Shirt size={14} className="text-purple-300 shrink-0" />
                            <span className="flex-1 min-w-0">
                                <span className="block text-sm text-white truncate">{t.name}</span>
                                <span className="block text-[11px] text-gray-500">{t.keys.length} players{t.coach ? ' + coach' : ''}</span>
                            </span>
                            <InOut
                                isIn={isIn(t.id)}
                                busy={busy === t.id}
                                full={full}
                                onIn={() => toggle(t, true)}
                                onOut={() => toggle(t, false)}
                            />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="text-sm text-gray-300">Make a team to bring - you pick its players in My Teams.</div>
                    <NameForm placeholder="Team name" max={24} submitLabel="Create team" onSubmit={onCreateTeam} />
                    {onMyTeams && <button type="button" onClick={onMyTeams} className={ghostBtn}><Shirt size={13} /> Open My Teams</button>}
                </div>
            )}
            {myTeams.length > 0 && myTeams.length < TEAM_LIMIT && (
                <p className="text-[11px] text-gray-500">Up to {TEAM_LIMIT} teams; new ones are made in My Teams.</p>
            )}
        </Shell>
    );
}

/**
 * One of your teams, and the rooms it plays in: from a team's "Bring to a room" (on the
 * hub, its page, or My Teams). Your rooms, the public ones, a new room, or an invite link.
 */
function TeamFixed({ team, myRooms, publicRooms, onJoinRoom, onLeaveRoom, onCreateRoom, onPasteCode, onOpenRoom, onClose }) {
    const [isIn, setIn] = useMembership(new Set(myRooms.filter(r => (r.my_teams ?? []).includes(team.id)).map(r => r.id)));
    const [busy, setBusy] = useState(null);
    const [form, setForm] = useState(null); // 'create' | 'link'
    const [visibility, setVisibility] = useState('private');
    const [badLink, setBadLink] = useState(false);
    const mine = new Set(myRooms.map(r => r.id));
    const others = publicRooms.filter(r => !mine.has(r.id)).slice(0, 5);

    const toggle = async (room, bring) => {
        setBusy(room.id);
        const ok = bring ? await onJoinRoom(room) : await onLeaveRoom(room.id);
        if (ok) setIn(room.id, bring);
        setBusy(null);
    };
    const create = async (name) => {
        const rid = await onCreateRoom(name, visibility);
        if (rid) { setIn(rid, true); setForm(null); onOpenRoom(rid); }
    };

    const row = (room) => (
        <div key={room.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10">
            <Tv size={14} className="text-purple-300 shrink-0" />
            <button type="button" onClick={() => onOpenRoom(room.id)} className="flex-1 min-w-0 text-left">
                <span className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-white truncate">{room.name}</span>
                    <RoomBadges room={room} />
                </span>
                <span className="block text-[11px] text-gray-500 truncate">
                    {room.is_admin ? 'Yours' : `Run by ${room.admin}`} · {room.teams} of {room.cap} teams
                </span>
            </button>
            <InOut
                isIn={isIn(room.id)}
                busy={busy === room.id}
                full={room.teams >= room.cap}
                onIn={() => toggle(room, true)}
                onOut={() => toggle(room, false)}
                inLabel={mine.has(room.id) ? 'Bring' : 'Join'}
            />
        </div>
    );

    return (
        <Shell kicker="Bring to a Watch Room" title={<><Shirt size={17} className="text-purple-300" /> {team.name}</>} onClose={onClose}
            footer={<button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white">Done</button>}
        >
            <div className="space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Your rooms</div>
                {myRooms.length ? myRooms.map(row) : <p className="text-sm text-gray-500">You're not in a room yet.</p>}
            </div>

            {form === 'create' ? (
                <div className="space-y-1.5">
                    <NameForm placeholder="New room's name" submitLabel="Create and bring" onSubmit={create} onCancel={() => setForm(null)}>
                        <VisibilitySwitch value={visibility} onChange={setVisibility} />
                    </NameForm>
                    <p className="text-[11px] text-gray-500">{visibilityNote(visibility)}</p>
                </div>
            ) : form === 'link' ? (
                <div className="space-y-1.5">
                    <NameForm
                        placeholder="Paste the invite link"
                        max={300}
                        submitLabel="Open"
                        onSubmit={(text) => {
                            const code = parseRoomCode(text);
                            setBadLink(!code);
                            if (code) onPasteCode(code);
                        }}
                        onCancel={() => { setForm(null); setBadLink(false); }}
                    />
                    {badLink && <p className="text-[11px] text-amber-300">That doesn't look like a room invite link.</p>}
                </div>
            ) : (
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setForm('create')} className={softBtn}><Plus size={13} /> New room for {team.name}</button>
                    <button type="button" onClick={() => setForm('link')} className={softBtn}><Link2 size={13} /> Invite link</button>
                </div>
            )}

            {others.length > 0 && (
                <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Public rooms</div>
                    {others.map(row)}
                </div>
            )}
        </Shell>
    );
}

/**
 * Bringing teams into Watch Rooms, from wherever you are: with `room`, which of your
 * teams play in it; with `team`, which rooms that team plays in.
 */
export default function BringDialog(props) {
    return props.room ? <RoomFixed {...props} /> : <TeamFixed {...props} />;
}
