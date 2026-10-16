import React, { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import AddToGroupsMenu from './AddToGroupsMenu';
import LiveDot from './LiveDot';
import { GameStatus } from './GameStrip';
import { gameRows } from '../../lib/live/rows';
import { decimalsFor, marginText } from '../../lib/live/format';

const titleCase = (name) => String(name ?? '').toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());
const fixed = (x) => x.toFixed(decimalsFor(x));
const pair = (made, attempted) => `${made}/${attempted}`;

// How long a row stays lit after its player's line changes.
const FLASH_MS = 4000;

// The box score's columns after the player: [label, title, cell(line), total(lines)].
// Every stat the fantasy score is built from, plus +/- because a box score has it.
// A fixed table layout with fixed stat widths, so the spare room goes to the player
// column and both teams' tables line up column for column. Narrower than the minimum,
// the table scrolls under the pinned player column.
const sum = (stat) => (lines) => lines.reduce((s, l) => s + l[stat], 0);
const sumPair = (made, attempted) => (lines) => pair(sum(made)(lines), sum(attempted)(lines));
const COLUMNS = [
    ['MIN', 'Minutes', l => l.min, () => ''],
    ['PTS', 'Points', l => l.pts, sum('pts')],
    ['2P', 'Two-pointers made/attempted', l => pair(l.fgm2, l.fga2), sumPair('fgm2', 'fga2')],
    ['3P', 'Three-pointers made/attempted', l => pair(l.fgm3, l.fga3), sumPair('fgm3', 'fga3')],
    ['FT', 'Free throws made/attempted', l => pair(l.ftm, l.fta), sumPair('ftm', 'fta')],
    ['OR', 'Offensive rebounds', l => l.oreb, sum('oreb')],
    ['DR', 'Defensive rebounds', l => l.dreb, sum('dreb')],
    ['REB', 'Rebounds', l => l.reb, sum('reb')],
    ['AST', 'Assists', l => l.ast, sum('ast')],
    ['STL', 'Steals', l => l.stl, sum('stl')],
    ['BLK', 'Blocks', l => l.blk, sum('blk')],
    ['BLKA', 'Shots blocked by an opponent', l => l.blka, sum('blka')],
    ['TO', 'Turnovers', l => l.tov, sum('tov')],
    ['PF', 'Fouls committed', l => l.pf, sum('pf')],
    ['FD', 'Fouls drawn', l => l.fd, sum('fd')],
    ['+/-', 'Plus-minus', l => (l.pm > 0 ? `+${l.pm}` : l.pm), () => ''],
    ['PIR', 'Performance index rating', l => l.pir, sum('pir')],
];

// Columns holding "12/15" or "38:20" (or a long header) need more room than a count.
const WIDE = new Set(['MIN', '2P', '3P', 'FT', 'BLKA']);

// The player column stays put while the rest scrolls under it, so its background is
// opaque - the page's own colour, or the row's tint mixed onto it.
const STICKY = 'sticky left-0 z-10 bg-[#08080a]';
// FPT, the number that matters, is pinned to the other edge the same way.
const STICKY_END = 'sticky right-0 z-10 bg-[#08080a] border-l border-white/5';
const STICKY_ROW = {
    up: 'bg-[#0b1a14]',
    down: 'bg-[#1a0d10]',
    open: 'bg-[#141417]',
    rest: 'bg-[#08080a] group-hover:bg-[#101013]',
};

const foulTone = (pf) => (pf >= 5 ? 'text-red-400' : pf >= 4 ? 'text-amber-300' : '');

/** Box order: whoever played before whoever did not, starters first, then as the feed lists them. */
function boxOrder(rows, lines) {
    const index = new Map((lines ?? []).map((l, i) => [l.id, i]));
    const rank = (r) => [r.line?.dnp ? 1 : 0, r.line?.starter ? 0 : 1, index.get(r.line?.id) ?? Infinity];
    return [...rows].sort((a, b) => {
        const [x, y] = [rank(a), rank(b)];
        return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
}

function PlayerCell({ row, alsoIn }) {
    const { player, line, game } = row;
    return (
        <span className="flex items-center gap-1.5 min-w-0">
            {game.status === 'live' && line && !line.dnp && (line.onCourt
                ? <span title="On the court"><LiveDot color="green" /></span>
                : <span title="Off the court" className="h-2 w-2 rounded-full bg-gray-700 shrink-0" />)}
            <span className={`truncate ${line?.starter ? 'text-white font-medium' : 'text-gray-200'}`}>{player.PlayerName}</span>
            {alsoIn.map(g => (
                <span key={g.id} title={`In ${g.name}`} className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: g.colorHex }} />
            ))}
        </span>
    );
}

/** One team's box score: a row per player, then the team's totals. */
function BoxTable({ team, game, groupsOf, lastEventOf, now, openKey, onPick }) {
    const rows = boxOrder(team.rows, game.lines);
    const played = rows.filter(r => r.line && !r.line.dnp).map(r => r.line);
    return (
        <div className="overflow-x-auto rounded-xl border border-white/5 bg-[#ffffff03]">
            <table className="w-full min-w-[59rem] table-fixed text-xs font-mono tabular-nums whitespace-nowrap">
                <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-white/5">
                        <th className={`${STICKY} text-left font-semibold px-2.5 py-2`}>
                            <span className="inline-block w-5 text-gray-600">#</span>Player
                        </th>
                        {COLUMNS.map(([label, title]) => (
                            <th key={label} title={title} className={`px-1.5 py-2 text-right font-semibold ${WIDE.has(label) ? 'w-[3.25rem]' : 'w-9'}`}>{label}</th>
                        ))}
                        <th title="Fantasy points: PIR, plus the win bonus once the game is final" className={`${STICKY_END} w-14 px-2.5 py-2 text-right font-semibold text-purple-300`}>FPT</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => {
                        const { line } = row;
                        const unpriced = row.priced === false;
                        const event = lastEventOf(row.key);
                        const flash = event && now - event.at < FLASH_MS;
                        const open = openKey === row.key;
                        const tint = flash ? (event.delta >= 0 ? 'up' : 'down') : open ? 'open' : 'rest';
                        return (
                            <tr
                                key={row.key}
                                onClick={unpriced ? undefined : (e) => onPick(row, e)}
                                title={unpriced ? 'Not in the fantasy game' : 'Add to a group'}
                                className={`group border-b border-white/[0.03] last:border-0 transition-colors duration-700
                                    ${unpriced ? 'opacity-45' : 'cursor-pointer'}
                                    ${flash ? (event.delta >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10') : open ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'}`}
                            >
                                <td className={`sticky left-0 z-10 transition-colors duration-700 ${STICKY_ROW[tint]} px-2.5 py-1.5 font-sans overflow-hidden`}>
                                    <span className="flex items-center">
                                        <span className="w-5 shrink-0 font-mono text-gray-600">{line?.number}</span>
                                        <PlayerCell row={row} alsoIn={unpriced ? [] : groupsOf(row.key)} />
                                    </span>
                                </td>
                                {line && !line.dnp ? COLUMNS.map(([label, , cell]) => (
                                    <td
                                        key={label}
                                        className={`px-1.5 py-1.5 text-right ${label === 'PF' ? foulTone(line.pf) : ''}
                                            ${label === 'PIR' ? 'text-gray-200' : 'text-gray-400'}`}
                                    >
                                        {cell(line)}
                                    </td>
                                )) : (
                                    <td colSpan={COLUMNS.length} className="px-2 py-1.5 text-left font-sans text-gray-600">
                                        {row.state === 'idle' ? 'Yet to check in' : 'Did not play'}
                                    </td>
                                )}
                                <td className={`sticky right-0 z-10 border-l border-white/5 transition-colors duration-700 ${STICKY_ROW[tint]}
                                    px-2.5 py-1.5 text-right font-semibold ${
                                    row.score === null ? 'text-gray-700' : row.score < 0 ? 'text-red-300' : 'text-white'}`}
                                >
                                    {row.score === null ? '–' : fixed(row.score)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
                {played.length > 0 && (
                    <tfoot>
                        <tr className="border-t border-white/10 text-gray-300">
                            <td className={`${STICKY} px-2.5 py-1.5 font-sans text-[10px] uppercase tracking-wider text-gray-500 font-semibold`}>
                                <span className="inline-block w-5" />Team
                            </td>
                            {COLUMNS.map(([label, , , total]) => (
                                <td key={label} className="px-1.5 py-1.5 text-right">{total(played)}</td>
                            ))}
                            <td className={STICKY_END} />
                        </tr>
                    </tfoot>
                )}
            </table>
        </div>
    );
}

/** Before tip-off there is no box score yet: the priced roster, by season average. */
function RosterTable({ team, groupsOf, openKey, onPick }) {
    const rows = [...team.rows, ...team.missing]
        .filter(r => r.priced)
        .sort((a, b) => (b.avg ?? -Infinity) - (a.avg ?? -Infinity));
    return (
        <div className="overflow-x-auto rounded-xl border border-white/5 bg-[#ffffff03]">
            <table className="w-full table-fixed text-xs whitespace-nowrap">
                <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-white/5">
                        <th className="text-left font-semibold px-2.5 py-2">Player</th>
                        <th className="w-14 px-2 py-2 text-right font-semibold">Pos</th>
                        <th className="w-16 px-2 py-2 text-right font-semibold">CR</th>
                        <th className="w-20 px-2.5 py-2 text-right font-semibold text-purple-300">Avg FPT</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => (
                        <tr
                            key={row.key}
                            onClick={(e) => onPick(row, e)}
                            className={`cursor-pointer border-b border-white/[0.03] last:border-0 ${
                                openKey === row.key ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'}`}
                        >
                            <td className="px-2.5 py-1.5"><PlayerCell row={row} alsoIn={groupsOf(row.key)} /></td>
                            <td className="px-2 py-1.5 text-right text-gray-400">{row.player.position}</td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-gray-400">{row.player.CR}</td>
                            <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-white">
                                {row.avg === null ? '–' : row.avg.toFixed(1)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** The club's head coach under its box score: their value as the margin stands, one tap to add. */
function CoachLine({ coach, open, onPick }) {
    const playing = coach.state === 'live' || coach.state === 'final';
    return (
        <button
            type="button"
            onClick={(e) => onPick(coach, e)}
            className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-xs border transition-colors
                ${open ? 'bg-white/[0.06] border-white/10' : 'border-white/5 hover:bg-white/[0.04]'}`}
        >
            <span className="flex items-center gap-2 min-w-0">
                <span className="text-[9px] px-1 rounded bg-purple-500/15 text-purple-200 shrink-0">COACH</span>
                <span className="text-gray-200 truncate">{coach.player.PlayerName}</span>
                {coach.player.CR && <span className="text-gray-600 font-mono shrink-0">{coach.player.CR} CR</span>}
            </span>
            <span className="flex items-center gap-2 shrink-0">
                {playing && <span className="text-gray-500">{marginText(coach.margin, coach.state === 'final')}</span>}
                <span className={`font-mono font-semibold ${
                    !playing ? 'text-gray-700' : coach.score > 0 ? 'text-emerald-300' : coach.score < 0 ? 'text-red-300' : 'text-white'}`}
                >
                    {playing ? `${coach.score > 0 ? '+' : ''}${coach.score}` : '–'}
                </span>
            </span>
        </button>
    );
}

/**
 * One game in the main column, as a box score: a table per team with every stat the
 * fantasy score is made of, then the team's coach. Tapping a player (or the coach)
 * opens a menu to put them in any of your groups.
 */
export default function GameSection({
    game, roster, coaches, groups, groupsOf, lastEventOf, now, watch, onOpenPlayer, onBack,
}) {
    // The open menu: who it is for and where, measured from the team block it sits in -
    // inside the table's scroll box it would be clipped.
    const [menu, setMenu] = useState(null);
    const teams = useMemo(() => gameRows(game, roster, coaches), [game, roster, coaches]);
    const boxed = Boolean(game.lines) && game.status !== 'scheduled';

    const pick = (row, event) => {
        if (menu?.key === row.key) return setMenu(null);
        const anchor = event.currentTarget.getBoundingClientRect();
        const block = event.currentTarget.closest('[data-team]').getBoundingClientRect();
        return setMenu({ key: row.key, row, team: event.currentTarget.closest('[data-team]').dataset.team, top: anchor.bottom - block.top + 4 });
    };
    const close = () => setMenu(null);

    const menuFor = (row) => (row.isCoach ? (
        <AddToGroupsMenu
            who={row.player.PlayerName}
            groups={groups}
            isIn={(g) => g.coach === row.key}
            onToggle={(id) => watch.toggleCoach(id, row.key)}
            onCreate={(name) => watch.create(name, [], { coach: row.key })}
            onClose={close}
            className="left-2 w-72 max-w-[calc(100%-16px)]"
            style={{ top: menu.top }}
        />
    ) : (
        <AddToGroupsMenu
            who={row.player.PlayerName}
            groups={groups}
            isIn={(g) => g.keys.includes(row.key)}
            onToggle={(id) => watch.toggle(id, row.key)}
            onCreate={(name) => watch.create(name, [row.key])}
            onDetails={() => { close(); onOpenPlayer(row.player.PlayerName); }}
            onClose={close}
            className="left-2 w-72 max-w-[calc(100%-16px)]"
            style={{ top: menu.top }}
        />
    ));

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
                <div key={team.code} data-team={team.code} className="relative space-y-2">
                    <div className="flex items-baseline justify-between px-1 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                        <span className="truncate">
                            {team.code}
                            <span className="normal-case tracking-normal font-normal text-gray-600"> · {titleCase(team.name)}</span>
                        </span>
                        {game.status !== 'scheduled' && (
                            <span className="font-mono normal-case tracking-normal text-gray-300">{team.score}</span>
                        )}
                    </div>
                    {boxed ? (
                        <BoxTable
                            team={team}
                            game={game}
                            groupsOf={groupsOf}
                            lastEventOf={lastEventOf}
                            now={now}
                            openKey={menu?.key}
                            onPick={pick}
                        />
                    ) : (
                        <RosterTable team={team} groupsOf={groupsOf} openKey={menu?.key} onPick={pick} />
                    )}
                    {boxed && team.missing.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-gray-600">
                            <span className="uppercase tracking-wider font-semibold text-[10px]">Not in tonight's squad:</span>
                            {team.missing.map(row => (
                                <button
                                    key={row.key}
                                    type="button"
                                    onClick={(e) => pick(row, e)}
                                    className="px-1.5 py-0.5 rounded text-gray-400 hover:text-white hover:bg-white/5"
                                >
                                    {row.player.PlayerName}
                                </button>
                            ))}
                        </div>
                    )}
                    {team.coach && <CoachLine coach={team.coach} open={menu?.key === team.coach.key} onPick={pick} />}
                    {menu?.team === team.code && menuFor(menu.row)}
                </div>
            ))}
        </section>
    );
}
