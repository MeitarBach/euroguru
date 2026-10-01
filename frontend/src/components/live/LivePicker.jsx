import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Check, Lock } from 'lucide-react';
import { GameStatus } from './GameStrip';
import { euroleagueCode } from '../../lib/live/teams';
import { useAuth } from '../../hooks/authContext';

const fold = (text) => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

const byAverage = (a, b) =>
    ((b.Average_Score ?? -Infinity) - (a.Average_Score ?? -Infinity)) || ((b.CR ?? 0) - (a.CR ?? 0));

/** "PANATHINAIKOS AKTOR ATHENS" -> "Panathinaikos Aktor Athens". */
const titleCase = (name) => String(name ?? '').toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());

function PlayerRow({ player, selected, locked, onToggle, showTeam }) {
    const injury = player.InjuryStatus
        ? (String(player.InjuryStatus).toUpperCase().startsWith('OUT') ? 'OUT' : 'GTD')
        : null;
    return (
        <button
            type="button"
            onClick={() => onToggle(player.PlayerKey)}
            aria-pressed={selected}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-sm border transition-colors
                ${selected
                    ? 'bg-purple-500/15 border-purple-500/40'
                    : 'border-transparent hover:bg-[#ffffff08]'}
                ${locked ? 'opacity-50' : ''}`}
        >
            <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border
                ${selected ? 'bg-purple-500 border-purple-500 text-white' : 'border-white/20 text-transparent'}`}
            >
                {locked ? <Lock size={10} className="text-purple-300" /> : <Check size={11} strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1">
                <span className={`block truncate ${selected ? 'text-white font-medium' : 'text-gray-200'}`}>
                    {player.PlayerName}
                </span>
                <span className="block text-[11px] text-gray-500">
                    {player.position}{showTeam && ` · ${euroleagueCode(player)}`}
                    {injury && <span className="text-red-300"> · {injury}</span>}
                </span>
            </span>
            <span className="text-right shrink-0">
                <span className="block font-mono text-xs text-gray-200 tabular-nums">
                    {player.Average_Score != null ? player.Average_Score.toFixed(1) : '–'}
                </span>
                <span className="block text-[10px] text-gray-600 tabular-nums">{player.CR} CR</span>
            </span>
        </button>
    );
}

function TeamColumn({ code, name, players, isSelected, isLocked, onToggle }) {
    return (
        <div className="min-w-0">
            <div className="px-2.5 pb-1.5 flex items-baseline gap-2">
                <span className="text-sm font-semibold text-gray-200">{code}</span>
                <span className="text-[11px] text-gray-600 truncate">{titleCase(name)}</span>
            </div>
            <div className="space-y-0.5">
                {players.map(p => (
                    <PlayerRow
                        key={p.PlayerKey}
                        player={p}
                        selected={isSelected(p)}
                        locked={isLocked(p)}
                        onToggle={onToggle}
                    />
                ))}
                {!players.length && <p className="px-2.5 text-xs text-gray-600">No priced players.</p>}
            </div>
        </div>
    );
}

/**
 * Choosing whom to follow.
 *
 * Organised the way a game night is: by the round's games, each a pair of squads side
 * by side and ordered by average FPT, so the players worth watching are on top. Search
 * cuts across all of it, and "All teams" reaches players whose game is another day.
 */
export default function LivePicker({ roster, games, focusGame, watch, round, teamNames, now, onClose }) {
    const { user } = useAuth();
    const [query, setQuery] = useState('');
    const [view, setView] = useState('round');
    const searchRef = useRef(null);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        // A phone would throw its keyboard up over the list; a desktop wants to type.
        if (window.matchMedia('(min-width: 768px)').matches) searchRef.current?.focus();
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const squads = useMemo(() => {
        const map = new Map();
        for (const player of roster) {
            const code = euroleagueCode(player);
            if (!code) continue;
            if (!map.has(code)) map.set(code, []);
            map.get(code).push(player);
        }
        for (const list of map.values()) list.sort(byAverage);
        return map;
    }, [roster]);

    const orderedGames = useMemo(() => {
        const rank = { live: 0, scheduled: 1, final: 2 };
        return [...games].sort((a, b) =>
            ((b.code === focusGame?.code) - (a.code === focusGame?.code))
            || (rank[a.status] - rank[b.status])
            || (a.tipoff - b.tipoff));
    }, [games, focusGame]);

    const watching = useMemo(() => new Set(watch.keys), [watch.keys]);
    const isSelected = (p) => watching.has(p.PlayerKey);
    const isLocked = (p) => watch.atLimit && !watching.has(p.PlayerKey);
    const byKey = useMemo(() => new Map(roster.map(p => [p.PlayerKey, p])), [roster]);

    const results = useMemo(() => {
        const q = fold(query.trim());
        if (!q) return null;
        return roster
            .filter(p => fold(p.PlayerName).includes(q) || fold(euroleagueCode(p)) === q || fold(p.Team) === q)
            .sort(byAverage)
            .slice(0, 60);
    }, [query, roster]);

    const allTeams = useMemo(() => [...squads.keys()].sort(), [squads]);

    return (
        <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-0 sm:p-6"
            onClick={onClose}
        >
            <div
                className="glass-panel w-full max-w-5xl my-0 sm:my-8 rounded-none sm:rounded-xl min-h-screen sm:min-h-0 flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-4 sm:p-6 pb-3 space-y-3 border-b border-white/5">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h2 className="text-xl font-bold text-white">Pick players to watch</h2>
                            <p className="text-sm text-gray-400 mt-0.5">
                                {watch.limit
                                    ? <>{watch.keys.length} of {watch.limit} free · <span className="text-purple-300">sign in free to watch more</span></>
                                    : <>Watching {watch.keys.length} {watch.keys.length === 1 ? 'player' : 'players'}{user ? ' · saved to your account' : ''}</>}
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

                    {watch.keys.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {watch.keys.map(key => byKey.get(key)).filter(Boolean).map(p => (
                                <button
                                    key={p.PlayerKey}
                                    type="button"
                                    onClick={() => watch.remove(p.PlayerKey)}
                                    className="flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-xs bg-purple-500/15 text-purple-200 border border-purple-500/30 hover:bg-purple-500/25"
                                >
                                    {p.PlayerName} <X size={12} />
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-2">
                        <label className="relative flex-1">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                                ref={searchRef}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search any player or team code"
                                className="input-dark w-full pl-9"
                            />
                        </label>
                        {!results && (
                            <div className="flex rounded-lg border border-white/10 p-0.5 text-sm shrink-0">
                                {[['round', `Round ${round} games`], ['teams', 'All teams']].map(([id, label]) => (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setView(id)}
                                        className={`px-3 py-1.5 rounded-md transition-colors ${
                                            view === id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-4 sm:p-6 pt-4 space-y-5 flex-1">
                    {results && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0.5">
                            {results.map(p => (
                                <PlayerRow
                                    key={p.PlayerKey}
                                    player={p}
                                    selected={isSelected(p)}
                                    locked={isLocked(p)}
                                    onToggle={watch.toggle}
                                    showTeam
                                />
                            ))}
                            {!results.length && <p className="text-sm text-gray-500">Nobody matches “{query}”.</p>}
                        </div>
                    )}

                    {!results && view === 'round' && orderedGames.map(game => (
                        <section
                            key={game.code}
                            className={`rounded-xl border p-3 sm:p-4 ${game.code === focusGame?.code
                                ? 'border-purple-500/40 bg-purple-500/[0.04]'
                                : 'border-white/5 bg-[#ffffff03]'}`}
                        >
                            <div className="flex items-center justify-between gap-3 mb-3 px-1">
                                <h3 className="font-semibold text-gray-100">
                                    {game.homeCode} <span className="text-gray-600 font-normal">vs</span> {game.awayCode}
                                    {game.status !== 'scheduled' && (
                                        <span className="ml-2 font-mono text-sm text-gray-400">{game.scoreHome}–{game.scoreAway}</span>
                                    )}
                                </h3>
                                <span className="text-xs"><GameStatus game={game} now={now} /></span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {[game.homeCode, game.awayCode].map(code => (
                                    <TeamColumn
                                        key={code}
                                        code={code}
                                        name={teamNames.get(code)}
                                        players={squads.get(code) ?? []}
                                        isSelected={isSelected}
                                        isLocked={isLocked}
                                        onToggle={watch.toggle}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}

                    {!results && view === 'teams' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {allTeams.map(code => (
                                <div key={code} className="rounded-xl border border-white/5 bg-[#ffffff03] p-3">
                                    <TeamColumn
                                        code={code}
                                        name={teamNames.get(code)}
                                        players={squads.get(code) ?? []}
                                        isSelected={isSelected}
                                        isLocked={isLocked}
                                        onToggle={watch.toggle}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="sticky bottom-0 p-4 sm:px-6 border-t border-white/5 bg-[#0d0d0f]/95 backdrop-blur flex items-center justify-between gap-3 sm:rounded-b-xl">
                    <span className="text-xs text-gray-500">Sorted by season average FPT · CR is the current price</span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
