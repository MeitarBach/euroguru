import React, { useEffect, useRef, useState } from 'react';
import { Check, Plus, UserRound } from 'lucide-react';

/**
 * Put a player in any of your groups, from a card in the game view.
 *
 * One tap per group toggles membership (the free limit is enforced by the toggle), a new
 * group can be made on the spot, and the player's detail is one more tap away. Closes on
 * a click elsewhere or Escape.
 */
export default function AddToGroupsMenu({ player, groups, onToggle, onCreate, onDetails, onClose }) {
    const ref = useRef(null);
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState('');

    useEffect(() => {
        const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        // Deferred so the click that opened the menu does not also close it.
        const id = setTimeout(() => document.addEventListener('pointerdown', onDown), 0);
        window.addEventListener('keydown', onKey);
        return () => {
            clearTimeout(id);
            document.removeEventListener('pointerdown', onDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [onClose]);

    return (
        <div
            ref={ref}
            onClick={(e) => e.stopPropagation()}
            className="absolute left-2 right-2 top-full mt-1 z-40 rounded-xl border border-white/10 bg-[#141418] shadow-2xl p-1.5 text-sm"
        >
            <div className="px-2 pt-1 pb-1.5 text-[11px] text-gray-500">Add {player.PlayerName} to</div>
            {groups.map(g => {
                const on = g.keys.includes(player.PlayerKey);
                return (
                    <button
                        key={g.id}
                        type="button"
                        onClick={() => onToggle(g.id, player.PlayerKey)}
                        aria-pressed={on}
                        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-white/[0.06]"
                    >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.colorHex }} />
                        <span className={`flex-1 truncate ${on ? 'text-white font-medium' : 'text-gray-300'}`}>{g.name}</span>
                        {on && <Check size={15} style={{ color: g.colorHex }} />}
                    </button>
                );
            })}
            {naming ? (
                <form
                    className="flex items-center gap-1.5 px-1 py-1"
                    onSubmit={(e) => { e.preventDefault(); onCreate(name); setNaming(false); }}
                >
                    <input
                        autoFocus
                        value={name}
                        maxLength={24}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Group name"
                        className="input-dark flex-1 min-w-0 py-1.5 text-sm"
                    />
                    <button type="submit" className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-white bg-purple-600 hover:bg-purple-500">
                        Add
                    </button>
                </form>
            ) : (
                <button
                    type="button"
                    onClick={() => setNaming(true)}
                    className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left text-purple-300 hover:bg-white/[0.06]"
                >
                    <Plus size={14} /> New group…
                </button>
            )}
            <div className="my-1 border-t border-white/5" />
            <button
                type="button"
                onClick={onDetails}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left text-gray-400 hover:bg-white/[0.06]"
            >
                <UserRound size={14} /> Player details
            </button>
        </div>
    );
}
