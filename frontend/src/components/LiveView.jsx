import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX, FlaskConical, RefreshCw } from 'lucide-react';
import { fetchStats, fetchCoaches, fetchHeadshots } from '../services/api';
import { CURRENT_SEASON } from '../seasons';
import useWatchGroups, { GROUP_COLORS } from '../hooks/useWatchGroups';
import useTeams from '../hooks/useTeams';
import useRoundLock from '../hooks/useRoundLock';
import useRooms from '../hooks/useRooms';
import useRoomBoards from '../hooks/useRoomBoards';
import usePlayedLineups from '../hooks/usePlayedLineups';
import RoomView from './live/RoomView';
import { useAuth } from '../hooks/authContext';
import useLiveRound from '../hooks/useLiveRound';
import useNow from '../hooks/useNow';
import { useOpenPlayer } from '../hooks/playerDetailContext';
import { euroleagueSource } from '../lib/live/source';
import { demoSource } from '../lib/live/demo';
import { watchRow, inGroup, sortRows, totals, coachRow, coachKey, boxscoreName } from '../lib/live/rows';
import { boardTeams, standingOf } from '../lib/live/standings';
import { countdown, ago } from '../lib/live/format';
import { chime, enableChime } from '../lib/live/chime';
import { euroleagueCode } from '../lib/live/teams';
import { shareGroup, readInvite, clearInvite } from '../lib/live/share';
import GameStrip from './live/GameStrip';
import { GroupBoard } from './live/GroupBoard';
import ActivityFeed from './live/ActivityFeed';
import LivePicker from './live/LivePicker';
import GameSection from './live/GameSection';
import LiveDot from './live/LiveDot';
import MyTeamsWidget from './live/hub/MyTeamsWidget';
import RoomsWidget from './live/hub/RoomsWidget';
import HubHeader from './live/hub/HubHeader';
import TeamPage from './live/hub/TeamPage';
import WatchlistPage from './live/hub/WatchlistPage';
import BringDialog from './live/hub/BringDialog';

const SEASON_CODE = `E${CURRENT_SEASON}`;
// Every priced player, with season averages: the same request the stats table makes
// for its widest view, so it is usually already cached.
const ROSTER_QUERY = { season: CURRENT_SEASON, position: 'All', min_cr: 0, max_cr: 100, last_x_games: 100 };
const SOUND_KEY = 'euroguru.liveSound';
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
// The hub's home; the other pages are { kind: 'team' | 'room' | 'list', id }.
const HOME = { kind: 'home' };

const sameLineup = (a, b) => a.captain === b.captain && a.coach === b.coach
    && a.keys.length === b.keys.length && a.keys.every(k => b.keys.includes(k))
    && a.bench.length === b.bench.length && a.bench.every((k, i) => b.bench[i] === k);

const loadSound = () => {
    try {
        return window.localStorage.getItem(SOUND_KEY) === 'on';
    } catch {
        return false;
    }
};

function StatusPill({ games, nextRound, now }) {
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
        return (
            <span className="px-2.5 py-1 rounded-full bg-white/5 text-xs text-gray-400">
                Round complete
                {nextRound && nextRound.tipoff > now && <> · Round {nextRound.round} in {countdown(nextRound.tipoff - now)}</>}
            </span>
        );
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

/**
 * Live: fantasy points as the games happen, organised as a hub. The home shows your
 * teams, your Watch Rooms (and public ones to discover) and your watchlists as widgets,
 * each live; a team, a room or a watchlist opens on a page of its own, with a switcher
 * to jump between them. Bringing a team into a room is one dialog, reachable from the
 * team, the room, or My Teams.
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
    const [picker, setPicker] = useState({ open: false, game: null });
    // The game open in the game view, by code - its boxscore is polled while it is.
    const [openGame, setOpenGame] = useState(null);
    // A watchlist someone shared with an invite link (?join=), offered until accepted or dismissed.
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
    const toMyTeams = () => onNavigate?.('teams');
    const lock = useRoundLock(CURRENT_SEASON, now);
    const lists = useWatchGroups();
    const teams = useTeams({ lock, notify: flash });
    const rooms = useRooms({ notify: flash });
    const openRoom = rooms.open;

    // Which page of the hub is on screen, the team picked in a room, and the bring
    // dialog: { teamId } for one of your teams, { room } for a room.
    const [page, setPage] = useState(HOME);
    const [roomTeamId, setRoomTeamId] = useState(null);
    const [bring, setBring] = useState(null);
    const go = useCallback((next) => {
        setPage(next);
        setOpenGame(null);
        setRoomTeamId(null);
        openRoom(next.kind === 'room' ? next.id : null);
        window.scrollTo?.({ top: 0, behavior: 'smooth' });
    }, [openRoom]);
    const goHome = useCallback(() => go(HOME), [go]);

    // The open room went away under you (closed, or you lost access to it): home.
    const [seenOpenId, setSeenOpenId] = useState(rooms.openId);
    if (rooms.openId !== seenOpenId) {
        setSeenOpenId(rooms.openId);
        if (rooms.openId === null && page.kind === 'room') setPage(HOME);
    }

    // Another tab sent us here: "Bring to a Watch Room" from My Teams opens the bring
    // dialog for that team on the home. Adjusted while rendering, once per request.
    const [seenIntent, setSeenIntent] = useState(intent);
    if (intent !== seenIntent) {
        setSeenIntent(intent);
        if (intent) {
            setPage(HOME);
            setOpenGame(null);
            if (intent.bring) setBring({ teamId: intent.bring });
        }
    }

    // Teams change in My Teams while this tab stays mounted: catch up on return.
    const [boardsVersion, setBoardsVersion] = useState(0);
    const refreshRooms = useCallback(() => setBoardsVersion(v => v + 1), []);
    const wasActive = useRef(active);
    useEffect(() => {
        // (useRoomBoards reloads on its own when `active` comes back.)
        if (active && !wasActive.current) { teams.reload(); rooms.reload(); rooms.refreshBoard(); }
        wasActive.current = active;
    }, [active]); // eslint-disable-line react-hooks/exhaustive-deps -- reloads are stable; only the switch matters

    // An invite link opened signed out: ask to sign in, once.
    const askedSignIn = useRef(false);
    useEffect(() => {
        if (rooms.inviteCode && !user && !authLoading && !askedSignIn.current) {
            askedSignIn.current = true;
            openAuth('Sign in to join this Watch Room');
        }
    }, [rooms.inviteCode, user, authLoading, openAuth]);
    const openPlayer = useOpenPlayer();
    const openPlayerNow = useCallback((name) => openPlayer(name, CURRENT_SEASON), [openPlayer]);

    useEffect(() => {
        let alive = true;
        fetchStats(ROSTER_QUERY).then(rows => { if (alive) setRoster(rows ?? []); });
        fetchCoaches(CURRENT_SEASON).then(rows => { if (alive) setCoaches(Array.isArray(rows) ? rows : []); });
        fetchHeadshots(CURRENT_SEASON).then(map => { if (alive && map?.players) setHeadshots(map); });
        return () => { alive = false; };
    }, []);
    const coachByKey = useMemo(() => new Map(coaches.map(c => [coachKey(c), c])), [coaches]);

    // Every room of yours, for the home's standings; and the open room (maybe a public
    // one you are only looking into).
    const myRoomIds = useMemo(() => rooms.rooms.map(r => r.id), [rooms.rooms]);
    const boards = useRoomBoards(myRoomIds, { active, version: boardsVersion });
    const boardRaw = useMemo(
        () => Object.fromEntries(Object.entries(boards).map(([id, b]) => [id, boardTeams(b)])),
        [boards],
    );
    const roomRaw = useMemo(() => boardTeams(rooms.board), [rooms.board]);

    // Between rounds the page keeps the last round, while your teams are already open for
    // the next: each is scored on the lineup it played that round with (as the rooms' boards
    // are), flagged `edited` when it has changed since. The round comes from the live loop
    // below, kept here so those lineups' players are in the loop's own list.
    const [shownRound, setShownRound] = useState(null);
    const played = usePlayedLineups(CURRENT_SEASON, shownRound, { userId: user?.id ?? null, enabled: lock.ready && !lock.locked });
    const teamRaw = useMemo(() => teams.groups.map(g => {
        const asPlayed = played[g.id];
        return asPlayed ? { ...g, ...asPlayed, edited: !sameLineup(asPlayed, g) } : g;
    }), [teams.groups, played]);

    // Everyone in a team, a watchlist or a room, and every coach any of them has, for the live loop.
    const allRaw = useMemo(
        () => [...teamRaw, ...lists.groups, ...roomRaw, ...Object.values(boardRaw).flat()],
        [teamRaw, lists.groups, roomRaw, boardRaw],
    );
    const followedKeys = useMemo(() => [...new Set(allRaw.flatMap(g => g.keys))], [allRaw]);
    const watchCoaches = useMemo(() => [...new Set(allRaw.map(g => g.coach).filter(Boolean))]
        .map(key => coachByKey.get(key))
        .filter(Boolean)
        .map(c => ({ key: coachKey(c), code: c.TeamCode, name: c.CoachName })), [allRaw, coachByKey]);

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
    if (live.round !== shownRound) setShownRound(live.round);

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
    const teamGroups = useMemo(() => scoreGroups(teamRaw), [scoreGroups, teamRaw]);
    const listGroups = useMemo(() => scoreGroups(lists.groups), [scoreGroups, lists.groups]);
    const roomGroups = useMemo(() => scoreGroups(roomRaw), [scoreGroups, roomRaw]);
    const standings = useMemo(
        () => Object.fromEntries(Object.entries(boardRaw).map(([id, raw]) => [id, standingOf(scoreGroups(raw))])),
        [boardRaw, scoreGroups],
    );
    // The rooms a team of yours plays in, with its place in each.
    const roomsOf = useCallback((teamId) => rooms.rooms
        .filter(r => (r.my_teams ?? []).includes(teamId))
        .map(r => {
            const s = standings[r.id];
            return { id: r.id, name: r.name, place: s?.placeOf(teamId) ?? null, size: s?.size ?? r.teams, revealed: Boolean(s?.revealed) };
        }), [rooms.rooms, standings]);

    // What is on screen. A team or watchlist that is gone (deleted elsewhere) means home.
    const team = page.kind === 'team' ? teamGroups.find(g => g.id === page.id) ?? null : null;
    const list = page.kind === 'list' ? listGroups.find(g => g.id === page.id) ?? null : null;
    const shown = (page.kind === 'team' && !team) || (page.kind === 'list' && !list) ? HOME : page;
    const roomTeam = roomGroups.find(g => g.id === roomTeamId)
        ?? roomGroups.find(g => g.mine) ?? roomGroups[0] ?? null;

    const shownGroups = useMemo(
        () => (shown.kind === 'room' ? roomGroups : [...teamGroups, ...listGroups]),
        [shown.kind, roomGroups, teamGroups, listGroups],
    );
    const groupsOf = useCallback(
        (key) => shownGroups.filter(g => g.keys.includes(key) || g.coach === key),
        [shownGroups],
    );
    // The open game, if any: the page shows it in place of the rest, and the feed beside
    // it follows that game rather than your players.
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
            .filter(p => playing.has(euroleagueCode(p)) && typeof p.Average_Score === 'number' && !list?.keys.includes(p.PlayerKey))
            .sort((a, b) => b.Average_Score - a.Average_Score)
            .slice(0, 8);
    }, [roster, live.games, list?.keys]);

    const nameOf = useCallback((key, event) => rosterByKey.get(key)?.PlayerName
        ?? coachByKey.get(key)?.CoachName
        ?? (event?.name ? boxscoreName(event.name) : 'Player'), [rosterByKey, coachByKey]);
    const closePicker = useCallback(() => setPicker({ open: false, game: null }), []);

    // ---------------------------------------------------------------- bringing teams in
    // Your rooms as the bring dialog needs them: a member brings another team into a
    // private room with its invite code, which only the room's board carries.
    const myRoomsForBring = useMemo(() => rooms.rooms.map(r => ({
        ...r, invite_code: boards[r.id]?.invite_code ?? (rooms.board?.id === r.id ? rooms.board.invite_code : null),
    })), [rooms.rooms, boards, rooms.board]);
    const joinRoom = async (room, teamIds) => {
        const rid = await rooms.join(room, teamIds, room.code ?? null);
        if (rid) refreshRooms();
        return rid;
    };
    const leaveRoom = async (roomId, teamId) => {
        const ok = await rooms.removeTeam(roomId, teamId);
        if (ok) refreshRooms();
        return ok;
    };
    // An invite link (?room=, or pasted in the hub) opens the dialog for its room.
    const bringRoom = bring?.room ?? (rooms.invite ? rooms.invite : null);
    const bringIsInvite = !bring?.room && Boolean(rooms.invite);
    const bringTeam = bring?.teamId ? teams.groups.find(t => t.id === bring.teamId) ?? null : null;
    // The room on screen as a room card, for "+ Bring a team" there.
    const roomCard = rooms.board ? {
        id: rooms.board.id,
        name: rooms.board.name,
        visibility: rooms.board.visibility,
        official: rooms.board.official,
        admin: rooms.board.admin,
        teams: roomGroups.length,
        cap: rooms.board.cap,
        invite_code: rooms.board.invite_code,
        my_teams: roomGroups.filter(g => g.mine).map(g => g.id),
    } : null;

    const loading = live.status === 'loading' || roster === null;
    const items = {
        teams: teams.groups.map(t => ({ id: t.id, name: t.name })),
        rooms: [...rooms.rooms, ...(rooms.board && !myRoomIds.includes(rooms.board.id) ? [rooms.board] : [])]
            .map(r => ({ id: r.id, name: r.name })),
        lists: lists.groups.map(g => ({ id: g.id, name: g.name })),
    };

    return (
        <div className="space-y-5">
            {demo && (
                <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-sm text-amber-200">
                    <FlaskConical size={16} className="shrink-0" />
                    Demo replay: round {live.round ?? ''} played back at speed. Not live data.
                </div>
            )}

            <header className="flex items-end justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold flex flex-wrap items-center gap-3">
                        Live
                        {live.status === 'ready' && <StatusPill games={live.games} nextRound={live.nextRound} now={now} />}
                    </h2>
                    <p className="text-gray-400 text-sm mt-1">
                        {live.round ? `Round ${live.round} · ` : ''}
                        {live.status === 'ready'
                            ? <Freshness connection={live.connection} games={live.games} now={now} />
                            : 'Fantasy points as the games happen'}
                    </p>
                </div>
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

                    {invite && (
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-sm">
                            <span className="flex-1 text-gray-200">
                                Someone shared <b className="text-white">{invite.name}</b> with you ({invite.keys.length} players). Follow it live?
                            </span>
                            <span className="flex gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const id = lists.create(invite.name, invite.keys, { bench: invite.bench, captain: invite.captain, coach: invite.coach });
                                        setInvite(null);
                                        clearInvite();
                                        flash(`${invite.name} added to your watchlists`);
                                        go({ kind: 'list', id });
                                    }}
                                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-purple-600 hover:bg-purple-500"
                                >
                                    Add watchlist
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

                    {shown.kind !== 'home' && !game && (
                        <HubHeader items={items} current={shown} onGo={go} onHome={goHome} />
                    )}

                    {game ? (
                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
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
                                onOpenPlayer={openPlayerNow}
                                onBack={() => setOpenGame(null)}
                            />
                            <aside className="space-y-4">
                                <ActivityFeed title={`${game.homeCode} vs ${game.awayCode}`} events={feed} nameOf={nameOf} groupsOf={groupsOf} />
                            </aside>
                        </div>
                    ) : shown.kind === 'team' ? (
                        <TeamPage
                            group={team}
                            rooms={roomsOf(team.id)}
                            photos={headshots.players}
                            crests={headshots.crests}
                            now={now}
                            lock={lock}
                            round={live.round}
                            nextRound={live.nextRound}
                            lastEvent={lastEvent}
                            history={live.history}
                            view={teamView}
                            onChangeView={changeTeamView}
                            feed={feed}
                            nameOf={nameOf}
                            groupsOf={groupsOf}
                            onOpenPlayer={openPlayerNow}
                            onBring={() => setBring({ teamId: team.id })}
                            onMyTeams={toMyTeams}
                            onOpenRoom={(id) => go({ kind: 'room', id })}
                        />
                    ) : shown.kind === 'room' ? (
                        <RoomView
                            rooms={{ ...rooms, close: async (id) => { const ok = await rooms.close(id); if (ok) { refreshRooms(); goHome(); } return ok; },
                                removeTeam: leaveRoom }}
                            groups={roomGroups}
                            team={roomTeam}
                            onSelectTeam={setRoomTeamId}
                            myTeams={teams.groups}
                            lock={lock}
                            now={now}
                            history={live.history}
                            lastEvent={lastEvent}
                            onOpenPlayer={openPlayerNow}
                            flash={flash}
                            view={teamView}
                            onChangeView={changeTeamView}
                            photos={headshots.players}
                            crests={headshots.crests}
                            onBring={() => roomCard && setBring({ room: roomCard })}
                            onMyTeams={toMyTeams}
                            round={live.round}
                            userId={user?.id ?? null}
                            feed={feed}
                            nameOf={nameOf}
                            groupsOf={groupsOf}
                        />
                    ) : shown.kind === 'list' ? (
                        <WatchlistPage
                            group={list}
                            watch={lists}
                            canDelete={listGroups.length > 1}
                            coaches={coaches}
                            games={live.games}
                            history={live.history}
                            lastEvent={lastEvent}
                            now={now}
                            suggestions={suggestions}
                            feed={feed}
                            nameOf={nameOf}
                            groupsOf={groupsOf}
                            onAddPlayers={() => setPicker({ open: true, game: null })}
                            onShare={() => shareGroup(list, live.round).then(flash)}
                            onDeleted={goHome}
                            onOpenPlayer={openPlayerNow}
                        />
                    ) : (
                        // The home: your teams and the Watch Rooms on the left, the
                        // watchlists and the plays on the right; on a phone in that order.
                        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 items-start">
                            <div className="xl:col-span-3 space-y-5">
                                <MyTeamsWidget
                                    teams={teams}
                                    groups={teamGroups}
                                    photos={headshots.players}
                                    roomsOf={roomsOf}
                                    lock={lock}
                                    now={now}
                                    round={live.round}
                                    onOpen={(id) => go({ kind: 'team', id })}
                                    onBring={(id) => setBring({ teamId: id })}
                                    onOpenRoom={(id) => go({ kind: 'room', id })}
                                    onMyTeams={toMyTeams}
                                    onSignIn={() => openAuth('Save your fantasy teams')}
                                />
                                <RoomsWidget
                                    rooms={rooms}
                                    standings={standings}
                                    onOpen={(id) => go({ kind: 'room', id })}
                                    onJoin={(room) => setBring({ room })}
                                    onCreated={(id) => { refreshRooms(); go({ kind: 'room', id }); }}
                                    onSignIn={() => openAuth('Watch the round with friends')}
                                    notify={flash}
                                />
                            </div>
                            <div className="xl:col-span-2 space-y-5">
                                <GroupBoard
                                    round={live.round}
                                    groups={listGroups}
                                    selectedId={null}
                                    onSelect={(id) => go({ kind: 'list', id })}
                                    onCreate={(name) => { const id = lists.create(name); go({ kind: 'list', id }); setPicker({ open: true, game: null }); }}
                                    noun="watchlists"
                                />
                                <ActivityFeed events={feed} nameOf={nameOf} groupsOf={groupsOf} />
                            </div>
                        </div>
                    )}
                </>
            )}

            {toast && (
                <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-[#1a1a20] border border-white/10 text-sm text-white shadow-2xl">
                    {toast}
                </div>
            )}

            {bringRoom && (
                <BringDialog
                    key={`room:${bringRoom.id}`}
                    room={bringRoom}
                    myTeams={teams.groups}
                    onJoin={(teamId) => joinRoom(bringRoom, [teamId])}
                    onLeave={(teamId) => leaveRoom(bringRoom.id, teamId)}
                    onCreateTeam={(name) => teams.create(name)}
                    onMyTeams={() => { if (bringIsInvite) rooms.dismissInvite(); setBring(null); toMyTeams(); }}
                    // Already on the room's page, "Open the room" would go nowhere.
                    onOpenRoom={shown.kind === 'room' && shown.id === bringRoom.id ? null
                        : (id) => { if (bringIsInvite) rooms.dismissInvite(); setBring(null); go({ kind: 'room', id }); }}
                    onClose={() => { if (bringIsInvite) rooms.dismissInvite(); setBring(null); }}
                />
            )}
            {!bringRoom && bringTeam && (
                <BringDialog
                    key={`team:${bringTeam.id}`}
                    team={bringTeam}
                    myRooms={myRoomsForBring}
                    publicRooms={rooms.publicRooms}
                    onJoinRoom={(room) => joinRoom(room, [bringTeam.id])}
                    onLeaveRoom={(roomId) => leaveRoom(roomId, bringTeam.id)}
                    onCreateRoom={async (name, visibility) => {
                        const rid = await rooms.create(name, visibility);
                        if (!rid) return false;
                        const ok = await joinRoom({ id: rid, visibility }, [bringTeam.id]);
                        return ok ? rid : false;
                    }}
                    onPasteCode={(code) => { setBring(null); rooms.previewCode(code); }}
                    onOpenRoom={(id) => { setBring(null); go({ kind: 'room', id }); }}
                    onClose={() => setBring(null)}
                />
            )}

            {picker.open && roster && list && (
                <LivePicker
                    roster={roster}
                    names={headshots.names}
                    games={live.games}
                    focusGame={picker.game}
                    watch={lists}
                    group={list}
                    round={live.round}
                    teamNames={teamNames}
                    now={now}
                    onClose={closePicker}
                />
            )}
        </div>
    );
}
