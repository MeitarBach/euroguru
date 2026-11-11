import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Shirt, Plus, Pencil, Trash2, Tv, Lock, LogIn, Save, X, Check, Info, ChevronDown } from 'lucide-react';
import { fetchStats, fetchCoaches, fetchExpected, fetchHeadshots, fetchRoundScores, fetchCrHistory } from '../services/api';
import { CURRENT_SEASON } from '../seasons';
import useTeams from '../hooks/useTeams';
import useRoundLock from '../hooks/useRoundLock';
import useNow from '../hooks/useNow';
import { useAuth } from '../hooks/authContext';
import { useOpenPlayer } from '../hooks/playerDetailContext';
import usePrefsSynced from '../hooks/usePrefsSynced';
import { loadRecWeights, REC_DEFAULT_WEIGHTS } from '../recommendationColumns';
import { loadStored, storeValue } from '../columns';
import { lineupOps, cleanLineup, EMPTY_LINEUP, TEAM_LIMIT, STARTERS, BENCH } from '../lib/teams';
import { teamOutlook, teamRound, pricesByRound, crChange, coachExpected, pct, COACH_OUTCOMES, coachScore } from '../lib/optimizer/score';
import { countdown, marginText } from '../lib/live/format';
import { loadSchedule } from '../lib/live/schedule';
import { euroleagueCode } from '../lib/live/teams';
import LineupEditor from './teams/LineupEditor';
import TeamCourt from './live/TeamCourt';
import ViewSwitch from './live/ViewSwitch';
import PlayerPool from './teams/PlayerPool';
import PickerModal from './teams/PickerModal';

// The same request the Live tab and the stats table make for every priced player.
const ROSTER_QUERY = { season: CURRENT_SEASON, position: 'All', min_cr: 0, max_cr: 100, last_x_games: 100 };
const BUDGET_KEY = 'euroguru.optimizerBudget';
const SEASON_CODE = `E${CURRENT_SEASON}`;
// Court (the half court with photos, as in the Live tab) or List, remembered per device.
const VIEW_KEY = 'euroguru.teamsView';
const VIEWS = [['court', 'Court'], ['list', 'List']];
const loadView = () => {
    try {
        return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'court';
    } catch {
        return 'court';
    }
};

/**
 * teamOutlook's rows in the shape TeamCourt draws (its `expected` mode): each player's
 * counted expected FPT where the Live tab has his live points. With `past`, the rows
 * are teamRound's replay of a played round: what each scored, and the coach's result.
 * `started` holds the players whose game this round has tipped off (while it's on).
 */
function courtGroup(outlook, lineup, past = false, started = NO_KEYS) {
    const rows = outlook.rows.filter(r => r.player).map(r => ({
        ...r,
        started: started.has(r.key),
        captain: r.role === 'captain',
        benched: r.role === 'bench' || r.role === 'sixth',
        sixth: r.role === 'sixth',
        score: r.fpt ?? 0,
        countedAvg: r.counted,
        state: past ? (r.fpt === null ? 'dnp' : 'final') : 'expected',
    }));
    const c = outlook.coach;
    const o = c?.outlook;
    const coachRow = c && c.coach ? {
        key: c.key,
        code: c.coach.TeamCode,
        player: { PlayerName: c.coach.CoachName },
        counted: past ? c.points : coachExpected(o),
        cr: c.cr,
        state: past ? 'final' : 'expected',
        note: past
            ? (c.game ? marginText(c.game.margin, true) : 'no game')
            : o?.opp ? `${o.home ? 'vs' : '@'} ${o.opp} · ${pct(o.chance)}` : 'no game',
    } : null;
    // The bench in the lineup's own order: its first is the sixth man.
    const shown = new Set(rows.map(r => r.key));
    return { rows, bench: (lineup.bench ?? []).filter(k => shown.has(k)), coachRow };
}
const DRAFT = 'draft';
const NO_KEYS = new Set();
const one = (x) => x.toFixed(1);

// How a player's expected FPT is worked out (backend/utils/expected.py), remembered and
// synced with the account. "Your formula" is your Recommendations settings.
const METHOD_KEY = 'euroguru.teamsExpectedMethod';
const loadRecSettings = () => ({ ...REC_DEFAULT_WEIGHTS, ...loadRecWeights() });
const COACH_NOTE = `Coaches count the score they most likely make (${COACH_OUTCOMES.map(coachScore).join(', ')}) `
    + "from their club's expected margin next game.";

/** The three ways, each in a line. `rec` is your Recommendations settings. */
const METHODS = [
    { id: 'form', label: 'Your formula', line: () => 'Same formula as your Recommendations page settings.' },
    { id: 'average', label: 'Season average', line: () => 'His average per game this season. Nothing else.' },
    { id: 'model', label: 'EuroGuru model', line: () => 'Average, adjusted for price and how often he plays. Best in backtests, but runs high.' },
];
const methodOf = (id) => METHODS.find(m => m.id === id) ?? METHODS[0];
const loadMethod = () => methodOf(loadStored(METHOD_KEY, 'form')).id;

/** What the selected method means, for its tooltip. */
function methodNote(method, rec) {
    const m = methodOf(method);
    return `Expected by ${m.label}: ${m.line(rec)} ${COACH_NOTE}`;
}

/** Which way expected FPT is worked out: the chosen one, opening into all three. */
function MethodSwitch({ method, onChange, rec, onSettings }) {
    const [open, setOpen] = useState(false);
    return (
        <div>
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                className="inline-flex items-center gap-1.5 text-sm"
            >
                <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Expected by</span>
                <span className="text-white font-medium">{methodOf(method).label}</span>
                <ChevronDown size={14} className={`text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div role="radiogroup" aria-label="Expected by" className="mt-2 space-y-0.5">
                    {METHODS.map(m => {
                        const on = m.id === method;
                        return (
                            <div key={m.id} className={`flex items-baseline gap-2 px-2 py-1.5 rounded-md ${on ? 'bg-purple-500/10' : 'hover:bg-white/[0.04]'}`}>
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={on}
                                    onClick={() => { onChange(m.id); setOpen(false); }}
                                    className="flex-1 min-w-0 flex items-baseline gap-2 text-left text-sm"
                                >
                                    <Check size={13} className={`shrink-0 self-center ${on ? 'text-purple-300' : 'invisible'}`} />
                                    <span className={`shrink-0 ${on ? 'text-white font-medium' : 'text-gray-300'}`}>{m.label}</span>
                                    <span className="text-xs text-gray-500">{m.line(rec)}</span>
                                </button>
                                {m.id === 'form' && (
                                    <button type="button" onClick={onSettings} className="shrink-0 text-xs text-purple-300 hover:text-purple-200">
                                        Edit
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

const loadBudget = () => {
    try {
        const v = window.localStorage.getItem(BUDGET_KEY);
        return v === null ? '' : v;
    } catch {
        return '';
    }
};

const clock = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

function Stat({ label, children, tone = '' }) {
    return (
        <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">{label}</div>
            <div className={`mt-0.5 text-xl sm:text-2xl font-bold tabular-nums whitespace-nowrap ${tone}`}>{children}</div>
        </div>
    );
}

/** What the team scores and costs, against the budget you entered. */
function Summary({ outlook, budget, onBudget, round, children }) {
    const cap = budget === '' ? null : Number(budget);
    const over = cap !== null && outlook.cost > cap;
    const pct = cap ? Math.min(100, (outlook.cost / cap) * 100) : 0;
    const players = outlook.rows.length;
    return (
        <div className="glass-panel p-4 space-y-3">
            {children}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Stat label={round ? `Expected · Round ${round}` : 'Expected'} tone="text-white">
                    {one(outlook.expected)} <span className="text-sm font-medium text-gray-500">FPT</span>
                </Stat>
                <Stat label="Budget used" tone={over ? 'text-red-300' : 'text-white'}>
                    {one(outlook.cost)}{cap !== null && <span className="text-sm font-medium text-gray-500"> / {one(cap)}</span>} <span className="text-sm font-medium text-gray-500">CR</span>
                </Stat>
                <label className="col-span-2 sm:col-span-1 min-w-0">
                    <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Your budget (CR)</span>
                    <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.1"
                        value={budget}
                        onChange={(e) => onBudget(e.target.value)}
                        placeholder="e.g. 105"
                        className="input-dark mt-1 w-full py-1.5 text-sm"
                    />
                </label>
            </div>
            {cap !== null && cap > 0 && (
                <div className="space-y-1">
                    <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                        <div className={`h-full rounded-full ${over ? 'bg-red-400' : 'bg-gradient-to-r from-purple-600 to-purple-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className={`text-xs ${over ? 'text-red-300' : 'text-gray-400'}`}>
                        {over ? `${one(outlook.cost - cap)} CR over budget` : `${one(cap - outlook.cost)} CR left`}
                        {' · '}{players}/{STARTERS + BENCH} players{outlook.coach ? ' + coach' : ', no coach yet'}
                    </div>
                </div>
            )}
            {outlook.missing > 0 && (
                <p className="text-xs text-amber-300">{outlook.missing} player{outlook.missing === 1 ? ' is' : 's are'} no longer priced and count 0.</p>
            )}
        </div>
    );
}

function NameInput({ initial = '', placeholder, submitLabel, onSubmit, onCancel }) {
    const [value, setValue] = useState(initial);
    return (
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}>
            <input
                autoFocus
                value={value}
                maxLength={24}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') onCancel?.(); }}
                placeholder={placeholder}
                className="input-dark w-44 py-1.5 text-sm"
            />
            <button type="submit" className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-purple-600 hover:bg-purple-500">{submitLabel}</button>
            {onCancel && (
                <button type="button" onClick={onCancel} aria-label="Cancel" className="p-1.5 rounded-lg text-gray-500 hover:text-white"><X size={14} /></button>
            )}
        </form>
    );
}

/**
 * My Teams: build your fantasy teams with what each player and coach is expected
 * to score next round (backend/utils/expected.py) and what the roster costs against
 * your budget. Saved teams are the ones you watch live and bring into Watch Rooms.
 *
 * A draft works for anyone, signed in or not; saving it makes it one of your (up to 5)
 * teams. While a round is on a saved team keeps its players and coach: it can sub and
 * move the armband, but a player whose game has started only moves down the lineup.
 */
export default function TeamsView({ onNavigate }) {
    const { user, openAuth } = useAuth();
    const openPlayer = useOpenPlayer();
    const now = useNow(30_000);
    const lock = useRoundLock(CURRENT_SEASON, now);
    const [toast, setToast] = useState(null);
    const flash = useCallback((message) => {
        if (!message) return;
        setToast(message);
        setTimeout(() => setToast(t => (t === message ? null : t)), 3500);
    }, []);

    const [roster, setRoster] = useState(null);
    const [coaches, setCoaches] = useState([]);
    const [expected, setExpected] = useState({ round: null, players: {}, coaches: {} });
    const [headshots, setHeadshots] = useState({ players: {}, names: {}, crests: {} });
    // The Round dropdown: 'next' (what the team is expected to score) or a played round,
    // replayed with the roster as it is now.
    const [roundScores, setRoundScores] = useState({ rounds: [], players: {}, clubs: {} });
    const [crHistory, setCrHistory] = useState(null);
    const [shownRound, setShownRound] = useState('next');
    const [view, setView] = useState(loadView);
    const changeView = (next) => {
        setView(next);
        try {
            window.localStorage.setItem(VIEW_KEY, next);
        } catch { /* lasts this visit */ }
    };
    useEffect(() => {
        let alive = true;
        fetchStats(ROSTER_QUERY).then(rows => { if (alive) setRoster(rows ?? []); });
        fetchCoaches(CURRENT_SEASON).then(rows => { if (alive) setCoaches(Array.isArray(rows) ? rows : []); });
        fetchHeadshots(CURRENT_SEASON).then(map => { if (alive && map?.players) setHeadshots(map); });
        fetchRoundScores(CURRENT_SEASON).then(d => { if (alive && d?.rounds) setRoundScores(d); });
        fetchCrHistory(CURRENT_SEASON).then(d => { if (alive && d) setCrHistory(d); });
        return () => { alive = false; };
    }, []);
    // How expected FPT is worked out, and the Recommendations settings "Your formula"
    // reads - both re-read when an account's settings land on this device.
    const [method, setMethod] = useState(loadMethod);
    const [rec, setRec] = useState(loadRecSettings);
    usePrefsSynced(() => { setMethod(loadMethod()); setRec(loadRecSettings()); });
    const changeMethod = (next) => { setMethod(next); storeValue(METHOD_KEY, next); };
    useEffect(() => {
        let alive = true;
        fetchExpected(CURRENT_SEASON, {
            method, alpha: rec.alpha, last_x_games: rec.last_x_games, weight_matchup: rec.weight_matchup,
        }).then(e => { if (alive && e) setExpected(e); });
        return () => { alive = false; };
    }, [method, rec.alpha, rec.last_x_games, rec.weight_matchup]);
    const rosterByKey = useMemo(() => new Map((roster ?? []).map(p => [p.PlayerKey, p])), [roster]);
    const coachByKey = useMemo(() => new Map(coaches.map(c => [`coach:${c.CoachID}`, c])), [coaches]);

    // While a round is on: each club's first tip-off in it, so a player whose game has
    // started can be held to moving down the lineup (the database checks the same).
    const [tipoffs, setTipoffs] = useState(null);
    useEffect(() => {
        if (!lock.locked || lock.round === null) return undefined;
        let alive = true;
        loadSchedule(SEASON_CODE)
            .then(games => {
                if (!alive) return;
                const first = new Map();
                for (const g of games ?? []) {
                    if (g.round !== lock.round) continue;
                    for (const club of [g.homeCode, g.awayCode]) {
                        if (club && !(first.get(club) <= g.tipoff)) first.set(club, g.tipoff);
                    }
                }
                setTipoffs({ round: lock.round, first });
            })
            .catch(() => { /* the database still holds the rule */ });
        return () => { alive = false; };
    }, [lock.locked, lock.round]);
    const inRound = useMemo(() => {
        const first = lock.locked && tipoffs?.round === lock.round ? tipoffs.first : null;
        return {
            started: (key) => {
                const at = first?.get(euroleagueCode(rosterByKey.get(key)));
                return at !== undefined && at <= Date.now();
            },
            nameOf: (key) => rosterByKey.get(key)?.PlayerName ?? 'That player',
        };
    }, [lock.locked, lock.round, tipoffs, rosterByKey]);
    const teams = useTeams({ lock, notify: flash, inRound });

    const [budget, setBudget] = useState(loadBudget);
    const changeBudget = (v) => {
        setBudget(v);
        try {
            window.localStorage.setItem(BUDGET_KEY, v);
        } catch { /* lasts this visit */ }
    };

    // Which lineup is open: one of your teams by id, or the draft.
    const [openId, setOpenId] = useState(null);
    const [draft, setDraft] = useState(EMPTY_LINEUP);
    const [kind, setKind] = useState('players');
    const [editing, setEditing] = useState(null); // 'new' | 'rename' | 'save' | 'delete'
    const team = openId === DRAFT ? null : teams.groups.find(g => g.id === openId) ?? teams.selected;
    const isDraft = !team;
    const lineup = useMemo(() => (team ? cleanLineup(team) : draft), [team, draft]);
    // Free to change, or - a saved team while a round is on - subs and the armband only.
    const editable = isDraft || !lock.locked;
    const subsOnly = !editable;
    const started = useMemo(
        () => (subsOnly ? new Set(lineup.keys.filter(k => inRound.started(k))) : NO_KEYS),
        // `now` re-checks the clock every 30 seconds.
        [subsOnly, lineup.keys, inRound, now], // eslint-disable-line react-hooks/exhaustive-deps
    );

    const ops = useMemo(() => lineupOps(flash), [flash]);
    // An empty spot opens the player list over the page, for that spot: 'starter',
    // 'bench' or 'coach'.
    const [picker, setPicker] = useState(null);
    const closePicker = useCallback(() => setPicker(null), []);
    const draftRef = useRef(draft);
    useEffect(() => { draftRef.current = draft; }, [draft]);
    const apply = useCallback((op, key, arg) => {
        if (team) return teams[op](team.id, key, arg);
        const next = ops[op](draftRef.current, key, arg);
        if (next) setDraft(cleanLineup(next));
        return Boolean(next);
    }, [team, teams, ops]);

    const outlook = useMemo(
        () => teamOutlook(lineup, { rosterByKey, coachByKey, expected }),
        [lineup, rosterByKey, coachByKey, expected],
    );
    const remaining = budget === '' ? null : Number(budget) - outlook.cost;
    const prices = useMemo(() => pricesByRound(crHistory), [crHistory]);
    const pastRound = shownRound === 'next' ? null : Number(shownRound);
    const replay = useMemo(
        () => (pastRound === null ? null
            : teamRound(lineup, { rosterByKey, coachByKey, scores: roundScores, prices, round: pastRound })),
        [pastRound, lineup, rosterByKey, coachByKey, roundScores, prices],
    );
    const court = useMemo(
        () => (replay ? courtGroup(replay, lineup, true) : courtGroup(outlook, lineup, false, started)),
        [replay, outlook, lineup, started],
    );
    const gain = replay ? crChange(replay.gain) : null;

    const openTeam = (id) => { setOpenId(id); setEditing(null); if (id !== DRAFT) teams.select(id); };
    const saveDraft = async (name) => {
        const id = await teams.create(name, draft.keys, { bench: draft.bench, captain: draft.captain, coach: draft.coach });
        if (id) { setDraft(EMPTY_LINEUP); setOpenId(id); setEditing(null); flash('Saved to your teams'); }
    };

    const loading = roster === null;

    return (
        <div className="space-y-5">
            <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-2xl font-bold flex items-center gap-2.5">
                        <Shirt size={22} className="text-purple-300" /> My Teams
                    </h2>
                    <p className="text-gray-400 text-sm mt-1 flex items-center gap-1.5">
                        Build a roster and see what it's expected to score{expected.round ? ` in Round ${expected.round}` : ''} and what it costs.
                        <span title={methodNote(method, rec)} className="text-gray-600 hover:text-gray-300 cursor-help">
                            <Info size={14} />
                        </span>
                    </p>
                </div>
                {team && (
                    <button
                        type="button"
                        onClick={() => onNavigate?.('live', { bring: team.id })}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400"
                    >
                        <Tv size={16} /> Bring to a Watch Room
                    </button>
                )}
            </header>

            {/* Which lineup */}
            <div className="flex flex-wrap items-center gap-2">
                {teams.groups.map(g => (
                    <button
                        key={g.id}
                        type="button"
                        onClick={() => openTeam(g.id)}
                        aria-pressed={team?.id === g.id}
                        className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${team?.id === g.id
                            ? 'border-purple-500/40 bg-purple-500/15 text-white font-medium'
                            : 'border-white/10 text-gray-400 hover:text-white'}`}
                    >
                        {g.name}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={() => openTeam(DRAFT)}
                    aria-pressed={isDraft}
                    className={`px-3 py-1.5 rounded-full text-xs border border-dashed transition-colors ${isDraft
                        ? 'border-purple-500/50 bg-purple-500/10 text-white font-medium'
                        : 'border-white/15 text-gray-400 hover:text-white'}`}
                >
                    Draft{draft.keys.length ? ` · ${draft.keys.length}` : ''}
                </button>
                {teams.signedIn && !teams.full && (editing === 'new' ? (
                    <NameInput
                        placeholder="Team name"
                        submitLabel="Create"
                        onSubmit={async (name) => { const id = await teams.create(name); if (id) { setOpenId(id); setEditing(null); } }}
                        onCancel={() => setEditing(null)}
                    />
                ) : (
                    <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-purple-300 hover:text-purple-200">
                        <Plus size={13} /> New team
                    </button>
                ))}
            </div>

            {/* What this lineup is, and what can be done with it */}
            <div className="flex flex-wrap items-center justify-between gap-2 min-h-9">
                {isDraft ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-400">
                        <span>A draft - try players freely; nothing is saved until you save it.</span>
                        {!user ? (
                            <button type="button" onClick={() => openAuth('Save your fantasy teams')} className="inline-flex items-center gap-1.5 text-purple-300 hover:text-purple-200">
                                <LogIn size={14} /> Sign in to save it
                            </button>
                        ) : teams.full ? (
                            <span className="text-gray-500">You have {TEAM_LIMIT} teams already.</span>
                        ) : editing === 'save' ? (
                            <NameInput placeholder="Team name" submitLabel="Save" onSubmit={saveDraft} onCancel={() => setEditing(null)} />
                        ) : (
                            <button type="button" onClick={() => setEditing('save')} disabled={!draft.keys.length && !draft.coach} className="inline-flex items-center gap-1.5 text-purple-300 hover:text-purple-200 disabled:opacity-40">
                                <Save size={14} /> Save as a team
                            </button>
                        )}
                    </div>
                ) : editing === 'rename' ? (
                    <NameInput initial={team.name} submitLabel="Save" onSubmit={(name) => { teams.rename(team.id, name); setEditing(null); }} onCancel={() => setEditing(null)} />
                ) : (
                    <div className="flex items-center gap-2 min-w-0">
                        <h3 className="text-base font-semibold text-white truncate">{team.name}</h3>
                        <button type="button" onClick={() => setEditing('rename')} aria-label="Rename team" className="p-1 rounded-md text-gray-600 hover:text-white"><Pencil size={13} /></button>
                        {editing === 'delete' ? (
                            <span className="flex items-center gap-1.5 text-xs">
                                <span className="text-gray-400">Delete {team.name}? It leaves every Watch Room it's in.</span>
                                <button type="button" onClick={() => { teams.destroy(team.id); setOpenId(null); setEditing(null); }} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/15 text-red-300"><Check size={12} /> Delete</button>
                                <button type="button" onClick={() => setEditing(null)} className="px-2 py-1 rounded-md text-gray-400 hover:text-white">Keep</button>
                            </span>
                        ) : (
                            <button type="button" onClick={() => setEditing('delete')} aria-label="Delete team" className="p-1 rounded-md text-gray-600 hover:text-red-300"><Trash2 size={13} /></button>
                        )}
                    </div>
                )}
                {subsOnly && (
                    <span className="inline-flex items-start gap-1.5 text-xs text-amber-200 max-w-xl">
                        <Lock size={13} className="mt-px shrink-0" />
                        <span>
                            Round {lock.round} is on: no transfers until {clock(lock.until)} ({countdown(lock.until - now)}).
                            You can still sub and move the armband - a player whose game has started can only move down.
                        </span>
                    </span>
                )}
            </div>

            {loading ? (
                <div className="w-full h-[300px] flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            ) : (
                <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 items-start">
                    <section className="xl:col-span-3 space-y-4">
                        <Summary outlook={outlook} budget={budget} onBudget={changeBudget} round={expected.round}>
                            <MethodSwitch method={method} onChange={changeMethod} rec={rec} onSettings={() => onNavigate?.('recs', { advanced: true })} />
                        </Summary>
                        {/* The round shown: next round's expected numbers, or a played one
                            replayed with this roster. On a phone the result drops below. */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            <select
                                value={shownRound}
                                onChange={(e) => setShownRound(e.target.value)}
                                aria-label="Round"
                                className="input-dark py-1 text-xs"
                            >
                                <option value="next">{expected.round ? `Round ${expected.round} · expected` : 'Next round · expected'}</option>
                                {[...roundScores.rounds].reverse().map(r => <option key={r} value={r}>Round {r}</option>)}
                            </select>
                            {replay && (
                                <span className="order-last w-full sm:order-none sm:w-auto text-sm text-gray-400 whitespace-nowrap">
                                    <b className="font-mono text-white">{one(replay.scored)}</b> FPT
                                    <span className="mx-1.5 text-gray-600">·</span>
                                    <span title="How the players' prices moved with this round, added up (coaches have no price history)">
                                        <b className={`font-mono ${gain.tone}`}>{gain.text}</b> CR value
                                    </span>
                                </span>
                            )}
                            <div className="ml-auto">
                                <ViewSwitch view={view} onChange={changeView} options={VIEWS} />
                            </div>
                        </div>
                        {view === 'court' ? (
                            <TeamCourt
                                group={court}
                                photos={headshots.players}
                                crests={headshots.crests}
                                now={now}
                                expected
                                past={Boolean(replay)}
                                editable={editable || subsOnly}
                                onToggleCaptain={(key) => apply('toggleCaptain', key)}
                                onToggleBench={(key) => apply('toggleBench', key)}
                                onRemove={editable ? (key) => apply('remove', key) : undefined}
                                onOpenPlayer={(name) => openPlayer(name, CURRENT_SEASON)}
                                onSwap={(a, b) => apply('swap', a, b)}
                                onAddPlayers={editable ? (role) => setPicker(role) : undefined}
                                onPickCoach={editable ? () => setPicker('coach') : undefined}
                            />
                        ) : (
                            <LineupEditor
                                outlook={replay ?? outlook}
                                past={replay ? pastRound : null}
                                editable={editable}
                                subsOnly={subsOnly}
                                started={started}
                                onAction={apply}
                                onPick={setPicker}
                                onRemoveCoach={() => lineup.coach && apply('toggleCoach', lineup.coach)}
                                onOpenPlayer={(name) => openPlayer(name, CURRENT_SEASON)}
                            />
                        )}
                    </section>
                    <aside className="xl:col-span-2">
                        <PlayerPool
                            kind={kind}
                            onKind={setKind}
                            roster={roster}
                            names={headshots.names}
                            coaches={coaches}
                            expected={expected}
                            lineup={lineup}
                            remaining={remaining}
                            editable={editable}
                            onTogglePlayer={(key) => apply('toggle', key)}
                            onPickCoach={(key) => apply('toggleCoach', key)}
                        />
                    </aside>
                </div>
            )}

            {picker && editable && (
                <PickerModal
                    role={picker}
                    lineup={lineup}
                    roster={roster}
                    names={headshots.names}
                    coaches={coaches}
                    expected={expected}
                    remaining={remaining}
                    editable={editable}
                    onClose={closePicker}
                    onPickPlayer={(key) => apply(lineup.keys.includes(key) ? 'remove' : 'addAs', key, picker)}
                    onPickCoach={(key) => apply('toggleCoach', key)}
                />
            )}

            {toast && (
                <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-[#1a1a20] border border-white/10 text-sm text-white shadow-2xl">
                    {toast}
                </div>
            )}
        </div>
    );
}
