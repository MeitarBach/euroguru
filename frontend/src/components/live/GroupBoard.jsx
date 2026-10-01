import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import AnimatedNumber from './AnimatedNumber';
import LiveDot from './LiveDot';

const MotionLi = motion.li;

/** A one-line text field that commits on Enter and gives up on Escape. */
function InlineName({ initial = '', placeholder, onSubmit, onCancel, submitLabel }) {
    const [value, setValue] = useState(initial);
    return (
        <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}
        >
            <input
                autoFocus
                value={value}
                maxLength={24}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
                placeholder={placeholder}
                className="input-dark flex-1 min-w-0 py-1.5 text-sm"
            />
            <button type="submit" className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-purple-600 hover:bg-purple-500">
                {submitLabel}
            </button>
            <button type="button" onClick={onCancel} aria-label="Cancel" className="p-1.5 rounded-lg text-gray-500 hover:text-white">
                <X size={14} />
            </button>
        </form>
    );
}

/**
 * Every group's total, ranked live - the head-to-head against the rest of the league.
 *
 * Rows re-rank as totals move, gliding rather than jumping, so an overtake is visible.
 */
export function GroupBoard({ round, groups, selectedId, onSelect, onCreate }) {
    const [creating, setCreating] = useState(false);
    const ranked = [...groups].sort((a, b) =>
        (b.sums.total - a.sums.total) || (b.sums.projected - a.sums.projected) || a.name.localeCompare(b.name));
    const leader = ranked[0]?.sums.total ?? 0;
    const anyScored = groups.some(g => g.sums.total !== 0 || g.sums.live > 0 || g.sums.final > 0);

    return (
        <div className="glass-panel p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2 px-1">
                <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                    {round ? `Round ${round} · ` : ''}groups
                </h3>
                {!creating && (
                    <button
                        type="button"
                        onClick={() => setCreating(true)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-purple-300 hover:text-purple-200"
                    >
                        <Plus size={13} /> New group
                    </button>
                )}
            </div>

            <ul className="space-y-1">
                {ranked.map((group, i) => {
                    const selected = group.id === selectedId;
                    const gap = Math.round((leader - group.sums.total) * 10) / 10;
                    return (
                        <MotionLi key={group.id} layout transition={{ type: 'spring', stiffness: 420, damping: 38 }}>
                            <button
                                type="button"
                                onClick={() => onSelect(group.id)}
                                aria-pressed={selected}
                                className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors
                                    ${selected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}
                                style={selected ? { boxShadow: `inset 3px 0 0 ${group.colorHex}` } : undefined}
                            >
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: group.colorHex }} />
                                <span className="min-w-0 flex-1">
                                    <span className={`block text-sm truncate ${selected ? 'text-white font-semibold' : 'text-gray-200'}`}>
                                        {group.name}
                                    </span>
                                    <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
                                        {group.keys.length} {group.keys.length === 1 ? 'player' : 'players'}
                                        {group.sums.live > 0 && <><span>·</span><LiveDot /> <span className="text-red-300">{group.sums.live} live</span></>}
                                        {group.sums.pending > 0 && <span className="text-emerald-300/80">· +{group.sums.pending.toFixed(1)} if wins hold</span>}
                                    </span>
                                </span>
                                <span className="text-right shrink-0">
                                    <AnimatedNumber value={group.sums.total} className="block text-xl leading-none font-bold font-mono text-white" />
                                    <span className="block mt-0.5 text-[10px] text-gray-500 whitespace-nowrap">
                                        {!anyScored
                                            ? `proj ${group.sums.projected.toFixed(1)}`
                                            : i === 0 || gap === 0 ? (groups.length > 1 ? 'leading' : 'FPT') : `−${gap.toFixed(1)}`}
                                    </span>
                                </span>
                            </button>
                        </MotionLi>
                    );
                })}
            </ul>

            {creating && (
                <div className="mt-2 px-1">
                    <InlineName
                        placeholder="e.g. Dana's team"
                        submitLabel="Create"
                        onSubmit={(name) => { onCreate(name); setCreating(false); }}
                        onCancel={() => setCreating(false)}
                    />
                </div>
            )}
        </div>
    );
}

/** The open group's name, with renaming and (two-step) deleting. */
export function GroupHeader({ group, canDelete, onRename, onDelete }) {
    const [editing, setEditing] = useState(false);
    const [confirming, setConfirming] = useState(false);

    if (editing) {
        return (
            <InlineName
                initial={group.name}
                submitLabel="Save"
                onSubmit={(name) => { onRename(name); setEditing(false); }}
                onCancel={() => setEditing(false)}
            />
        );
    }

    return (
        <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: group.colorHex }} />
                <h3 className="text-base font-semibold text-white truncate">{group.name}</h3>
                <span className="text-xs text-gray-500 shrink-0">
                    {group.sums.total.toFixed(1)} FPT
                    {group.sums.toPlay > 0 && ` · ${group.sums.toPlay} to play`}
                </span>
                <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-label="Rename group"
                    className="p-1 rounded-md text-gray-600 hover:text-white hover:bg-white/5 shrink-0"
                >
                    <Pencil size={13} />
                </button>
            </div>
            {canDelete && (confirming ? (
                <span className="flex items-center gap-1.5 shrink-0 text-xs">
                    <span className="text-gray-400">Delete {group.name}?</span>
                    <button
                        type="button"
                        onClick={() => { setConfirming(false); onDelete(); }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/15 text-red-300 hover:bg-red-500/25"
                    >
                        <Check size={12} /> Delete
                    </button>
                    <button type="button" onClick={() => setConfirming(false)} className="px-2 py-1 rounded-md text-gray-400 hover:text-white">
                        Keep
                    </button>
                </span>
            ) : (
                <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    aria-label="Delete group"
                    className="p-1.5 rounded-md text-gray-600 hover:text-red-300 hover:bg-red-500/10 shrink-0"
                >
                    <Trash2 size={14} />
                </button>
            ))}
        </div>
    );
}
