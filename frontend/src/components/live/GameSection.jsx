import React, { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import WatchCard from './WatchCard';
import AddToGroupsMenu from './AddToGroupsMenu';
import { GameStatus } from './GameStrip';
import { gameRows } from '../../lib/live/rows';

const titleCase = (name) => String(name ?? '').toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());

/**
 * One game in the main column, laid out like a group: a header, then a section of cards
 * per team - the live box score as the Live tab's own cards. Tapping a player opens a
 * menu to put them in any of your groups.
 */
export default function GameSection({
    game, roster, groups, groupsOf, history, lastEventOf, now, watch, onOpenPlayer, onBack,
}) {
    const [menuKey, setMenuKey] = useState(null);
    const teams = useMemo(() => gameRows(game, roster), [game, roster]);

    const card = (row) => (
        <WatchCard
            key={row.key}
            row={row}
            history={history[row.key]}
            lastEvent={lastEventOf(row.key)}
            now={now}
            alsoIn={row.priced ? groupsOf(row.key) : []}
            onSelect={() => setMenuKey(k => (k === row.key ? null : row.key))}
            menu={menuKey === row.key && (
                <AddToGroupsMenu
                    player={row.player}
                    groups={groups}
                    onToggle={watch.toggle}
                    onCreate={(name) => watch.create(name, [row.key])}
                    onDetails={() => { setMenuKey(null); onOpenPlayer(row.player.PlayerName); }}
                    onClose={() => setMenuKey(null)}
                />
            )}
        />
    );

    return (
        <section className="xl:col-span-2 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        type="button"
                        onClick={onBack}
                        aria-label="Back to your groups"
                        className="p-1.5 -ml-1 rounded-md text-gray-400 hover:text-white hover:bg-white/5 shrink-0"
                    >
                        <ArrowLeft size={16} />
                    </button>
                    <h3 className="text-base font-semibold text-white truncate">
                        {game.homeCode}
                        {game.status !== 'scheduled' && <span className="font-mono mx-1.5">{game.scoreHome}–{game.scoreAway}</span>}
                        {game.status === 'scheduled' && <span className="text-gray-500 font-normal mx-1.5">vs</span>}
                        {game.awayCode}
                    </h3>
                    <span className="text-xs shrink-0"><GameStatus game={game} now={now} /></span>
                </div>
                <span className="text-[11px] text-gray-500 shrink-0 hidden sm:block">Tap a player to add them to a group</span>
            </div>

            {game.status !== 'scheduled' && !game.lines && (
                <p className="px-1 text-sm text-amber-300">Reading the box score…</p>
            )}

            {teams.map(team => (
                <div key={team.code} className="space-y-2">
                    <div className="flex items-baseline justify-between px-1 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                        <span className="truncate">
                            {team.code}
                            <span className="normal-case tracking-normal font-normal text-gray-600"> · {titleCase(team.name)}</span>
                        </span>
                        {game.status !== 'scheduled' && (
                            <span className="font-mono normal-case tracking-normal text-gray-300">{team.score}</span>
                        )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2">
                        {team.rows.map(card)}
                    </div>
                    {team.missing.length > 0 && (
                        <>
                            <div className="px-1 pt-1 text-[10px] uppercase tracking-wider text-gray-600 font-semibold">
                                {team.code} · not in tonight's squad
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2">
                                {team.missing.map(card)}
                            </div>
                        </>
                    )}
                </div>
            ))}
        </section>
    );
}
