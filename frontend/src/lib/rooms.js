import { db, run } from './db';
import { auth } from './auth';

/**
 * Watch Rooms: where people bring their teams to watch the round together, live, and
 * chat while the games are on. Not a competition - a room shows only the round being
 * played. See supabase/migrations/*_watch_rooms.sql for the rules:
 *   - public rooms are open to anyone signed in; private ones need the invite link;
 *   - rivals' lineups show from the round's first tip-off (as saved at the lock);
 *   - the chat is open from an hour before a tip-off to an hour after the game;
 *   - a room stays until its admin closes it, which deletes it and its chat.
 */

export const ROOM_NAME_MAX = 40;
export const MESSAGE_MAX = 500;

// ---------------------------------------------------------------------------- rooms

/** The rooms you run or have a team in, as cards (name, admin, teams, cap, my_teams). */
export const myRooms = () => run(db.rpc('my_rooms'));

/** The official room first, then the busiest public rooms; `search` matches the name. */
export const publicRooms = (search = '') => run(db.rpc('public_rooms', { search: search.trim() || null }));

export const createRoom = (name, visibility) => run(db.rpc('create_room', { name, visibility }));

export const updateRoom = (id, fields) =>
    run(db.from('rooms').update(fields).eq('id', id).select('id, name, visibility').single());

/** Closing a room deletes it for everyone, with its chat. Teams are kept. */
export const closeRoom = (id) => run(db.from('rooms').delete().eq('id', id));

/** The room's board for the latest round that has started, plus its chat hours. */
export const roomBoard = (id) => run(db.rpc('room_board', { rid: id }));

/** What a private room's invite shows before joining, or null for a dead link. */
export const roomPreview = (code) => run(db.rpc('room_preview', { code }));

/** Bring teams into a room: a public one by its id, a private one with its code. */
export const joinRoom = ({ id = null, code = null, teamIds }) =>
    run(db.rpc('join_room', { rid: id, code, team_ids: teamIds }));

export const resetInvite = (id) => run(db.rpc('reset_invite', { lid: id }));

/** Leaving (your own team) and removing (the admin, anyone's) are the same row going. */
export const removeFromRoom = (roomId, teamId) =>
    run(db.from('room_teams').delete().eq('room_id', roomId).eq('team_id', teamId));

export const roomLink = (code) => `${window.location.origin}/?room=${encodeURIComponent(code)}`;

// ----------------------------------------------------------------------------- chat

const MESSAGE_COLUMNS = 'id, room_id, author, nickname, body, created_at';

/** The latest `limit` messages, oldest first. */
export async function listMessages(roomId, limit = 100) {
    const rows = await run(db.from('room_messages').select(MESSAGE_COLUMNS)
        .eq('room_id', roomId).order('created_at', { ascending: false }).limit(limit));
    return (rows ?? []).reverse();
}

export const postMessage = (roomId, body) => run(db.rpc('post_message', { rid: roomId, body }));

export const deleteMessage = (id) => run(db.from('room_messages').delete().eq('id', id));

/** Whether the chat is open at `now` (ms), from room_board's `chat` window. */
export function chatState(chat, now) {
    if (!chat) return { open: false, opensAt: null, closesAt: null };
    const opensAt = Date.parse(chat.opens_at);
    const closesAt = Date.parse(chat.closes_at);
    return { open: now >= opensAt && now < closesAt, opensAt, closesAt };
}

// ------------------------------------------------------------------------- realtime

let realtime = null;

/**
 * The one realtime connection, loaded on first use so the chat's client costs nothing
 * to anyone who never opens a room. It carries the signed-in user's token, which is
 * what row-level security checks before handing over a message.
 */
export async function getRealtime() {
    if (!auth) return null;
    if (!realtime) {
        const { RealtimeClient } = await import('@supabase/realtime-js');
        realtime = new RealtimeClient(`${import.meta.env.VITE_SUPABASE_URL}/realtime/v1`, {
            params: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        });
        const { data } = await auth.getSession();
        realtime.setAuth(data?.session?.access_token ?? null);
        auth.onAuthStateChange((_event, session) => realtime.setAuth(session?.access_token ?? null));
    }
    return realtime;
}

// -------------------------------------------------------------------------- invites

// An invite opened signed out survives the sign-in: Google sends you back to the bare
// origin (lib/auth.js), which would drop ?room=, so the code waits here meanwhile.
const PENDING_KEY = 'euroguru.pendingRoom';
const validCode = (code) => (code && /^[0-9a-f]{6,16}$/i.test(code) ? code : null);

/** The room invite this visit is about - from ?room=, or one awaiting sign-in - or null. */
export function readRoomCode(search = window.location.search) {
    const fromUrl = validCode(new URLSearchParams(search).get('room'));
    try {
        if (fromUrl) window.sessionStorage.setItem(PENDING_KEY, fromUrl);
        return fromUrl ?? validCode(window.sessionStorage.getItem(PENDING_KEY));
    } catch {
        return fromUrl;
    }
}

/** The invite code in what someone pasted: a whole invite link, or the code alone. Null if neither. */
export function parseRoomCode(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return null;
    try {
        const code = new URL(raw).searchParams.get('room');
        if (code) return validCode(code);
    } catch { /* not a link - maybe the code itself */ }
    return validCode(raw.replace(/^.*[?&]room=/, '').replace(/[&#].*$/, ''));
}

/** Forget the invite - joined or dismissed - and drop ?room= from the address bar. */
export function clearRoomCode() {
    try {
        window.sessionStorage.removeItem(PENDING_KEY);
    } catch { /* nothing was kept */ }
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
