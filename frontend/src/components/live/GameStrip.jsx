import React from 'react';
import LiveDot from './LiveDot';
import { whenLabel, countdown } from '../../lib/live/format';

const HOUR = 3_600_000;

export function GameStatus({ game, now }) {
    if (game.status === 'live') {
        return (
            <span className="flex items-center gap-1.5 text-red-300 font-semibold">
                <LiveDot /> {[game.period, game.clock].filter(Boolean).join(' · ') || 'Live'}
            </span>
        );
    }
    if (game.status === 'final') return <span className="text-gray-500 font-semibold tracking-wide">FINAL</span>;
    const until = game.tipoff - now;
    if (until <= 0) return <span className="text-amber-300">Starting…</span>;
    return (
        <span className="text-gray-400">
            {whenLabel(game.tipoff, now)}
            {until < 6 * HOUR && <span className="text-gray-600"> · in {countdown(until)}</span>}
        </span>
    );
}

function TeamRow({ code, score, win, show }) {
    return (
        <div className={`flex items-center justify-between ${win ? 'text-white font-semibold' : 'text-gray-400'}`}>
            <span>{code}</span>
            {show && <span className="font-mono tabular-nums">{score}</span>}
        </div>
    );
}

/** The round's games in one scrollable row, grouped by day. A chip opens its game. */
export default function GameStrip({ games, now, onOpen }) {
    return (
        <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 snap-x">
            {games.map((game, i) => {
                const newDay = i === 0
                    || new Date(game.tipoff).toDateString() !== new Date(games[i - 1].tipoff).toDateString();
                const started = game.status !== 'scheduled';
                const homeWin = game.status === 'final' && game.scoreHome > game.scoreAway;
                const awayWin = game.status === 'final' && game.scoreAway > game.scoreHome;
                return (
                    <React.Fragment key={game.code}>
                        {newDay && (
                            <div className="shrink-0 flex items-center">
                                <span className="text-[10px] uppercase tracking-widest text-gray-600 [writing-mode:vertical-rl] rotate-180">
                                    {new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(game.tipoff)}
                                </span>
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={() => onOpen(game)}
                            title="Open this game"
                            className={`shrink-0 snap-start w-[150px] rounded-xl border px-3 py-2.5 text-left text-sm transition-colors
                                ${game.status === 'live'
                                    ? 'border-red-500/40 bg-red-500/[0.06] hover:bg-red-500/10'
                                    : 'border-white/5 bg-[#ffffff05] hover:bg-[#ffffff0a]'}`}
                        >
                            <div className="text-[11px] mb-1.5 truncate"><GameStatus game={game} now={now} /></div>
                            <TeamRow code={game.homeCode} score={game.scoreHome} win={homeWin} show={started} />
                            <TeamRow code={game.awayCode} score={game.scoreAway} win={awayWin} show={started} />
                        </button>
                    </React.Fragment>
                );
            })}
        </div>
    );
}
