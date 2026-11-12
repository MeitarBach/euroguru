import React from 'react';
import { Shirt, Tv, LogIn, RefreshCw, Lock, Unlock, Plus, Pencil, ChevronRight } from 'lucide-react';
import AnimatedNumber from '../AnimatedNumber';
import LiveDot from '../LiveDot';
import { countdown, decimalsFor } from '../../../lib/live/format';
import { TEAM_LIMIT, STARTERS, BENCH } from '../../../lib/teams';
import { Widget, Spinner, linkBtn, primaryBtn } from './ui';
import { ordinal } from './format';

const clock = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** When lineups freeze, or until when they are frozen - one line under the title. */
export function LockLine({ lock, now }) {
    if (!lock?.ready) return null;
    if (lock.locked) {
        return (
            <span className="inline-flex items-center gap-1 text-amber-200/90">
                <Lock size={11} /> Locked for Round {lock.round} · opens {clock(lock.until)} (in {countdown(lock.until - now)})
            </span>
        );
    }
    if (!lock.nextLock) return null;
    return (
        <span className="inline-flex items-center gap-1">
            <Unlock size={11} className="text-emerald-300" /> Lineups lock {clock(lock.nextLock)} (in {countdown(lock.nextLock - now)})
        </span>
    );
}

/** "3 live · 4 done · 3 to play" for a team's round so far. */
export function RoundStatus({ group }) {
    const { live, final, toPlay } = group.sums;
    if (!group.keys.length) return <span>No players yet</span>;
    const parts = [];
    if (live) parts.push(<span key="l" className="inline-flex items-center gap-1 text-red-300"><LiveDot /> {live} live</span>);
    if (final) parts.push(<span key="f">{final} done</span>);
    if (toPlay) parts.push(<span key="t">{toPlay} to play</span>);
    if (!parts.length) return <span>{group.keys.length} players</span>;
    return parts.reduce((all, p, i) => (i ? [...all, <span key={`s${i}`} className="text-gray-700">·</span>, p] : [p]), []);
}

/** A room a team is in, with its place there once lineups are revealed. */
export function RoomChip({ room, onOpen }) {
    return (
        <button
            type="button"
            onClick={onOpen}
            title={`Open ${room.name}`}
            className="inline-flex items-center gap-1.5 max-w-full px-2 py-1 rounded-full text-[11px] border border-white/10 bg-white/[0.04] text-gray-300 hover:text-white hover:border-purple-400/40"
        >
            <Tv size={11} className="text-purple-300 shrink-0" />
            <span className="truncate">{room.name}</span>
            {room.revealed && room.place && (
                <b className={`shrink-0 ${room.place === 1 ? 'text-amber-300' : 'text-gray-200'}`}>{ordinal(room.place)} of {room.size}</b>
            )}
        </button>
    );
}

/**
 * One team as a single short row: its name and round so far, the rooms it is in with its
 * place there, the live total - and a button to bring it into a room.
 */
function TeamCard({ group, rooms, round, onOpen, onBring, onOpenRoom }) {
    const notes = [];
    if (group.edited && round) {
        notes.push(
            <span key="edited" className="text-amber-200/80" title="Scored on the lineup it had at the lock; your changes count from the next round">
                Round {round} lineup
            </span>,
        );
    }
    for (const r of rooms) {
        notes.push(
            <button
                key={r.id}
                type="button"
                onClick={() => onOpenRoom(r.id)}
                title={`Open ${r.name}`}
                className="inline-flex items-center gap-1 min-w-0 max-w-full text-gray-400 hover:text-white"
            >
                <Tv size={11} className="text-purple-300 shrink-0" />
                <span className="truncate max-w-[11rem]">{r.name}</span>
                {r.revealed && r.place && (
                    <b className={`shrink-0 font-medium ${r.place === 1 ? 'text-amber-300' : 'text-gray-200'}`}>{ordinal(r.place)} of {r.size}</b>
                )}
            </button>,
        );
    }
    return (
        <div className="flex items-center gap-3 px-3 py-2 rounded-xl border border-white/10 bg-white/[0.02] hover:border-purple-400/30 transition-colors">
            <div className="min-w-0 flex-1">
                <button type="button" onClick={onOpen} className="flex items-center gap-1 max-w-full text-sm font-semibold text-white hover:text-purple-200 text-left">
                    <span className="truncate">{group.name}</span>
                    <ChevronRight size={14} className="text-gray-600 shrink-0" />
                </button>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-gray-500">
                    <RoundStatus group={group} />
                    {/* Each note keeps its dot, so a wrapped line never ends on one. */}
                    {notes.map(n => (
                        <span key={n.key} className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
                            <span className="text-gray-700">·</span>{n}
                        </span>
                    ))}
                </div>
            </div>
            <button type="button" onClick={onOpen} className="text-right shrink-0">
                <AnimatedNumber
                    value={group.sums.total}
                    decimals={decimalsFor(group.sums.total)}
                    className="block text-xl leading-none font-bold font-mono text-white"
                />
                <span className="block mt-0.5 text-[10px] text-gray-500">
                    {group.sums.toPlay > 0 && group.sums.projected !== group.sums.total ? `proj ${group.sums.projected.toFixed(1)}` : 'FPT'}
                </span>
            </button>
            <button
                type="button"
                onClick={onBring}
                title="Bring to a room"
                aria-label={`Bring ${group.name} to a room`}
                className="inline-flex items-center gap-0.5 p-1.5 rounded-lg text-purple-200 bg-purple-500/10 border border-purple-500/25 hover:bg-purple-500/20 shrink-0"
            >
                <Plus size={11} /><Tv size={14} />
            </button>
        </div>
    );
}

/** My teams before there is a team to show: signed out, loading, failed, or none yet. */
function Gate({ teams, onSignIn, onMyTeams }) {
    if (!teams.signedIn) {
        return (
            <div className="text-center py-3">
                <p className="text-sm text-gray-400 max-w-sm mx-auto">
                    Save up to {TEAM_LIMIT} fantasy teams - {STARTERS} starters, {BENCH} on the bench and a coach - follow them
                    live here, and bring them into Watch Rooms with friends.
                </p>
                <button type="button" onClick={onSignIn} className={`mt-3 ${primaryBtn}`}><LogIn size={15} /> Sign in free</button>
            </div>
        );
    }
    if (teams.status === 'loading' || teams.status === 'idle') return <Spinner className="h-[120px]" />;
    if (teams.status === 'error') {
        return (
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-300">Couldn't load your teams.</span>
                <button type="button" onClick={teams.reload} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-white/10 text-gray-200 hover:bg-white/5">
                    <RefreshCw size={14} /> Try again
                </button>
            </div>
        );
    }
    return (
        <div className="text-center py-3">
            <p className="text-sm text-gray-400 max-w-sm mx-auto">
                Build a team in My Teams - with each roster's expected score and what it costs. Saved teams play here live
                and can join Watch Rooms.
            </p>
            <button type="button" onClick={onMyTeams} className={`mt-3 ${primaryBtn}`}><Shirt size={15} /> Build your first team</button>
        </div>
    );
}

/**
 * The hub's My teams, kept short: a row per saved team with its live total, who is
 * playing, the Watch Rooms it is in with its place there, and a way to bring it into one.
 * `roomsOf(teamId)` lists those rooms ({id, name, place, size, revealed}).
 */
export default function MyTeamsWidget({
    teams, groups, roomsOf, lock, now, round, onOpen, onBring, onOpenRoom, onMyTeams, onSignIn,
}) {
    const ready = teams.signedIn && teams.status === 'ready' && groups.length > 0;
    return (
        <Widget
            icon={<Shirt size={17} className="text-purple-300" />}
            title="My teams"
            subtitle={teams.signedIn ? <span className="flex flex-wrap items-center gap-x-2">{round ? <span>Round {round}</span> : null}<LockLine lock={lock} now={now} /></span> : null}
            actions={ready && (
                <>
                    <button type="button" onClick={onMyTeams} className={linkBtn}><Pencil size={12} /> Edit lineups</button>
                    {!teams.full && <button type="button" onClick={onMyTeams} className={linkBtn}><Plus size={13} /> New team</button>}
                </>
            )}
        >
            {ready ? (
                <div className="space-y-2">
                    {groups.map(g => (
                        <TeamCard
                            key={g.id}
                            group={g}
                            rooms={roomsOf(g.id)}
                            round={round}
                            onOpen={() => onOpen(g.id)}
                            onBring={() => onBring(g.id)}
                            onOpenRoom={onOpenRoom}
                        />
                    ))}
                </div>
            ) : (
                <Gate teams={teams} onSignIn={onSignIn} onMyTeams={onMyTeams} />
            )}
        </Widget>
    );
}
