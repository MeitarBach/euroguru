import React from 'react';
import { ChevronLeft } from 'lucide-react';

/**
 * Above every page of the Live hub: back to the home, and a switcher to jump straight to
 * another team, room or watchlist. `items` = { teams, rooms, lists }, each [{id, name}];
 * `current` = { kind, id }.
 */
export default function HubHeader({ items, current, onGo, onHome }) {
    const value = current ? `${current.kind}:${current.id}` : '';
    const groups = [
        ['team', 'My teams', items.teams],
        ['room', 'Watch Rooms', items.rooms],
        ['list', 'Watchlists', items.lists],
    ].filter(([, , list]) => list.length);
    return (
        <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={onHome} className="inline-flex items-center gap-1 -ml-1.5 px-1.5 py-1 rounded-md text-sm text-gray-400 hover:text-white">
                <ChevronLeft size={16} /> Live
            </button>
            <label className="flex items-center gap-2 min-w-0 text-xs text-gray-500">
                <span className="hidden sm:inline">Jump to</span>
                <select
                    value={value}
                    onChange={(e) => {
                        const [kind, ...rest] = e.target.value.split(':');
                        if (kind) onGo({ kind, id: rest.join(':') });
                    }}
                    className="input-dark py-1 text-xs max-w-[13rem]"
                >
                    {groups.map(([kind, label, list]) => (
                        <optgroup key={kind} label={label}>
                            {list.map(item => <option key={item.id} value={`${kind}:${item.id}`}>{item.name}</option>)}
                        </optgroup>
                    ))}
                </select>
            </label>
        </div>
    );
}
