import { useCallback, useEffect, useRef, useState } from 'react';
import { listMessages, postMessage, deleteMessage, getRealtime, MESSAGE_MAX } from '../lib/rooms';

// Messages kept on screen; older ones scroll away.
const KEEP = 200;
// If the realtime connection cannot be made, read the chat this often instead.
const FALLBACK_POLL_MS = 10_000;

const byTime = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id);

/**
 * A room's chat: the latest messages, new ones as they are posted (Supabase Realtime,
 * filtered by row-level security to rooms you can read), and send / delete.
 *
 * `roomId` null means no room is open. Posting is the database's call - it refuses
 * outside the chat hours, from a non-member, or faster than one message per 2s - so
 * `send` resolves to false and reports the reason through `notify`.
 */
export default function useRoomChat(roomId, { notify } = {}) {
    const [state, setState] = useState({ roomId: null, messages: [], status: 'idle' });
    const notifyRef = useRef(notify);
    useEffect(() => { notifyRef.current = notify; }, [notify]);

    const merge = useCallback((rid, incoming) => setState(prev => {
        if (prev.roomId !== rid) return prev;
        const seen = new Map(prev.messages.map(m => [m.id, m]));
        for (const m of incoming) seen.set(m.id, m);
        return { ...prev, messages: [...seen.values()].sort(byTime).slice(-KEEP) };
    }), []);
    const drop = useCallback((id) => setState(prev => ({ ...prev, messages: prev.messages.filter(m => m.id !== id) })), []);

    useEffect(() => {
        if (!roomId) return undefined;
        let alive = true;
        let channel = null;
        let poll = null;
        // Until the first load lands, the previous room's state is hidden by `current`.

        const load = () => listMessages(roomId)
            .then(rows => { if (alive) setState({ roomId, messages: rows, status: 'ready' }); })
            .catch(() => { if (alive) setState(prev => ({ ...prev, status: 'error' })); });
        const startPolling = () => {
            if (!poll && alive) poll = setInterval(load, FALLBACK_POLL_MS);
        };

        load();
        getRealtime().then(client => {
            if (!alive || !client) return;
            channel = client.channel(`room-chat:${roomId}`)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_id=eq.${roomId}` },
                    (payload) => merge(roomId, [payload.new]))
                // A delete carries only the id (and cannot be filtered by room), so it
                // simply removes that id if it is on screen.
                .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'room_messages' },
                    (payload) => { if (payload.old?.id != null) drop(payload.old.id); })
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        if (poll) { clearInterval(poll); poll = null; }
                        load(); // whatever arrived while connecting
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        startPolling();
                    }
                });
        }).catch(startPolling);

        return () => {
            alive = false;
            if (poll) clearInterval(poll);
            if (channel) channel.unsubscribe();
        };
    }, [roomId, merge, drop]);

    const send = useCallback(async (body) => {
        const text = String(body ?? '').trim().slice(0, MESSAGE_MAX);
        if (!text || !roomId) return false;
        try {
            const row = await postMessage(roomId, text);
            merge(roomId, [row]);
            return true;
        } catch (e) {
            notifyRef.current?.(e.message);
            return false;
        }
    }, [roomId, merge]);

    const remove = useCallback(async (id) => {
        try {
            await deleteMessage(id);
            drop(id);
            return true;
        } catch (e) {
            notifyRef.current?.(`Couldn't delete: ${e.message}`);
            return false;
        }
    }, [drop]);

    const current = state.roomId === roomId;
    return {
        messages: current ? state.messages : [],
        status: current ? state.status : 'loading',
        send,
        remove,
    };
}
