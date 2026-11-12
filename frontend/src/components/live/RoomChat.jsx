import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, Trash2 } from 'lucide-react';
import useRoomChat from '../../hooks/useRoomChat';
import { MESSAGE_MAX } from '../../lib/rooms';

const time = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * A Watch Room's chat, open any time. Members post; a public room's visitors read along
 * until they bring a team. The room's admin can delete anyone's message, everyone their
 * own.
 */
export default function RoomChat({ board, userId, notify, onJoin }) {
    const chat = useRoomChat(board.id, { notify });
    const canPost = board.is_member || board.is_admin;
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const listRef = useRef(null);
    const stuck = useRef(true); // following the newest message, unless scrolled up

    useEffect(() => {
        const el = listRef.current;
        if (el && stuck.current) el.scrollTop = el.scrollHeight;
    }, [chat.messages]);

    const submit = async (e) => {
        e.preventDefault();
        if (busy || !draft.trim()) return;
        setBusy(true);
        if (await chat.send(draft)) setDraft('');
        setBusy(false);
    };

    return (
        <div className="glass-panel flex flex-col">
            <div className="px-4 pt-3 pb-2 border-b border-white/5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                    <MessageCircle size={15} className="text-purple-300" /> Chat
                </h3>
            </div>

            <div
                ref={listRef}
                onScroll={(e) => {
                    const el = e.currentTarget;
                    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                }}
                className="h-72 overflow-y-auto px-4 py-3 space-y-2"
            >
                {chat.status === 'loading' && <p className="text-xs text-gray-500">Loading…</p>}
                {chat.status === 'error' && <p className="text-xs text-gray-500">Couldn't load the chat.</p>}
                {chat.status === 'ready' && !chat.messages.length && (
                    <p className="text-xs text-gray-500">Nobody has said anything yet. Go first.</p>
                )}
                {chat.messages.map(m => {
                    const mine = m.author === userId;
                    return (
                        <div key={m.id} className="group flex items-start gap-2 text-sm">
                            <div className="min-w-0 flex-1">
                                <span className={`font-semibold ${mine ? 'text-purple-300' : 'text-gray-200'}`}>{m.nickname}</span>
                                <span className="ml-1.5 text-[10px] text-gray-600">{time(m.created_at)}</span>
                                <p className="text-gray-300 break-words whitespace-pre-wrap">{m.body}</p>
                            </div>
                            {(mine || board.is_admin) && (
                                <button
                                    type="button"
                                    onClick={() => chat.remove(m.id)}
                                    title="Delete message"
                                    aria-label="Delete message"
                                    className="p-1 rounded text-gray-700 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-300"
                                >
                                    <Trash2 size={12} />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="px-3 pb-3 pt-2 border-t border-white/5">
                {!canPost ? (
                    <button type="button" onClick={onJoin} className="w-full py-2 rounded-lg text-xs text-purple-300 hover:text-purple-200 hover:bg-purple-500/10">
                        Bring a team into this room to chat
                    </button>
                ) : (
                    <form onSubmit={submit} className="flex items-center gap-2">
                        <input
                            value={draft}
                            maxLength={MESSAGE_MAX}
                            onChange={(e) => setDraft(e.target.value)}
                            placeholder="Say something…"
                            className="input-dark flex-1 min-w-0 py-2 text-sm"
                        />
                        <button
                            type="submit"
                            disabled={busy || !draft.trim()}
                            aria-label="Send"
                            className="p-2 rounded-lg text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-40"
                        >
                            <Send size={15} />
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
