import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { anchorFrom, anchoredPosition } from '../anchoredPanel';
import { UserPlus, Check, Search } from 'lucide-react';

/**
 * Multi-select for choosing which players a chart draws.
 *
 * Modelled on ColumnPicker — same portal-anchored panel, for the same reason: rendered
 * inline it paints behind the chart panels, which sit in their own stacking contexts.
 * The difference is the list here is hundreds of entries rather than a few dozen, so
 * it is searchable and ordered by price movement, which is what makes a player worth
 * looking at in the first place.
 */
export default function PlayerPicker({ players, selected, onChange, max }) {
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState(null);
    const [query, setQuery] = useState('');
    const ref = useRef(null);
    const panelRef = useRef(null);
    const searchRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onDocClick = (e) => {
            const inButton = ref.current && ref.current.contains(e.target);
            const inPanel = panelRef.current && panelRef.current.contains(e.target);
            if (!inButton && !inPanel) setOpen(false);
        };
        const onKey = (e) => e.key === 'Escape' && setOpen(false);
        document.addEventListener('mousedown', onDocClick);
        window.addEventListener('keydown', onKey);
        searchRef.current?.focus();
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const matches = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return players;
        return players.filter(p =>
            p.playerName.toLowerCase().includes(needle) ||
            String(p.team ?? '').toLowerCase().includes(needle)
        );
    }, [players, query]);

    const atLimit = max !== undefined && selected.length >= max;

    const toggle = (player) => {
        if (selected.includes(player.playerKey)) {
            onChange(selected.filter(k => k !== player.playerKey));
        } else if (!atLimit) {
            onChange([...selected, player.playerKey]);
        }
    };

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={(e) => {
                    setAnchor(anchorFrom(e.currentTarget));
                    setOpen(v => !v);
                }}
                className={`flex items-center gap-2 px-3 py-2 md:py-1.5 rounded-lg text-xs font-medium border transition-colors ${open
                    ? 'bg-purple-600/20 text-purple-300 border-purple-500/40'
                    : 'bg-[#ffffff05] text-gray-300 border-[#ffffff10] hover:text-white'}`}
            >
                <UserPlus size={14} />
                Players
                <span className="text-gray-500">{selected.length}</span>
            </button>

            {open && anchor && createPortal(
                <div
                    ref={panelRef}
                    style={anchoredPosition(anchor, 320)}
                    className="z-[70] w-[min(320px,calc(100vw-16px))] rounded-xl bg-[#16161a] border border-white/10 shadow-2xl p-2"
                >
                    <div className="flex items-center gap-2 px-2 py-1.5 mb-1 rounded-lg bg-[#ffffff05]">
                        <Search size={13} className="text-gray-500 shrink-0" />
                        <input
                            ref={searchRef}
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search player or team"
                            className="bg-transparent text-sm text-gray-200 placeholder:text-gray-600
                                       outline-none w-full"
                        />
                    </div>

                    <div className="flex items-center justify-between px-2 pb-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-gray-600 font-semibold">
                            {matches.length} of {players.length}
                        </span>
                        <button
                            onClick={() => onChange([])}
                            disabled={!selected.length}
                            className="text-xs text-purple-400 hover:text-purple-300 disabled:text-gray-600
                                       disabled:cursor-default transition-colors"
                        >
                            Clear all
                        </button>
                    </div>

                    <div className="max-h-[50vh] overflow-y-auto">
                        {matches.length === 0 && (
                            <p className="px-2 py-3 text-sm text-gray-500">No player matches that.</p>
                        )}
                        {matches.map(player => {
                            const checked = selected.includes(player.playerKey);
                            // Everything is still listed at the limit, but unchecked rows
                            // stop responding — quietly dropping them would hide players.
                            const blocked = !checked && atLimit;
                            return (
                                <button
                                    key={player.playerKey}
                                    onClick={() => toggle(player)}
                                    disabled={blocked}
                                    className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-sm
                                                transition-colors ${blocked ? 'cursor-default' : 'hover:bg-[#ffffff08]'}`}
                                >
                                    <span className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${checked
                                        ? 'bg-purple-600 border-purple-500 text-white'
                                        : 'border-white/15'}`}>
                                        {checked && <Check size={11} strokeWidth={3} />}
                                    </span>
                                    <span className={`truncate ${blocked ? 'text-gray-600' : 'text-gray-200'}`}>
                                        {player.playerName}
                                    </span>
                                    <span className="ml-auto pl-2 flex items-center gap-2 shrink-0 tabular-nums">
                                        <span className="text-[10px] text-gray-600">{player.team}</span>
                                        <span className={`text-xs ${player.change > 0 ? 'text-emerald-400'
                                            : player.change < 0 ? 'text-red-400' : 'text-gray-600'}`}>
                                            {player.change > 0 ? '+' : ''}{player.change.toFixed(1)}
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {atLimit && (
                        <p className="px-2 pt-2 text-[11px] text-amber-400/80">
                            {max} lines is the readable maximum — remove one to add another.
                        </p>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}
