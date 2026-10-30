import React, { useState } from 'react';
import { Trophy, Link2, Pencil, Trash2, RefreshCw, Plus, LogIn, LogOut, Lock, X, Check, UserMinus } from 'lucide-react';
import WatchCard from './WatchCard';
import CoachCard from './CoachCard';
import TeamCourt from './TeamCourt';
import ViewSwitch from './ViewSwitch';
import { countdown, decimalsFor } from '../../lib/live/format';
import { leagueLink, LEAGUE_LIMIT } from '../../lib/leagues';

const fixed = (x) => x.toFixed(decimalsFor(x));
const btn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium';
const primary = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 disabled:opacity-50';

function NameForm({ initial = '', placeholder, max = 40, submitLabel, onSubmit, onCancel }) {
    const [value, setValue] = useState(initial);
    return (
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}>
            <input
                autoFocus
                value={value}
                maxLength={max}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel(); } }}
                placeholder={placeholder}
                className="input-dark flex-1 min-w-0 py-1.5 text-sm"
            />
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

/** Leagues before there is one to show: signed out, loading, or none yet. */
export function LeaguesGate({ leagues, onSignIn }) {
    if (!leagues.signedIn) {
        return (
            <div className="glass-panel p-6 sm:p-8 text-center">
                <div className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center bg-purple-500/15 border border-purple-500/30 text-purple-300">
                    <Trophy size={22} />
                </div>
                <h3 className="text-lg font-semibold text-white">Play your teams against your friends</h3>
                <p className="mt-1 text-sm text-gray-400 max-w-md mx-auto">
                    Sign in free to make a league, send the link, and watch every team's points live.
                </p>
                <button type="button" onClick={onSignIn} className={`mt-4 ${primary}`}>
                    <LogIn size={16} /> Sign in free
                </button>
            </div>
        );
    }
    if (leagues.status !== 'ready') {
        return (
            <div className="w-full h-[200px] flex items-center justify-center">
                <div className="w-7 h-7 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }
    return (
        <div className="glass-panel p-6 sm:p-8 text-center">
            <div className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center bg-purple-500/15 border border-purple-500/30 text-purple-300">
                <Trophy size={22} />
            </div>
            <h3 className="text-lg font-semibold text-white">Start a league</h3>
            <p className="mt-1 text-sm text-gray-400 max-w-md mx-auto">
                Up to {LEAGUE_LIMIT} teams. Send the invite link to your friends; everyone's lineup is revealed at each
                round's first tip-off, and the table moves live with every play.
            </p>
            <div className="mt-4 max-w-sm mx-auto">
                <NameForm placeholder="League name" submitLabel="Create" onSubmit={(name) => leagues.create(name)} />
            </div>
            <p className="mt-4 text-xs text-gray-500">Got an invite? Open the link you were sent and you can join from there.</p>
        </div>
    );
}

/**
 * An invite link, opened: which league it is, and which of your teams join it.
 * With no team yet, one can be made right here.
 */
export function JoinLeagueDialog({ invite, myTeams, onCreateTeam, onJoin, onClose }) {
    const joined = new Set(invite.my_teams ?? []);
    const open = myTeams.filter(t => !joined.has(t.id));
    const [chosen, setChosen] = useState(() => new Set(open.slice(0, 1).map(t => t.id)));
    const [busy, setBusy] = useState(false);
    const toggle = (id) => setChosen(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const full = invite.teams >= LEAGUE_LIMIT;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
            <div className="w-full max-w-md glass-panel p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">League invite</div>
                        <h3 className="text-lg font-semibold text-white">{invite.name}</h3>
                        <p className="text-sm text-gray-400">
                            Run by {invite.admin} · {invite.teams} of {LEAGUE_LIMIT} teams
                        </p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-gray-500 hover:text-white">
                        <X size={16} />
                    </button>
                </div>

                {full ? (
                    <p className="text-sm text-amber-200">This league is full.</p>
                ) : open.length ? (
                    <div className="space-y-1.5">
                        <div className="text-sm text-gray-300">Which of your teams join?</div>
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
                            {myTeams.length ? 'All your teams are already in.' : 'Make a team to join with - you can pick its players after.'}
                        </div>
                        {myTeams.length < 5 && <NameForm placeholder="Team name" max={24} submitLabel="Create team" onSubmit={onCreateTeam} />}
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

/** The open league: its name and link, your place in it, and the chosen team's lineup. */
export default function LeagueView({
    leagues, myTeams, groups, team, onSelectTeam, lock, now, history, lastEvent, onOpenPlayer, flash,
    view = 'court', onChangeView, photos, crests,
}) {
    const [editing, setEditing] = useState(null); // 'league' | 'nickname' | 'new'
    const [confirm, setConfirm] = useState(null); // 'delete' | 'reset' | team id to remove
    const board = leagues.board;
    const league = leagues.selected;
    if (!league) return null;

    const isAdmin = Boolean(board?.is_admin);
    const inLeague = new Set(groups.map(g => g.id));
    const mineIn = groups.filter(g => g.mine);
    const canAdd = myTeams.filter(t => !inLeague.has(t.id));
    const round = board?.round;
    const revealed = Boolean(team?.lineupSaved);

    const copyLink = async () => {
        if (!board?.invite_code) return;
        const link = leagueLink(board.invite_code);
        try {
            await navigator.clipboard.writeText(link);
            flash('Invite link copied');
        } catch {
            flash(link);
        }
    };

    return (
        <section className="xl:col-span-2 space-y-4">
            {/* Which league */}
            <div className="flex flex-wrap items-center gap-2">
                {leagues.leagues.map(l => (
                    <button
                        key={l.id}
                        type="button"
                        onClick={() => leagues.select(l.id)}
                        aria-pressed={l.id === league.id}
                        className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${l.id === league.id
                            ? 'border-purple-500/40 bg-purple-500/15 text-white font-medium'
                            : 'border-white/10 text-gray-400 hover:text-white'}`}
                    >
                        {l.name}
                    </button>
                ))}
                {editing === 'new' ? (
                    <div className="w-64">
                        <NameForm
                            placeholder="League name"
                            submitLabel="Create"
                            onSubmit={(name) => { leagues.create(name); setEditing(null); }}
                            onCancel={() => setEditing(null)}
                        />
                    </div>
                ) : (
                    <button type="button" onClick={() => setEditing('new')} className={`${btn} text-purple-300 hover:text-purple-200`}>
                        <Plus size={13} /> New league
                    </button>
                )}
            </div>

            {/* The league */}
            <div className="glass-panel p-4 space-y-3">
                {editing === 'league' ? (
                    <NameForm
                        initial={league.name}
                        submitLabel="Save"
                        onSubmit={(name) => { leagues.rename(league.id, name); setEditing(null); }}
                        onCancel={() => setEditing(null)}
                    />
                ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <Trophy size={16} className="text-purple-300 shrink-0" />
                            <h3 className="text-base font-semibold text-white truncate">{league.name}</h3>
                            <span className="text-xs text-gray-500 shrink-0">{groups.length} of {LEAGUE_LIMIT} teams</span>
                            {isAdmin && (
                                <button type="button" onClick={() => setEditing('league')} aria-label="Rename league" className="p-1 rounded-md text-gray-600 hover:text-white">
                                    <Pencil size={13} />
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button type="button" onClick={copyLink} className={`${btn} text-purple-200 bg-purple-500/15 border border-purple-500/30 hover:bg-purple-500/25`}>
                                <Link2 size={13} /> Copy invite link
                            </button>
                            {isAdmin && confirm === null && (
                                <>
                                    <button type="button" onClick={() => setConfirm('reset')} title="Make a new link; the old one stops working" className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-white/5">
                                        <RefreshCw size={14} />
                                    </button>
                                    <button type="button" onClick={() => setConfirm('delete')} title="Delete the league" className="p-1.5 rounded-md text-gray-600 hover:text-red-300 hover:bg-red-500/10">
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
                        <button type="button" onClick={() => { leagues.newInvite(league.id); setConfirm(null); }} className={`${btn} bg-purple-600 text-white`}>New link</button>
                        <button type="button" onClick={() => setConfirm(null)} className={`${btn} text-gray-400`}>Cancel</button>
                    </div>
                )}
                {confirm === 'delete' && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-gray-300">Delete {league.name} for everyone? Teams are kept.</span>
                        <button type="button" onClick={() => { leagues.destroy(league.id); setConfirm(null); }} className={`${btn} bg-red-500/15 text-red-300`}>
                            <Check size={12} /> Delete
                        </button>
                        <button type="button" onClick={() => setConfirm(null)} className={`${btn} text-gray-400`}>Keep</button>
                    </div>
                )}

                {/* You in it */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-gray-400">
                    {editing === 'nickname' ? (
                        <div className="w-60">
                            <NameForm
                                initial={leagues.nickname ?? ''}
                                max={24}
                                submitLabel="Save"
                                onSubmit={async (name) => { if (await leagues.changeNickname(name)) setEditing(null); }}
                                onCancel={() => setEditing(null)}
                            />
                        </div>
                    ) : (
                        <span>
                            You appear as <b className="text-gray-200">{leagues.nickname ?? '…'}</b>
                            <button type="button" onClick={() => setEditing('nickname')} className="ml-1.5 text-purple-300 hover:text-purple-200">edit</button>
                        </span>
                    )}
                    {mineIn.map(g => (
                        <span key={g.id} className="inline-flex items-center gap-1">
                            · {g.name}
                            <button
                                type="button"
                                onClick={() => leagues.removeTeam(league.id, g.id)}
                                title={`Take ${g.name} out of this league`}
                                className="p-0.5 rounded text-gray-600 hover:text-red-300"
                            >
                                <LogOut size={12} />
                            </button>
                        </span>
                    ))}
                    {canAdd.length > 0 && groups.length < LEAGUE_LIMIT && (
                        <select
                            value=""
                            onChange={(e) => e.target.value && leagues.addTeam(board?.invite_code, e.target.value)}
                            className="input-dark py-1 text-xs"
                        >
                            <option value="">+ Add a team…</option>
                            {canAdd.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
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
                                <button type="button" onClick={() => { leagues.removeTeam(league.id, team.id); setConfirm(null); onSelectTeam(null); }} className={`${btn} bg-red-500/15 text-red-300`}>Remove</button>
                                <button type="button" onClick={() => setConfirm(null)} className={`${btn} text-gray-400`}>Keep</button>
                            </span>
                        ) : (
                            <button type="button" onClick={() => setConfirm(team.id)} title="Remove this team from the league" className="p-1.5 rounded-md text-gray-600 hover:text-red-300 hover:bg-red-500/10">
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
                            {[['Starters', team.rows.filter(r => !r.benched), null], ['Bench', team.rows.filter(r => r.benched), 'count half']]
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
                    No teams yet. Add one of yours above, then send the invite link.
                </div>
            )}
        </section>
    );
}
