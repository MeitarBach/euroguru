import React from 'react';

/** Court | Cards: how a team is drawn - on a half court with photos, or as stat cards. */
export default function ViewSwitch({ view, onChange }) {
    return (
        <div className="inline-flex p-0.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs">
            {[['court', 'Court'], ['cards', 'Cards']].map(([id, label]) => (
                <button
                    key={id}
                    type="button"
                    aria-pressed={view === id}
                    onClick={() => onChange(id)}
                    className={`px-2.5 py-1 rounded-md ${view === id ? 'bg-purple-500/20 text-white font-medium' : 'text-gray-400 hover:text-white'}`}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}
