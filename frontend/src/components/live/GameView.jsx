import React, { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import AnimatedNumber from './AnimatedNumber';
import LiveDot from './LiveDot';
import { GameStatus } from './GameStrip';
import { scoreOf } from '../../lib/live/rows';
import { euroleagueCode } from '../../lib/live/teams';
import { decimalsFor } from '../../lib/live/format';

/** "PANATHINAIKOS AKTOR ATHENS" -> "Panathinaikos Aktor Athens". */
const titleCase = (name) => String(name ?? '').toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());

/** The boxscore's "KALAITZAKIS, PANAGIOTIS" as "P. Kalaitzakis", for players not priced. */
function shortName(name) {
    const [last, first] = String(name ?? '').split(',').map(s => s.trim());
    return first ? `${first.charAt(0)}. ${titleCase(last)}` : titleCase(last);
}

const byAverage = (a, b) =>
    ((b.Average_Score ?? -Infinity) - (a.Average_Score ?? -Infinity)) || ((b.CR ?? 0) - (a.CR ?? 0));

/** Non-zero counting stats, then minutes and (when they matter) fouls. */
function statText(line) {
    const parts = [['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'], ['tov', 'TO']]
        .filter(([stat]) => line[stat])
        .map(([stat, label]) => `${line[stat]} ${label}`);
    return [parts.join(' ') || '0 PTS', line.min, line.pf >= 3 ? `${line.pf} PF` : null].filter(Boolean).join(' · ');
}

/**
 * One round button per group, in the group's colour: filled when the player is in it.
 * Tapping adds or removes - the free limit is enforced by the toggle itself.
 */
function GroupToggles({ playerKey, playerName, groups, onToggle }) {
    return (
        <span className="flex items-center gap-1 shrink-0">
            {groups.map(g => {
                const on = g.keys.includes(playerKey);
                return (
                    <button
                        key={g.id}
                        type="button"
                        onClick={() => onToggle(g.id, playerKey)}
                        aria-pressed={on}
                        aria-label={`${on ? 'Remove' : 'Add'} ${playerName} ${on ? 'from' : 'to'} ${g.name}`}
                        title={`${on ? 'In' : 'Add to'} ${g.name}`}
                        className="w-7 h-7 sm:w-6 sm:h-6 rounded-full text-[10px] font-bold flex items-center justify-center border transition-colors"
                        style={on
                            ? { background: g.colorHex, borderColor: g.colorHex, color: '#0b0b0d' }
                            : { borderColor: `${g.colorHex}66`, color: g.colorHex }}
                    >
                        {g.name.trim().charAt(0).toUpperCase() || '•'}
                    </button>
                );
            })}
        </span>
    );
}

function PlayerRow({ name, position, injury, live, onCourt, detail, score, muted, toggles, onOpen }) {
    return (
        <div className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg ${muted ? 'opacity-50' : 'hover:bg-white/[0.03]'}`}>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                    {live && (onCourt
                        ? <span title="On the court"><LiveDot color="green" /></span>
                        : <span title="Off the court" className="h-2 w-2 rounded-full bg-gray-700 shrink-0" />)}
                    {onOpen ? (
                        <button type="button" onClick={onOpen} className="text-sm font-medium text-white truncate hover:text-purple-200">
                            {name}
                        </button>
                    ) : (
                        <span className="text-sm text-gray-300 truncate">{name}</span>
                    )}
                    {position && <span className="text-[11px] text-gray-500 shrink-0">{position}</span>}
                    {injury && <span className="text-[9px] px-1 rounded bg-red-500/15 text-red-300 shrink-0">{injury}</span>}
                </div>
                <div className="text-[11px] text-gray-500 truncate">{detail}</div>
            </div>
            <span className="w-12 text-right shrink-0">
                {score !== null && score !== undefined ? (
                    <AnimatedNumber
                        value={score}
                        decimals={decimalsFor(score)}
                        className={`text-base font-bold font-mono ${score < 0 ? 'text-red-300' : 'text-white'}`}
                    />
                ) : (
                    <span className="text-base font-mono text-gray-700">–</span>
                )}
            </span>
            {toggles}
        </div>
    );
}

const injuryOf = (player) => (player?.InjuryStatus
    ? (String(player.InjuryStatus).toUpperCase().startsWith('OUT') ? 'OUT' : 'GTD')
    : null);

/**
 * One game, everyone in it: what each player is doing right now and what it is worth,
 * with a tap to put any of them in any of your groups.
 *
 * Before tip-off it is the two priced squads by season average. Once the boxscore
 * exists it is the whole box score - players the fantasy game does not price stay
 * listed, greyed - plus any priced player missing from tonight's squad.
 */
export default function GameView({ game, roster, groups, watch, now, onClose, onOpenPlayer }) {
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const rosterByKey = useMemo(() => new Map(roster.map(p => [p.PlayerKey, p])), [roster]);
    const squads = useMemo(() => {
        const map = new Map([[game.homeCode, []], [game.awayCode, []]]);
        for (const player of roster) map.get(euroleagueCode(player))?.push(player);
        for (const list of map.values()) list.sort(byAverage);
        return map;
    }, [roster, game.homeCode, game.awayCode]);

    // The engine matches lines to priced players (byKey); turned around, it says which
    // line belongs to whom.
    const keyOfLine = useMemo(() => {
        const map = new Map();
        for (const [key, line] of Object.entries(game.byKey ?? {})) map.set(line.id, key);
        return map;
    }, [game.byKey]);

    const started = game.status !== 'scheduled' && Array.isArray(game.lines);
    const live = game.status === 'live';
    const toggle = (groupId, key) => watch.toggle(groupId, key);

    const teams = [game.homeCode, game.awayCode].map(code => {
        const name = code === game.homeCode ? game.homeName : game.awayName;
        const score = code === game.homeCode ? game.scoreHome : game.scoreAway;
        if (!started) return { code, name, score, rows: squads.get(code) ?? [], missing: [] };

        const lines = game.lines
            .filter(l => l.code === code)
            .map(line => {
                const key = keyOfLine.get(line.id) ?? null;
                return { line, key, player: key ? rosterByKey.get(key) : null, score: line.dnp ? null : scoreOf(line, game, code) };
            })
            .sort((a, b) => (a.line.dnp - b.line.dnp) || ((b.score ?? -Infinity) - (a.score ?? -Infinity)));
        const present = new Set(lines.map(r => r.key).filter(Boolean));
        const missing = (squads.get(code) ?? []).filter(p => !present.has(p.PlayerKey));
        return { code, name, score, rows: lines, missing };
    });

    const toggles = (player) => (
        <GroupToggles playerKey={player.PlayerKey} playerName={player.PlayerName} groups={groups} onToggle={toggle} />
    );

    return (
        <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-0 sm:p-6"
            onClick={onClose}
        >
            <div
                className="glass-panel w-full max-w-5xl my-0 sm:my-8 rounded-none sm:rounded-xl min-h-screen sm:min-h-0"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-4 sm:p-6 pb-3 border-b border-white/5 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-baseline gap-2 flex-wrap">
                                <span>{game.homeCode}</span>
                                {game.status !== 'scheduled' && (
                                    <span className="font-mono tabular-nums">{game.scoreHome}–{game.scoreAway}</span>
                                )}
                                <span>{game.awayCode}</span>
                                <span className="text-xs font-normal"><GameStatus game={game} now={now} /></span>
                            </h2>
                            <p className="text-xs text-gray-500 truncate">
                                {titleCase(game.homeName)} vs {titleCase(game.awayName)}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-2 -m-1 rounded-lg text-gray-400 hover:text-white hover:bg-[#ffffff08] transition-colors"
                            aria-label="Close"
                        >
                            <X size={18} />
                        </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                        <span>Tap a letter to add a player to that group:</span>
                        {groups.map(g => (
                            <span key={g.id} className="inline-flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full" style={{ background: g.colorHex }} />
                                <span className="text-gray-300">{g.name}</span>
                            </span>
                        ))}
                        {watch.limit && <span className="text-purple-300">· {watch.allKeys.length} of {watch.limit} free</span>}
                        {game.status !== 'scheduled' && !started && <span className="text-amber-300">· reading the box score…</span>}
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x divide-white/5">
                    {teams.map(team => (
                        <section key={team.code} className="min-w-0 pb-4">
                            <div className="sticky top-0 z-10 px-4 sm:px-6 py-2.5 bg-[#0d0d0f]/95 backdrop-blur border-b border-white/5 flex items-baseline justify-between gap-2">
                                <span className="min-w-0">
                                    <span className="font-semibold text-gray-100">{team.code}</span>
                                    <span className="ml-2 text-[11px] text-gray-500 truncate">{titleCase(team.name)}</span>
                                </span>
                                {game.status !== 'scheduled' && <span className="font-mono text-gray-300">{team.score}</span>}
                            </div>
                            <div className="px-2 sm:px-4 pt-2 space-y-0.5">
                                {!started && team.rows.map(player => (
                                    <PlayerRow
                                        key={player.PlayerKey}
                                        name={player.PlayerName}
                                        position={player.position}
                                        injury={injuryOf(player)}
                                        detail={`avg ${player.Average_Score != null ? player.Average_Score.toFixed(1) : '–'} FPT · ${player.CR} CR`}
                                        score={null}
                                        toggles={toggles(player)}
                                        onOpen={() => onOpenPlayer(player.PlayerName)}
                                    />
                                ))}
                                {started && team.rows.map(({ line, player, score }) => (
                                    <PlayerRow
                                        key={line.id || line.name}
                                        name={player ? player.PlayerName : shortName(line.name)}
                                        position={player?.position}
                                        injury={injuryOf(player)}
                                        live={live && !line.dnp}
                                        onCourt={line.onCourt}
                                        detail={line.dnp
                                            ? (live ? 'Yet to check in' : 'Did not play')
                                            : `${statText(line)}${player ? '' : ' · not in fantasy'}`}
                                        score={score}
                                        muted={!player}
                                        toggles={player ? toggles(player) : null}
                                        onOpen={player ? () => onOpenPlayer(player.PlayerName) : undefined}
                                    />
                                ))}
                                {started && team.missing.length > 0 && (
                                    <>
                                        <div className="px-2 pt-3 pb-1 text-[10px] uppercase tracking-wider text-gray-600 font-semibold">
                                            Not in tonight's squad
                                        </div>
                                        {team.missing.map(player => (
                                            <PlayerRow
                                                key={player.PlayerKey}
                                                name={player.PlayerName}
                                                position={player.position}
                                                injury={injuryOf(player)}
                                                detail={`avg ${player.Average_Score != null ? player.Average_Score.toFixed(1) : '–'} FPT · ${player.CR} CR`}
                                                score={null}
                                                toggles={toggles(player)}
                                                onOpen={() => onOpenPlayer(player.PlayerName)}
                                            />
                                        ))}
                                    </>
                                )}
                                {!team.rows.length && !team.missing.length && (
                                    <p className="px-2 py-3 text-sm text-gray-600">No players listed yet.</p>
                                )}
                            </div>
                        </section>
                    ))}
                </div>
            </div>
        </div>
    );
}
