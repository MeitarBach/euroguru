import React, { useState } from 'react';
import { Tv, Plus, Check, Link2, LogIn, Compass, ChevronDown, ChevronUp } from 'lucide-react';
import SearchInput from '../../SearchInput';
import { parseRoomCode } from '../../../lib/rooms';
import { decimalsFor } from '../../../lib/live/format';
import { Widget, Spinner, RoomBadges, NameForm, VisibilitySwitch, softBtn, linkBtn, primaryBtn } from './ui';
import { visibilityNote, ordinal } from './format';

const fixed = (x) => x.toFixed(decimalsFor(x));
const DISCOVER_SHOWN = 4;
// softBtn's shape in the green of the bring dialog's "In".
const joinedBtn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20';

/** One of your rooms: who leads and where you stand. */
function MyRoomRow({ room, standing, onOpen }) {
    const revealed = standing?.revealed;
    const best = standing?.best;
    return (
        <button
            type="button"
            onClick={onOpen}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${room.official
                ? 'border-amber-400/25 bg-amber-400/[0.04] hover:bg-amber-400/[0.08]'
                : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-purple-400/30'}`}
        >
            <Tv size={16} className={room.official ? 'text-amber-200 shrink-0' : 'text-purple-300 shrink-0'} />
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-white truncate">{room.name}</span>
                    <RoomBadges room={room} />
                </span>
                <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-gray-500">
                    {revealed && standing.leader
                        ? <span className="truncate">Leader <b className="text-gray-300 font-medium">{standing.leader.teamName}</b> {fixed(standing.leader.sums.total)}</span>
                        : <span>{room.teams} {room.teams === 1 ? 'team' : 'teams'} · lineups show at tip-off</span>}
                </span>
            </span>
            <span className="text-right shrink-0">
                {revealed && best ? (
                    <>
                        <span className={`block text-lg leading-none font-bold ${best.place === 1 ? 'text-amber-300' : 'text-white'}`}>{ordinal(best.place)}</span>
                        <span className="block mt-0.5 text-[10px] text-gray-500">of {standing.size}</span>
                    </>
                ) : (
                    <span className="text-[11px] text-gray-500">{room.my_teams?.length ? `${room.my_teams.length} of yours` : 'no team yet'}</span>
                )}
            </span>
        </button>
    );
}

/**
 * A room in the directory. Rooms you have a team in stay listed: "Joined" opens the same
 * dialog as Join, with your teams marked In - to bring another or take one out.
 */
function PublicRoomRow({ room, onOpen, onJoin }) {
    const mine = room.my_teams?.length ?? 0;
    const full = room.teams >= room.cap;
    const tone = room.official
        ? 'border-amber-400/25 bg-amber-400/[0.04]'
        : mine ? 'border-emerald-400/25 bg-emerald-400/[0.03]' : 'border-white/10 bg-white/[0.02]';
    return (
        <div className={`flex items-center gap-3 px-3 py-2 rounded-xl border ${tone}`}>
            <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-white truncate">{room.name}</span>
                    <RoomBadges room={room} />
                </span>
                <span className="block text-[11px] text-gray-500 truncate">
                    Run by {room.admin} · {room.teams} of {room.cap} teams
                    {mine > 0 && <span className="text-emerald-300/80"> · {mine} yours</span>}
                </span>
            </button>
            {mine > 0 ? (
                <button type="button" onClick={onJoin} title="Your teams in this room" className={joinedBtn}>
                    <Check size={13} /> Joined
                </button>
            ) : (
                <button type="button" onClick={onJoin} disabled={full} className={softBtn}>
                    {full ? 'Full' : <><Plus size={13} /> Join</>}
                </button>
            )}
        </div>
    );
}

/**
 * The hub's Watch Rooms: your rooms with each one's leader and your place, making a room
 * or opening an invite link, and the public rooms to discover - all on the home page.
 * `standings` is by room id (lib/live/standings.js).
 */
export default function RoomsWidget({ rooms, standings, onOpen, onJoin, onCreated, onSignIn, notify }) {
    const [form, setForm] = useState(null); // 'create' | 'link'
    const [visibility, setVisibility] = useState('private');
    const [showAll, setShowAll] = useState(false);

    if (!rooms.signedIn) {
        return (
            <Widget icon={<Tv size={17} className="text-purple-300" />} title="Watch Rooms">
                <div className="text-center py-2">
                    <p className="text-sm text-gray-400 max-w-sm mx-auto">
                        Bring your fantasy teams into a room, see everyone's points move live, and chat about the games.
                        Join a public room or make a private one for your friends.
                    </p>
                    <button type="button" onClick={onSignIn} className={`mt-3 ${primaryBtn}`}><LogIn size={15} /> Sign in free</button>
                </div>
            </Widget>
        );
    }

    // Every public room, yours too: the directory is where you see how full each one is.
    const discover = rooms.publicRooms;
    const shown = showAll ? discover : discover.slice(0, DISCOVER_SHOWN);

    const create = async (name) => {
        const rid = await rooms.create(name, visibility);
        if (rid) { setForm(null); onCreated(rid); }
    };
    const openLink = (text) => {
        const code = parseRoomCode(text);
        if (!code) { notify("That doesn't look like a room invite link"); return; }
        setForm(null);
        rooms.previewCode(code);
    };

    return (
        <Widget
            icon={<Tv size={17} className="text-purple-300" />}
            title="Watch Rooms"
            subtitle="Watch your teams with friends, live, and chat about the games"
        >
            {rooms.status !== 'ready' ? <Spinner className="h-[100px]" /> : (
                <div className="space-y-2">
                    {rooms.rooms.map(r => (
                        <MyRoomRow
                            key={r.id}
                            room={r}
                            standing={standings[r.id]}
                            onOpen={() => onOpen(r.id)}
                        />
                    ))}
                    {!rooms.rooms.length && (
                        <p className="text-sm text-gray-400">
                            You're not in a room yet. Make one for your friends, open an invite link, or join a public room below.
                        </p>
                    )}
                </div>
            )}

            {form === 'create' ? (
                <div className="space-y-1.5">
                    <NameForm placeholder="Room name" submitLabel="Create" onSubmit={create} onCancel={() => setForm(null)}>
                        <VisibilitySwitch value={visibility} onChange={setVisibility} />
                    </NameForm>
                    <p className="text-[11px] text-gray-500">{visibilityNote(visibility)}</p>
                </div>
            ) : form === 'link' ? (
                <NameForm placeholder="Paste the invite link" max={300} submitLabel="Open" onSubmit={openLink} onCancel={() => setForm(null)} />
            ) : (
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setForm('create')} className={softBtn}><Plus size={13} /> New room</button>
                    <button type="button" onClick={() => setForm('link')} className={softBtn}><Link2 size={13} /> Have an invite link?</button>
                </div>
            )}

            <div className="pt-3 border-t border-white/[0.06] space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                        <Compass size={13} /> Discover public rooms
                    </h4>
                    <SearchInput
                        className="w-full sm:w-48"
                        value={rooms.search}
                        onChange={rooms.setSearch}
                        placeholder="Search rooms"
                        inputClassName="input-dark w-full py-1 text-xs"
                    />
                </div>
                {shown.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {shown.map(r => (
                            <PublicRoomRow key={r.id} room={r} onOpen={() => onOpen(r.id)} onJoin={() => onJoin(r)} />
                        ))}
                    </div>
                )}
                {rooms.directoryStatus === 'ready' && !discover.length && (
                    <p className="text-xs text-gray-500">
                        {rooms.search ? `No public room matches “${rooms.search}”.` : 'No public rooms yet - make one public and it shows here.'}
                    </p>
                )}
                {rooms.directoryStatus === 'error' && <p className="text-xs text-gray-500">Couldn't load the public rooms.</p>}
                {discover.length > DISCOVER_SHOWN && (
                    <button type="button" onClick={() => setShowAll(v => !v)} className={linkBtn}>
                        {showAll ? <><ChevronUp size={13} /> Fewer</> : <><ChevronDown size={13} /> All {discover.length} public rooms</>}
                    </button>
                )}
            </div>
        </Widget>
    );
}
