import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './authContext';
import { getNickname, saveNickname } from '../lib/teams';
import {
    myRooms, publicRooms, createRoom, updateRoom, closeRoom, roomBoard, roomPreview, joinRoom,
    resetInvite, removeFromRoom, readRoomCode, clearRoomCode, ROOM_NAME_MAX,
} from '../lib/rooms';

// The board's scores come from the live feed in the browser; what this refreshes is
// who is in the room and, at the lock, everyone's saved lineup.
const BOARD_REFRESH_MS = 60_000;

/** A first name for a new profile: Google's given name, else the start of the full name. */
function firstNameOf(user) {
    const meta = user?.user_metadata ?? {};
    const name = meta.given_name || String(meta.full_name || meta.name || '').trim().split(/\s+/)[0];
    return (name || 'Player').slice(0, 24);
}

/**
 * Watch Rooms: the ones you are in, the public directory, the open room's board, and
 * every room action. Visibility is the database's job (room_board shows rivals'
 * lineups only as saved at the lock), so this loads, refreshes and reports. Actions
 * resolve to a truthy value on success and report failures through `notify`.
 *
 * `openId` is the room on screen - one of yours, or a public room you are looking into
 * before joining - and null when none is (the Live hub decides which page shows, so
 * joining or creating a room does not open it: the caller navigates).
 *
 * Also owns the bits that are about you rather than a room: your nickname (made from
 * your first name on first sign-in), and an invite opened from a ?room= link.
 */
export default function useRooms({ notify } = {}) {
    const { user } = useAuth();
    const userId = user?.id ?? null;
    const [loaded, setLoaded] = useState({ userId: null, rooms: [], status: 'idle' });
    const [version, setVersion] = useState(0);
    const [openId, setOpenId] = useState(null);
    const [board, setBoard] = useState(null);
    const [boardVersion, setBoardVersion] = useState(0);
    const [search, setSearch] = useState('');
    const [directory, setDirectory] = useState({ key: null, rooms: [], status: 'idle' });
    const [nickname, setNickname] = useState(null);
    const [inviteCode, setInviteCode] = useState(() => readRoomCode());
    const [invite, setInvite] = useState(null); // room_preview's answer for inviteCode

    const notifyRef = useRef(notify);
    useEffect(() => { notifyRef.current = notify; }, [notify]);
    const say = useCallback((message) => notifyRef.current?.(message), []);

    useEffect(() => {
        if (!userId) return undefined;
        let alive = true;
        myRooms()
            .then(rows => { if (alive) setLoaded({ userId, rooms: rows ?? [], status: 'ready' }); })
            .catch(() => { if (alive) setLoaded({ userId, rooms: [], status: 'error' }); });
        return () => { alive = false; };
    }, [userId, version]);
    const reload = useCallback(() => setVersion(v => v + 1), []);

    const mine = loaded.userId === userId && userId !== null;
    const rooms = mine ? loaded.rooms : [];
    const status = !userId ? 'idle' : mine ? loaded.status : 'loading';

    // The public directory, refetched as the search changes (debounced) and whenever
    // your own rooms change (a join moves a room's count).
    useEffect(() => {
        if (!userId) return undefined;
        let alive = true;
        const key = `${userId}:${search}:${version}`;
        const id = setTimeout(() => {
            publicRooms(search)
                .then(rows => { if (alive) setDirectory({ key, rooms: rows ?? [], status: 'ready' }); })
                .catch(() => { if (alive) setDirectory({ key, rooms: [], status: 'error' }); });
        }, search ? 250 : 0);
        return () => { alive = false; clearTimeout(id); };
    }, [userId, search, version]);

    const open = useCallback((id) => setOpenId(id ?? null), []);

    // The open room's board, refreshed while it is open. A room that is gone (closed,
    // or you were removed from a private one) sends you back to the directory.
    const openRoomId = userId ? openId : null;
    useEffect(() => {
        if (!openRoomId) return undefined;
        let alive = true;
        const load = () => roomBoard(openRoomId)
            .then(b => { if (alive) setBoard(b); })
            .catch((e) => {
                if (!alive) return;
                setBoard(null);
                if (e.hint === 'not_found') open(null);
            });
        load();
        const id = setInterval(load, BOARD_REFRESH_MS);
        return () => { alive = false; clearInterval(id); };
    }, [openRoomId, boardVersion, open]);
    const refreshBoard = useCallback(() => setBoardVersion(v => v + 1), []);
    const shownBoard = board && board.id === openRoomId ? board : null;

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
        roomPreview(inviteCode)
            .then(p => {
                if (!alive) return;
                if (p) setInvite({ code: inviteCode, ...p });
                else { say('That room invite link no longer works'); setInviteCode(null); clearRoomCode(); }
            })
            .catch(e => { if (alive) say(`Couldn't open the invite: ${e.message}`); });
        return () => { alive = false; };
    }, [inviteCode, userId, say]);
    const dismissInvite = useCallback(() => { setInvite(null); setInviteCode(null); clearRoomCode(); }, []);
    // An invite link or code pasted in the hub: previewed like a ?room= link.
    const previewCode = useCallback((code) => { setInvite(null); setInviteCode(code); }, []);

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

    /**
     * Bring teams into a room: `room` is a card or board ({id, visibility}), or an invite.
     * Resolves to the room's id. An invite stays up until dismissed, so a second team
     * can follow the first.
     */
    const join = useCallback((room, teamIds, code = null) => act(
        () => joinRoom({ id: room.id, code: code ?? room.code ?? room.invite_code ?? null, teamIds }),
        () => { reload(); refreshBoard(); },
    ), [act, reload, refreshBoard]);

    /** A new room, yours; resolves to its id. */
    const create = useCallback((name, visibility = 'private') => act(
        () => createRoom(String(name ?? '').trim().slice(0, ROOM_NAME_MAX) || 'Watch Room', visibility),
        () => reload(),
    ), [act, reload]);

    const update = useCallback((id, fields) => act(
        () => updateRoom(id, fields),
        () => { reload(); refreshBoard(); },
    ), [act, reload, refreshBoard]);

    const close = useCallback((id) => act(
        () => closeRoom(id),
        () => { setBoard(null); open(null); reload(); say('Room closed'); },
    ), [act, open, reload, say]);

    const newInvite = useCallback((id) => act(() => resetInvite(id), () => refreshBoard()), [act, refreshBoard]);

    // Your own team leaving, or - as admin - anyone's being removed.
    const removeTeam = useCallback((id, teamId) => act(
        () => removeFromRoom(id, teamId),
        () => { reload(); refreshBoard(); },
    ), [act, reload, refreshBoard]);

    return {
        signedIn: Boolean(userId),
        status, reload,
        rooms,
        openId: openRoomId, open,
        board: shownBoard, refreshBoard,
        search, setSearch,
        publicRooms: directory.key?.startsWith(`${userId}:`) ? directory.rooms : [],
        directoryStatus: directory.status,
        nickname, changeNickname,
        inviteCode, invite, dismissInvite, previewCode,
        join, create, update, close, newInvite, removeTeam,
    };
}
