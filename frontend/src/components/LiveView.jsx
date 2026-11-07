import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Radio, UserPlus, Volume2, VolumeX, FlaskConical, Plus, RefreshCw, Lock, Unlock, LogIn, Shirt } from 'lucide-react';
import { fetchStats, fetchCoaches, fetchHeadshots } from '../services/api';
import { CURRENT_SEASON } from '../seasons';
import useWatchGroups, { GROUP_COLORS } from '../hooks/useWatchGroups';
import useTeams from '../hooks/useTeams';
import useRoundLock from '../hooks/useRoundLock';
import useRooms from '../hooks/useRooms';
import RoomView, { RoomsDirectory, JoinRoomDialog } from './live/RoomView';
import RoomChat from './live/RoomChat';
import TeamCourt from './live/TeamCourt';
import ViewSwitch from './live/ViewSwitch';
import { useAuth } from '../hooks/authContext';
import { TEAM_LIMIT, STARTERS, BENCH } from '../lib/teams';
import { readRoomCode } from '../lib/rooms';
import useLiveRound from '../hooks/useLiveRound';
import useNow from '../hooks/useNow';
import { useOpenPlayer } from '../hooks/playerDetailContext';
import { euroleagueSource } from '../lib/live/source';
import { demoSource } from '../lib/live/demo';
import { watchRow, inGroup, sortRows, totals, coachRow, coachKey } from '../lib/live/rows';
import { countdown, ago, decimalsFor } from '../lib/live/format';
import { LayoutGroup } from 'framer-motion';
import { chime, enableChime } from '../lib/live/chime';
import { euroleagueCode } from '../lib/live/teams';
import GameStrip from './live/GameStrip';
import WatchCard from './live/WatchCard';
import { GroupBoard, GroupHeader } from './live/GroupBoard';
import ActivityFeed from './live/ActivityFeed';
import LivePicker from './live/LivePicker';
import GameSection from './live/GameSection';
import CoachCard from './live/CoachCard';
import CoachPicker from './live/CoachPicker';
import { boxscoreName } from '../lib/live/rows';
import { shareGroup, readInvite, clearInvite } from '../lib/live/share';
import LiveDot from './live/LiveDot';

const SEASON_CODE = `E${CURRENT_SEASON}`;
// Every priced player, with season averages: the same request the stats table makes
// for its widest view, so it is usually already cached.
const ROSTER_QUERY = { season: CURRENT_SEASON, position: 'All', min_cr: 0, max_cr: 100, last_x_games: 100 };
const SOUND_KEY = 'euroguru.liveSound';
// Which list the tab shows - Watch Rooms, your teams or your watchlists - remembered
// per device. Teams are built and edited in My Teams; here they are watched.
const MODE_KEY = 'euroguru.liveMode';
const MODES = [['rooms', 'Watch Rooms'], ['teams', 'My teams'], ['watchlists', 'Watchlists']];
// How a team is drawn: on a half court with photos, or as the detailed stat cards.
const VIEW_KEY = 'euroguru.liveTeamView';
const loadView = () => {
    try {
        return window.localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'court';
    } catch {
        return 'court';
    }
};
const BIG_PLAY = 3;
// Euroleague's edge holds an answer for up to a minute; much older than that while a
// game is on means their feed has stalled, which is worth saying out loud.
const STALE_FEED_MS = 150_000;

const fixedScore = (x) => x.toFixed(decimalsFor(x));

const loadMode = () => {
    // A room invite link opens on the rooms.
    if (readRoomCode()) return 'rooms';
    try {
        const saved = window.localStorage.getItem(MODE_KEY);
        if (saved === 'leagues') return 'rooms'; // leagues became Watch Rooms
        return MODES.some(([id]) => id === saved) ? saved : null;
    } catch {
        return null;
    }
};

const clock = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

const loadSound = () => {
    try {
        return window.localStorage.getItem(SOUND_KEY) === 'on';
    } catch {
        return false;
    }
};

function StatusPill({ games, now }) {
    const live = games.filter(g => g.status === 'live');
    if (live.length) {
        return (
            <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-red-500/15 border border-red-500/30 text-xs font-semibold text-red-200">
                <LiveDot /> LIVE · {live.length} {live.length === 1 ? 'game' : 'games'}
            </span>
        );
    }
    const next = games.filter(g => g.status === 'scheduled').sort((a, b) => a.tipoff - b.tipoff)[0];
    if (next) {
        return (
            <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-gray-300">
                {next.tipoff > now ? <>Next tip-off in {countdown(next.tipoff - now)}</> : 'Tipping off…'}
            </span>
        );
    }
    if (games.length) {
        return <span className="px-2.5 py-1 rounded-full bg-white/5 text-xs text-gray-400">Round complete</span>;
    }
    return null;
}

function Freshness({ connection, games, now }) {
    if (connection.state === 'limited') {
        return <span className="text-amber-300">Euroleague is rate-limiting us · retrying in a minute</span>;
    }
    if (connection.state === 'reconnecting') {
        return <span className="text-amber-300">Connection lost · reconnecting…</span>;
    }
    const stalled = games.some(g => g.status === 'live' && g.lastModified && now - g.lastModified > STALE_FEED_MS);
    return (
        <span>
            {connection.lastOk ? `Updated ${ago(now - connection.lastOk)}` : 'Connecting…'}
            {stalled && <span className="text-amber-300"> · Euroleague's feed is running behind</span>}
        </span>
    );
}

function ModeSwitch({ mode, onChange }) {
    return (
        <div role="tablist" className="inline-flex p-1 rounded-xl bg-white/[0.04] border border-white/10">
            {MODES.map(([id, label]) => (
                <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={mode === id}
                    onClick={() => onChange(id)}
                    className={`px-3.5 py-1.5 rounded-lg text-sm transition-colors ${mode === id
                        ? 'bg-purple-500/20 text-white font-medium'
                        : 'text-gray-400 hover:text-white'}`}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

/** When teams' lineups freeze, or until when they are frozen. */
function LockBanner({ lock, now }) {
    if (!lock.ready) return null;
    if (lock.locked) {
        return (
            <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-sm text-amber-200">
                <Lock size={15} className="shrink-0" />
                <span>
                    Lineups are locked for Round {lock.round}. They open again {clock(lock.until)}
                    <span className="text-amber-200/60"> (in {countdown(lock.until - now)})</span>.
                </span>
            </div>
        );
    }
    if (!lock.nextLock) return null;
    return (
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-sm text-gray-300">
            <Unlock size={15} className="shrink-0 text-emerald-300" />
            <span>
                Lineups lock for Round {lock.nextRound} at its first tip-off, {clock(lock.nextLock)}
                <span className="text-gray-500"> (in {countdown(lock.nextLock - now)})</span>.
            </span>
        </div>
    );
}

/** My teams before there is a team to show: signed out, loading, failed, or none yet. */
function TeamsGate({ teams, onSignIn, onMyTeams }) {
    if (!teams.signedIn) {
        return (
            <div className="glass-panel p-6 sm:p-8 text-center">
                <div className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center bg-purple-500/15 border border-purple-500/30 text-purple-300">
                    <Shirt size={22} />
                </div>
                <h3 className="text-lg font-semibold text-white">Your fantasy teams, saved and live</h3>
                <p className="mt-1 text-sm text-gray-400 max-w-md mx-auto">
                    Sign in free to save up to {TEAM_LIMIT} teams - {STARTERS} starters, {BENCH} on the bench and a coach -
                    follow them live, and watch them with friends in a Watch Room.
                </p>
                <button
                    type="button"
                    onClick={onSignIn}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400"
                >
                    <LogIn size={16} /> Sign in free
                </button>
            </div>
        );
    }
    if (teams.status === 'loading' || teams.status === 'idle') {
        return (
            <div className="w-full h-[200px] flex items-center justify-center">
                <div className="w-7 h-7 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }
    if (teams.status === 'error') {
        return (
            <div className="glass-panel p-5 flex items-center justify-between gap-4">
                <span className="text-sm text-gray-300">Couldn't load your teams.</span>
                <button
                    type="button"
                    onClick={teams.reload}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-white/10 text-gray-200 hover:bg-white/5"
                >
                    <RefreshCw size={14} /> Try again
                </button>
            </div>
        );
    }
    return (
        <div className="glass-panel p-6 sm:p-8 text-center">
            <div className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center bg-purple-500/15 border border-purple-500/30 text-purple-300">
                <Shirt size={22} />
            </div>
            <h3 className="text-lg font-semibold text-white">Build your first team</h3>
            <p className="mt-1 text-sm text-gray-400 max-w-md mx-auto">
                Teams are built in My Teams, with each roster's expected score and the budget it takes.
                Once saved, they play here live and can join Watch Rooms.
            </p>
            <button
                type="button"
                onClick={onMyTeams}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400"
            >
                <Shirt size={16} /> Open My Teams
            </button>
        </div>
    );
}

function EmptyState({ group, suggestions, onAdd, onPick, isTeam }) {
    return (
        <div className="glass-panel p-6 sm:p-8 text-center">
            <div className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center bg-purple-500/15 border border-purple-500/30 text-purple-300">
                <Radio size={22} />
            </div>
            <h3 className="text-lg font-semibold text-white">Who's in {group.name}?</h3>
            <p className="mt-1 text-sm text-gray-400 max-w-md mx-auto">
                {isTeam
                    ? <>Pick {STARTERS} starters and {BENCH} for the bench, then a captain and a coach. Their fantasy
                        points update live while they play.</>
                    : <>Add the players on this roster. Their fantasy points update live while they play, and the
                        group's total moves with every basket, board and turnover.</>}
            </p>
            <button
                type="button"
                onClick={onPick}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400"
            >
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
 * The group's head coach: their card, or a way to pick one. A coach is worth their
 * club's margin, so they count from the first basket of their game.
 */
function CoachSlot({ group, coaches, games, history, lastEvent, now, picking, onTogglePicker, onClosePicker, onPick }) {
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
                        <button type="button" onClick={onTogglePicker} className="font-normal text-purple-300 hover:text-purple-200">
                            Change
                        </button>
                    )}
                    {coach && <span className="font-mono text-gray-400">{fixedScore(coach.counted ?? 0)}</span>}
                </span>
            </div>
            {coach ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2">
                    <CoachCard
                        row={coach}
                        history={history[coach.key]}
                        lastEvent={lastEvent.get(coach.key)}
                        now={now}
                        onRemove={() => onPick(coach.key)}
                    />
                </div>
            ) : (
                <button
                    type="button"
                    onClick={onTogglePicker}
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
                    onPick={(key) => { onPick(key); onClosePicker(); }}
                    onClose={onClosePicker}
                />
            )}
        </div>
    );
}

/**
 * Live fantasy points for the players you choose, while their games are on.
 *
 * The browser reads Euroleague's live feed directly (see lib/live/feed.js) and scores it
 * exactly as the fantasy game does. ?demo replays a finished round instead, for trying
 * the tab when nothing is on.
 */
export default function LiveView({ active = true, intent = null, onNavigate }) {
    const demo = useMemo(() => new URLSearchParams(window.location.search).has('demo'), []);
    const [source] = useState(() => (demo ? demoSource(SEASON_CODE) : euroleagueSource(SEASON_CODE)));
    const [roster, setRoster] = useState(null);
    const [coaches, setCoaches] = useState([]);
    const [headshots, setHeadshots] = useState({ players: {}, names: {}, crests: {} });
    const [teamView, setTeamView] = useState(loadView);
    const changeTeamView = (next) => {
        setTeamView(next);
        try {
            window.localStorage.setItem(VIEW_KEY, next);
        } catch { /* the choice just lasts this visit */ }
    };
    const [coachPicker, setCoachPicker] = useState(false);
    const [picker, setPicker] = useState({ open: false, game: null });
    // The game open in the game view, by code - its boxscore is polled while it is.
    const [openGame, setOpenGame] = useState(null);
    // A group someone shared with an invite link (?join=), offered until accepted or dismissed.
    const [invite, setInvite] = useState(() => readInvite());
    const [toast, setToast] = useState(null);
    const flash = useCallback((message) => {
        if (!message) return;
        setToast(message);
        setTimeout(() => setToast(t => (t === message ? null : t)), 3500);
    }, []);
    const [sound, setSound] = useState(loadSound);
    const now = useNow(1000);
    const { user, loading: authLoading, openAuth } = useAuth();
    const [savedMode, setSavedMode] = useState(loadMode);
    // Signed in, your teams come first; signed out, watchlists work without an account.
    const mode = savedMode ?? (user ? 'teams' : 'watchlists');
    const toMyTeams = () => onNavigate?.('teams');
    const changeMode = (next) => {
        setSavedMode(next);
        setOpenGame(null);
        try {
            window.localStorage.setItem(MODE_KEY, next);
        } catch { /* the choice just lasts this visit */ }
    };
    const lock = useRoundLock(CURRENT_SEASON, now);
    const lists = useWatchGroups();
    const teams = useTeams({ lock, notify: flash });
    const rooms = useRooms({ notify: flash });
    // The list on screen. Everything is followed live either way, so switching is
    // instant. Teams are read-only here (My Teams edits them), so the box
    // score's add menu always works on your watchlists.
    const watch = mode === 'watchlists' ? lists : teams;
    const isTeams = mode === 'teams';
    const isRooms = mode === 'rooms';
    const [roomTeamId, setRoomTeamId] = useState(null);
    // A public room you asked to join: its board, shown in the join dialog.
    const [joining, setJoining] = useState(null);

    // Teams change in My Teams while this tab stays mounted: catch up on return.
    const wasActive = useRef(active);
    useEffect(() => {
        if (active && !wasActive.current) { teams.reload(); rooms.reload(); rooms.refreshBoard(); }
        wasActive.current = active;
    }, [active]); // eslint-disable-line react-hooks/exhaustive-deps -- reloads are stable; only the switch matters

    // Another tab sent us here for something: "Bring to a Watch Room" from My Teams.
    // Adjusted while rendering, once per request, rather than in an effect.
    const [seenIntent, setSeenIntent] = useState(intent);
    if (intent !== seenIntent) {
        setSeenIntent(intent);
        if (intent?.mode) {
            setSavedMode(intent.mode);
            setOpenGame(null);
        }
    }

    // The open room's teams, shaped like groups: lineups as saved at the lock (null
    // before it - the database does not reveal them earlier).
    const roomRaw = useMemo(() => (rooms.board?.teams ?? []).map((t, i) => ({
        id: t.team_id,
        name: `${t.name} · ${t.nickname}`,
        teamName: t.name,
        nickname: t.nickname,
        mine: t.mine,
        color: i,
        lineupSaved: Boolean(t.lineup),
        keys: t.lineup?.keys ?? [],
        bench: t.lineup?.bench ?? [],
        captain: t.lineup?.captain ?? null,
        coach: t.lineup?.coach ?? null,
    })), [rooms.board]);

    // An invite link opened signed out: ask to sign in, once.
    const askedSignIn = useRef(false);
    useEffect(() => {
        if (rooms.inviteCode && !user && !authLoading && !askedSignIn.current) {
            askedSignIn.current = true;
            openAuth('Sign in to join this Watch Room');
        }
    }, [rooms.inviteCode, user, authLoading, openAuth]);
    const openPlayer = useOpenPlayer();

    useEffect(() => {
        let alive = true;
        fetchStats(ROSTER_QUERY).then(rows => { if (alive) setRoster(rows ?? []); });
        fetchCoaches(CURRENT_SEASON).then(rows => { if (alive) setCoaches(Array.isArray(rows) ? rows : []); });
        fetchHeadshots(CURRENT_SEASON).then(map => { if (alive && map?.players) setHeadshots(map); });
        return () => { alive = false; };
    }, []);
    const coachByKey = useMemo(() => new Map(coaches.map(c => [coachKey(c), c])), [coaches]);
    // Everyone in a team or a watchlist, and every coach either has, for the live loop.
    const followedKeys = useMemo(
        () => [...new Set([...teams.allKeys, ...lists.allKeys, ...roomRaw.flatMap(g => g.keys)])],
        [teams.allKeys, lists.allKeys, roomRaw],
    );
    const watchCoaches = useMemo(() => [...new Set([...teams.groups, ...lists.groups, ...roomRaw].map(g => g.coach).filter(Boolean))]
        .map(key => coachByKey.get(key))
        .filter(Boolean)
        .map(c => ({ key: coachKey(c), code: c.TeamCode, name: c.CoachName })), [teams.groups, lists.groups, roomRaw, coachByKey]);

    // A big play chimes - when the viewer has turned sound on.
    const soundOn = useRef(sound);
    useEffect(() => { soundOn.current = sound; });
    const onEvents = useCallback((events) => {
        if (soundOn.current && events.some(e => e.kind === 'player' && e.delta >= BIG_PLAY)) chime();
    }, []);

    // Audio may only start from a gesture, so a saved "on" waits for the first click.
    useEffect(() => {
        if (!sound) return undefined;
        const wake = () => enableChime();
        document.addEventListener('pointerdown', wake, { once: true });
        return () => document.removeEventListener('pointerdown', wake);
    }, [sound]);

    const toggleSound = () => {
        const next = !sound;
        if (next) {
            enableChime();
            chime(); // the sound that is being switched on
        }
        setSound(next);
        try {
            window.localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
        } catch { /* the choice just lasts this visit */ }
    };

    const live = useLiveRound({
        source,
        seasonCode: demo ? `${SEASON_CODE}-demo` : SEASON_CODE,
        roster,
        watchKeys: followedKeys,
        watchCoaches,
        onEvents,
        focusCode: openGame,
    });

    const rosterByKey = useMemo(() => new Map((roster ?? []).map(p => [p.PlayerKey, p])), [roster]);
    // One row per followed player, shared by every group they are in.
    const rowByKey = useMemo(() => new Map(
        followedKeys
            .map(k => rosterByKey.get(k))
            .filter(Boolean)
            .map(p => [p.PlayerKey, watchRow(p, live.games)]),
    ), [followedKeys, rosterByKey, live.games]);
    // Each group counts its own players by their role in it - captain double, bench
    // half - with the captain pinned to the top of the starters.
    const scoreGroups = useCallback((list) => list.map(g => {
        const bench = new Set(g.bench);
        // The first on the bench is the sixth man, who counts in full.
        const roleOf = (key) => (g.captain === key ? 'captain'
            : g.bench[0] === key ? 'sixth' : bench.has(key) ? 'bench' : 'starter');
        const sorted = sortRows(g.keys.map(k => rowByKey.get(k)).filter(Boolean).map(r => inGroup(r, roleOf(r.key))));
        const rows = [...sorted.filter(r => r.captain), ...sorted.filter(r => !r.captain)];
        const coach = coachByKey.get(g.coach);
        const coachLine = coach ? inGroup(coachRow(coach, live.games)) : null;
        return {
            ...g, colorHex: GROUP_COLORS[g.color % GROUP_COLORS.length], rows, coachRow: coachLine, sums: totals(rows, coachLine),
        };
    }), [rowByKey, coachByKey, live.games]);
    const groups = useMemo(() => scoreGroups(watch.groups), [scoreGroups, watch.groups]);
    const listGroups = useMemo(() => scoreGroups(lists.groups), [scoreGroups, lists.groups]);
    const roomGroups = useMemo(() => scoreGroups(roomRaw), [scoreGroups, roomRaw]);
    const roomTeam = roomGroups.find(g => g.id === roomTeamId)
        ?? roomGroups.find(g => g.mine) ?? roomGroups[0] ?? null;
    // Null only in My teams with no team yet (or signed out): TeamsGate shows instead.
    const group = groups.find(g => g.id === watch.selected?.id) ?? groups[0] ?? null;
    const shownGroups = isRooms ? roomGroups : groups;
    const groupsOf = useCallback(
        (key) => shownGroups.filter(g => g.keys.includes(key) || g.coach === key),
        [shownGroups],
    );
    // The open game, if any: the main column shows it in place of the group, and the
    // feed beside it follows that game rather than your players.
    const game = live.games.find(g => g.code === openGame) ?? null;
    const feed = useMemo(
        () => (game ? (live.gameEvents[game.code] ?? []) : live.events),
        [game, live.gameEvents, live.events],
    );
    const lastEvent = useMemo(() => {
        const latest = new Map();
        for (const e of feed) if (e.kind === 'player' && !latest.has(e.key)) latest.set(e.key, e);
        return latest;
    }, [feed]);
    const teamNames = useMemo(() => {
        const names = new Map();
        for (const g of live.games) {
            names.set(g.homeCode, g.homeName);
            names.set(g.awayCode, g.awayName);
        }
        return names;
    }, [live.games]);
    const suggestions = useMemo(() => {
        const playing = new Set(live.games.filter(g => g.status !== 'final').flatMap(g => [g.homeCode, g.awayCode]));
        return (roster ?? [])
            .filter(p => playing.has(euroleagueCode(p)) && typeof p.Average_Score === 'number' && !group?.keys.includes(p.PlayerKey))
            .sort((a, b) => b.Average_Score - a.Average_Score)
            .slice(0, 8);
    }, [roster, live.games, group?.keys]);

    const nameOf = useCallback((key, event) => rosterByKey.get(key)?.PlayerName
        ?? coachByKey.get(key)?.CoachName
        ?? (event?.name ? boxscoreName(event.name) : 'Player'), [rosterByKey, coachByKey]);
    const openPicker = (game = null) => setPicker({ open: true, game });
    const closePicker = useCallback(() => setPicker({ open: false, game: null }), []);
    const closeCoachPicker = useCallback(() => setCoachPicker(false), []);

    const loading = live.status === 'loading' || roster === null;

    const board = isRooms ? (rooms.board && (
        <GroupBoard
            round={live.round}
            groups={roomGroups}
            selectedId={roomTeam?.id}
            onSelect={(id) => { setRoomTeamId(id); setOpenGame(null); }}
            onCreate={null}
            noun="room board"
        />
    )) : group && (
        <GroupBoard
            round={live.round}
            groups={groups}
            selectedId={group.id}
            onSelect={(id) => { watch.select(id); setOpenGame(null); }}
            // A new watchlist is empty by definition, so go straight to filling it. New
            // teams are made in My Teams.
            onCreate={isTeams ? null : (name) => { lists.create(name); openPicker(); }}
            noun={isTeams ? 'teams' : 'watchlists'}
            placeholder={isTeams ? 'Team name' : "e.g. Dana's team"}
        />
    );

    return (
        <div className="space-y-5">
            {demo && (
                <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-sm text-amber-200">
                    <FlaskConical size={16} className="shrink-0" />
                    Demo replay: round {live.round ?? ''} played back at speed. Not live data.
                </div>
            )}

            <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-2xl font-bold flex flex-wrap items-center gap-3">
                        Live
                        {live.status === 'ready' && <StatusPill games={live.games} now={now} />}
                    </h2>
                    <p className="text-gray-400 text-sm mt-1">
                        {live.round ? `Round ${live.round} · ` : ''}
                        {live.status === 'ready'
                            ? <Freshness connection={live.connection} games={live.games} now={now} />
                            : 'Fantasy points as the games happen'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={toggleSound}
                        title={sound ? 'Chime on big plays: on' : 'Chime on big plays: off'}
                        aria-pressed={sound}
                        className={`p-2.5 rounded-lg border transition-colors ${sound
                            ? 'border-purple-500/40 bg-purple-500/15 text-purple-200'
                            : 'border-white/10 text-gray-400 hover:text-white hover:bg-white/5'}`}
                    >
                        {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
                    </button>
                    {mode === 'watchlists' ? (
                        <button
                            type="button"
                            onClick={() => openPicker()}
                            disabled={loading || !group}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 disabled:opacity-50"
                        >
                            <UserPlus size={16} /> Add players
                            {watch.limit && (
                                <span className="text-[11px] text-purple-200/80">{watch.allKeys.length}/{watch.limit}</span>
                            )}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={toMyTeams}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400"
                        >
                            <Shirt size={16} /> My Teams
                        </button>
                    )}
                </div>
            </header>

            {live.status === 'error' && (
                <div className="glass-panel p-5 flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-300">Couldn't load the game schedule from Euroleague.</span>
                    <button
                        type="button"
                        onClick={live.retry}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-white/10 text-gray-200 hover:bg-white/5"
                    >
                        <RefreshCw size={14} /> Try again
                    </button>
                </div>
            )}

            {loading && live.status !== 'error' && (
                <div className="w-full h-[300px] flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            )}

            {!loading && (
                <>
                    <GameStrip
                        games={live.games}
                        now={now}
                        selectedCode={openGame}
                        onOpen={(g) => setOpenGame(code => (code === g.code ? null : g.code))}
                    />

                    <div className="flex flex-col gap-3">
                        <ModeSwitch mode={mode} onChange={changeMode} />
                        {(isTeams || isRooms) && teams.signedIn && <LockBanner lock={lock} now={now} />}
                    </div>

                    {invite && (
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-sm">
                            <span className="flex-1 text-gray-200">
                                Someone shared <b className="text-white">{invite.name}</b> with you ({invite.keys.length} players). Follow it live?
                            </span>
                            <span className="flex gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => {
                                        lists.create(invite.name, invite.keys, { bench: invite.bench, captain: invite.captain, coach: invite.coach });
                                        changeMode('watchlists');
                                        setInvite(null);
                                        clearInvite();
                                        flash(`${invite.name} added to your watchlists`);
                                    }}
                                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-purple-600 hover:bg-purple-500"
                                >
                                    Add group
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setInvite(null); clearInvite(); }}
                                    className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white"
                                >
                                    No thanks
                                </button>
                            </span>
                        </div>
                    )}

                    {!isRooms && !group && !game ? (
                        <TeamsGate
                            teams={teams}
                            onSignIn={() => openAuth('Save your fantasy teams')}
                            onMyTeams={toMyTeams}
                        />
                    ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
                        {/* On a phone the scoreboard leads; on a wide screen it moves to the side. */}
                        <div className="xl:hidden">{board}</div>

                        {game ? (
                            <GameSection
                                key={game.code}
                                game={game}
                                roster={roster}
                                coaches={coaches}
                                groups={listGroups}
                                groupsOf={groupsOf}
                                lastEventOf={(key) => lastEvent.get(key)}
                                now={now}
                                watch={lists}
                                onOpenPlayer={(name) => openPlayer(name, CURRENT_SEASON)}
                                onBack={() => setOpenGame(null)}
                            />
                        ) : isRooms && !rooms.openId ? (
                            <RoomsDirectory
                                rooms={rooms}
                                onSignIn={() => openAuth('Watch the round with friends')}
                                onMyTeams={toMyTeams}
                            />
                        ) : isRooms ? (
                            <RoomView
                                rooms={rooms}
                                myTeams={teams.groups}
                                groups={roomGroups}
                                team={roomTeam}
                                onSelectTeam={setRoomTeamId}
                                onJoin={() => rooms.board && setJoining(rooms.board)}
                                onMyTeams={toMyTeams}
                                lock={lock}
                                now={now}
                                history={live.history}
                                lastEvent={lastEvent}
                                onOpenPlayer={(name) => openPlayer(name, CURRENT_SEASON)}
                                flash={flash}
                                view={teamView}
                                onChangeView={changeTeamView}
                                photos={headshots.players}
                                crests={headshots.crests}
                            />
                        ) : (
                        <section className="xl:col-span-2 space-y-3">
                            <GroupHeader
                                key={group.id}
                                group={group}
                                // Teams are renamed and deleted in My Teams.
                                canDelete={!isTeams && groups.length > 1}
                                readOnly={isTeams}
                                onRename={(name) => watch.rename(group.id, name)}
                                // Watchlists share an image and a copy link; teams get a
                                // live public page instead (phase C).
                                onShare={isTeams ? null : () => shareGroup(group, live.round).then(flash)}
                                onDelete={() => watch.destroy(group.id)}
                            />
                            {isTeams && (
                                <div className="flex items-center justify-between gap-2">
                                    <button type="button" onClick={toMyTeams} className="inline-flex items-center gap-1.5 text-xs text-purple-300 hover:text-purple-200">
                                        <Shirt size={13} /> Edit in My Teams
                                    </button>
                                    {group.rows.length > 0 && <ViewSwitch view={teamView} onChange={changeTeamView} />}
                                </div>
                            )}
                            {group.rows.length === 0 && isTeams ? (
                                <div className="glass-panel p-6 text-center text-sm text-gray-400">
                                    {group.name} has no players yet. Pick them in My Teams.
                                </div>
                            ) : group.rows.length === 0 ? (
                                <EmptyState
                                    group={group}
                                    isTeam={isTeams}
                                    suggestions={suggestions}
                                    onAdd={(key) => watch.add(group.id, key)}
                                    onPick={() => openPicker()}
                                />
                            ) : isTeams && teamView === 'court' ? (
                                <div className="relative">
                                    <TeamCourt
                                        group={group}
                                        photos={headshots.players}
                                        crests={headshots.crests}
                                        now={now}
                                        lastEvent={lastEvent}
                                        onOpenPlayer={(name) => openPlayer(name, CURRENT_SEASON)}
                                    />
                                </div>
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
                                                    {fixedScore(rows.reduce((s, r) => s + (r.counted ?? 0), 0))}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2">
                                                {rows.map(row => (
                                                    <WatchCard
                                                        key={row.key}
                                                        row={row}
                                                        history={live.history[row.key]}
                                                        lastEvent={lastEvent.get(row.key)}
                                                        now={now}
                                                        alsoIn={groupsOf(row.key).filter(g => g.id !== group.id)}
                                                        onRemove={isTeams ? undefined : () => watch.remove(group.id, row.key)}
                                                        onToggleBench={isTeams ? undefined : () => watch.toggleBench(group.id, row.key)}
                                                        onToggleCaptain={isTeams ? undefined : () => watch.toggleCaptain(group.id, row.key)}
                                                        onOpen={() => openPlayer(row.player.PlayerName, CURRENT_SEASON)}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </LayoutGroup>
                            )}
                            {!isTeams && <CoachSlot
                                group={group}
                                coaches={coaches}
                                games={live.games}
                                history={live.history}
                                lastEvent={lastEvent}
                                now={now}
                                picking={coachPicker === group.id}
                                onTogglePicker={() => setCoachPicker(id => (id === group.id ? false : group.id))}
                                onClosePicker={closeCoachPicker}
                                onPick={(key) => watch.toggleCoach(group.id, key)}
                            />}
                        </section>
                        )}

                        <aside className="space-y-4">
                            <div className="hidden xl:block">{board}</div>
                            {isRooms && rooms.board && (
                                <RoomChat
                                    key={rooms.board.id}
                                    board={rooms.board}
                                    userId={user?.id ?? null}
                                    now={now}
                                    notify={flash}
                                    onJoin={() => setJoining(rooms.board)}
                                />
                            )}
                            <ActivityFeed
                                title={game ? `${game.homeCode} vs ${game.awayCode}` : null}
                                events={feed}
                                nameOf={nameOf}
                                groupsOf={groupsOf}
                            />
                        </aside>
                    </div>
                    )}
                </>
            )}

            {toast && (
                <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-[#1a1a20] border border-white/10 text-sm text-white shadow-2xl">
                    {toast}
                </div>
            )}

            {(rooms.invite || joining) && (
                <JoinRoomDialog
                    key={`${(rooms.invite ?? joining).id}:${teams.groups.length}`}
                    room={rooms.invite ?? joining}
                    myTeams={teams.groups}
                    onCreateTeam={(name) => teams.create(name)}
                    onJoin={async (ids) => {
                        const room = rooms.invite ?? joining;
                        if (await rooms.join(room, ids, room.code ?? null)) { setJoining(null); changeMode('rooms'); }
                    }}
                    onClose={() => { if (rooms.invite) rooms.dismissInvite(); setJoining(null); }}
                />
            )}

            {picker.open && roster && group && (
                <LivePicker
                    roster={roster}
                    names={headshots.names}
                    games={live.games}
                    focusGame={picker.game}
                    watch={watch}
                    group={group}
                    round={live.round}
                    teamNames={teamNames}
                    now={now}
                    onClose={closePicker}
                />
            )}
        </div>
    );
}
