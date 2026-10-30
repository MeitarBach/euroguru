import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './authContext';
import {
    listLeagues, createLeague, renameLeague, deleteLeague, leagueBoard, leaguePreview,
    joinLeague, resetInvite, removeFromLeague, getNickname, saveNickname,
    readLeagueCode, clearLeagueCode,
} from '../lib/leagues';

const SELECTED_KEY = 'euroguru.liveLeagueSelected';
// The board's scores come from the live feed in the browser; what this refreshes is
// who is in the league and, at the lock, everyone's saved lineup.
const BOARD_REFRESH_MS = 60_000;

const loadSelected = () => {
    try {
        return window.localStorage.getItem(SELECTED_KEY);
    } catch {
        return null;
    }
};

/** A first name for a new profile: Google's given name, else the start of the full name. */
function firstNameOf(user) {
    const meta = user?.user_metadata ?? {};
    const name = meta.given_name || String(meta.full_name || meta.name || '').trim().split(/\s+/)[0];
    return (name || 'Player').slice(0, 24);
}

/**
 * The leagues you run or have a team in, the open one's board, and every league action.
 *
 * Visibility is the database's job (league_board only shows rivals' lineups as saved
 * at the lock), so this just loads, refreshes and reports. Actions resolve to true on
 * success and report failures through `notify`.
 *
 * Also owns the two bits of league state that are about you rather than a league:
 *   - your nickname, the name rivals see (created from your first name on first sign-in);
 *   - an invite opened from a ?league= link, previewed once you are signed in.
 */
export default function useLeagues({ season, notify } = {}) {
    const { user } = useAuth();
    const userId = user?.id ?? null;
    const [loaded, setLoaded] = useState({ userId: null, leagues: [], status: 'idle' });
    const [version, setVersion] = useState(0);
    const [selectedId, setSelectedId] = useState(loadSelected);
    const [board, setBoard] = useState(null);
    const [boardVersion, setBoardVersion] = useState(0);
    const [nickname, setNickname] = useState(null);
    const [inviteCode, setInviteCode] = useState(() => readLeagueCode());
    const [invite, setInvite] = useState(null); // league_preview's answer for inviteCode

    const notifyRef = useRef(notify);
    useEffect(() => { notifyRef.current = notify; }, [notify]);
    const say = useCallback((message) => notifyRef.current?.(message), []);

    useEffect(() => {
        if (!userId) return undefined;
        let alive = true;
        listLeagues()
            .then(rows => { if (alive) setLoaded({ userId, leagues: rows ?? [], status: 'ready' }); })
            .catch(() => { if (alive) setLoaded({ userId, leagues: [], status: 'error' }); });
        return () => { alive = false; };
    }, [userId, version]);
    const reload = useCallback(() => setVersion(v => v + 1), []);

    const mine = loaded.userId === userId && userId !== null;
    const leagues = mine ? loaded.leagues : [];
    const status = !userId ? 'idle' : mine ? loaded.status : 'loading';
    const selected = leagues.find(l => l.id === selectedId) ?? leagues[0] ?? null;
    const selectedLeagueId = selected?.id ?? null;

    const select = useCallback((id) => {
        setSelectedId(id);
        try {
            window.localStorage.setItem(SELECTED_KEY, id);
        } catch { /* falls back to the first league next time */ }
    }, []);

    // The open league's board, refreshed while it is open.
    useEffect(() => {
        if (!selectedLeagueId) return undefined;
        let alive = true;
        const load = () => leagueBoard(selectedLeagueId)
            .then(b => { if (alive) setBoard(b); })
            .catch(() => { if (alive) setBoard(null); });
        load();
        const id = setInterval(load, BOARD_REFRESH_MS);
        return () => { alive = false; clearInterval(id); };
    }, [selectedLeagueId, boardVersion]);
    const refreshBoard = useCallback(() => setBoardVersion(v => v + 1), []);
    const shownBoard = board && board.id === selectedLeagueId ? board : null;

    // Your nickname: read on sign-in, created from your first name if you have none.
    useEffect(() => {
        if (!userId) return undefined;
        let alive = true;
        getNickname(userId)
            .then(name => name ?? saveNickname(userId, firstNameOf(user)).then(r => r.nickname))
            .then(name => { if (alive) setNickname(name); })
            .catch(() => {});
        return () => { alive = false; };
    }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps -- `user` changes identity on every token refresh

    const changeNickname = useCallback(async (name) => {
        const clean = String(name ?? '').trim().slice(0, 24);
        if (!clean || !userId) return false;
        try {
            const row = await saveNickname(userId, clean);
            setNickname(row.nickname);
            refreshBoard();
            return true;
        } catch (e) {
            say(`Couldn't save your name: ${e.message}`);
            return false;
        }
    }, [userId, refreshBoard, say]);

    // An invite link: previewed once signed in. Signed out, the caller raises sign-in.
    useEffect(() => {
        if (!inviteCode || !userId) return undefined;
        let alive = true;
        leaguePreview(inviteCode)
            .then(p => {
                if (!alive) return;
                if (p) setInvite({ code: inviteCode, ...p });
                else { say('That league invite link no longer works'); setInviteCode(null); clearLeagueCode(); }
            })
            .catch(e => { if (alive) say(`Couldn't open the invite: ${e.message}`); });
        return () => { alive = false; };
    }, [inviteCode, userId, say]);
    const dismissInvite = useCallback(() => { setInvite(null); setInviteCode(null); clearLeagueCode(); }, []);

    const act = useCallback(async (work, done) => {
        try {
            const result = await work();
            done?.(result);
            return result ?? true;
        } catch (e) {
            say(e.message);
            return false;
        }
    }, [say]);

    const join = useCallback((teamIds) => act(async () => {
        let lid = null;
        for (const id of teamIds) lid = await joinLeague(invite.code, id);
        return lid;
    }, (lid) => {
        setInvite(null); setInviteCode(null); clearLeagueCode();
        if (lid) select(lid);
        reload(); refreshBoard();
    }), [act, invite, select, reload, refreshBoard]);

    const create = useCallback((name) => act(
        () => createLeague(String(name ?? '').trim().slice(0, 40) || 'My league', season),
        (row) => { select(row.id); reload(); },
    ), [act, season, select, reload]);

    const rename = useCallback((id, name) => act(
        () => renameLeague(id, String(name ?? '').trim().slice(0, 40)),
        () => { reload(); refreshBoard(); },
    ), [act, reload, refreshBoard]);

    const destroy = useCallback((id) => act(() => deleteLeague(id), () => { setBoard(null); reload(); }), [act, reload]);

    const newInvite = useCallback((id) => act(() => resetInvite(id), () => refreshBoard()), [act, refreshBoard]);

    // Your own team leaving, or - as admin - anyone's being removed.
    const removeTeam = useCallback((id, teamId) => act(
        () => removeFromLeague(id, teamId),
        () => { reload(); refreshBoard(); },
    ), [act, reload, refreshBoard]);

    // Joining with another of your teams, from inside the league (you have the code).
    const addTeam = useCallback((code, teamId) => act(
        () => joinLeague(code, teamId),
        () => refreshBoard(),
    ), [act, refreshBoard]);

    return {
        signedIn: Boolean(userId),
        status, reload,
        leagues, selected, select,
        board: shownBoard, refreshBoard,
        nickname, changeNickname,
        inviteCode, invite, dismissInvite, join,
        create, rename, destroy, newInvite, removeTeam, addTeam,
    };
}
