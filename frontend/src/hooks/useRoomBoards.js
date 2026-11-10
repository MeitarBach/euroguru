import { useEffect, useMemo, useState } from 'react';
import { roomBoard } from '../lib/rooms';

// The Live hub's room list shows each room's standing, so it reads every one of your
// rooms' boards - a handful at most; past this many the rest show without one.
const MAX_BOARDS = 10;
const REFRESH_MS = 60_000;

/**
 * room_board for each of `roomIds` (your rooms), refreshed every minute while `active`:
 * { [roomId]: board }. A board that fails to load is left out; the room still lists.
 * The scores themselves come from the live feed, as everywhere - this is who is in each
 * room, the chat hours and, at the lock, everyone's saved lineup.
 */
export default function useRoomBoards(roomIds, { active = true, version = 0 } = {}) {
    const ids = useMemo(() => roomIds.slice(0, MAX_BOARDS), [roomIds]);
    const signature = ids.join('|');
    const [boards, setBoards] = useState({});

    useEffect(() => {
        if (!active || !signature) return undefined;
        let alive = true;
        const wanted = signature.split('|');
        const load = () => Promise.allSettled(wanted.map(id => roomBoard(id)))
            .then(results => {
                if (!alive) return;
                const next = {};
                results.forEach((r, i) => { if (r.status === 'fulfilled' && r.value) next[wanted[i]] = r.value; });
                setBoards(next);
            });
        load();
        const id = setInterval(load, REFRESH_MS);
        return () => { alive = false; clearInterval(id); };
    }, [signature, active, version]);

    // Only the rooms still asked for: one you left drops out at once.
    return useMemo(
        () => Object.fromEntries(ids.filter(id => boards[id]).map(id => [id, boards[id]])),
        [ids, boards],
    );
}
