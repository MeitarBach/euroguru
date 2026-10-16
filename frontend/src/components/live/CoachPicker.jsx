import React, { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { coachKey } from '../../lib/live/rows';
import { whenLabel } from '../../lib/live/format';

/** Where a club's game stands this round: "vs OLY · Thu 20:45", "@ OLY 54–50", "no game". */
function Fixture({ code, games, now }) {
    const game = games.find(g => g.homeCode === code || g.awayCode === code);
    if (!game) return <span className="text-gray-600">no game this round</span>;
    const home = game.homeCode === code;
    const opp = home ? game.awayCode : game.homeCode;
    const where = `${home ? 'vs' : '@'} ${opp}`;
    if (game.status === 'scheduled') return <span>{where} · {whenLabel(game.tipoff, now)}</span>;
    const mine = home ? game.scoreHome : game.scoreAway;
    const theirs = home ? game.scoreAway : game.scoreHome;
    return (
        <span className={game.status === 'live' ? 'text-red-300' : ''}>
            {where} {mine}–{theirs}{game.status === 'final' ? ' F' : ''}
        </span>
    );
}

/**
 * Choose a group's head coach: every club's coach, with their price and this round's
 * game. Picking the current one again takes them off. Closes on a click elsewhere or
 * Escape.
 */
export default function CoachPicker({ coaches, games, selectedKey, now, onPick, onClose }) {
    const ref = useRef(null);

    useEffect(() => {
        const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        // Deferred so the click that opened the picker does not also close it.
        const id = setTimeout(() => document.addEventListener('pointerdown', onDown), 0);
        window.addEventListener('keydown', onKey);
        return () => {
            clearTimeout(id);
            document.removeEventListener('pointerdown', onDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [onClose]);

    // By the club code shown beside each coach, so the list reads in order.
    const code = (c) => String(c.TeamCode ?? c.Team);
    const sorted = [...coaches].sort((a, b) => code(a).localeCompare(code(b)));

    return (
        <div
            ref={ref}
            className="absolute left-0 right-0 sm:right-auto sm:w-96 top-full mt-1 z-40 rounded-xl border border-white/10 bg-[#141418] shadow-2xl p-1.5 text-sm"
        >
            <div className="px-2 pt-1 pb-1.5 text-[11px] text-gray-500">
                A coach scores on the club's margin: +10 / +20 / +25 for a win by 1–10 / 11–20 / 21+,
                −5 / −10 / −20 for a loss.
            </div>
            {sorted.length === 0 && <p className="px-2 py-3 text-gray-500">Coaches are not loaded yet.</p>}
            <ul className="max-h-80 overflow-y-auto">
                {sorted.map(coach => {
                    const key = coachKey(coach);
                    const on = key === selectedKey;
                    return (
                        <li key={key}>
                            <button
                                type="button"
                                onClick={() => onPick(key)}
                                aria-pressed={on}
                                className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left
                                    ${on ? 'bg-purple-500/15' : 'hover:bg-white/[0.06]'}`}
                            >
                                <span className="w-9 shrink-0 font-mono text-[11px] text-gray-500">{code(coach)}</span>
                                <span className="min-w-0 flex-1">
                                    <span className={`block truncate ${on ? 'text-white font-medium' : 'text-gray-200'}`}>{coach.CoachName}</span>
                                    <span className="block text-[11px] text-gray-500 truncate">
                                        <Fixture code={coach.TeamCode} games={games} now={now} />
                                    </span>
                                </span>
                                {coach.CR !== null && <span className="font-mono text-[11px] text-gray-500 shrink-0">{coach.CR} CR</span>}
                                {on && <Check size={15} className="text-purple-300 shrink-0" />}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
