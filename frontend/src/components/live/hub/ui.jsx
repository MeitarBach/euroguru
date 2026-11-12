import React, { useState } from 'react';
import { Lock, Globe, BadgeCheck, X } from 'lucide-react';
import { ROOM_NAME_MAX } from '../../../lib/rooms';

// The Live hub's shared pieces: the widget shell, buttons, faces, and the room bits the
// widgets, the room page and the bring dialog all use.

export const primaryBtn = 'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 disabled:opacity-50';
export const softBtn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-purple-200 bg-purple-500/15 border border-purple-500/30 hover:bg-purple-500/25 disabled:opacity-40';
export const linkBtn = 'inline-flex items-center gap-1 text-xs font-medium text-purple-300 hover:text-purple-200';
export const ghostBtn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5';

/** A hub widget: an icon and a title, actions on the right, then its body. */
export function Widget({ icon, title, subtitle, actions, children, className = '' }) {
    return (
        <section className={`glass-panel p-4 space-y-3 ${className}`}>
            <header className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                        {icon} {title}
                    </h3>
                    {subtitle && <div className="mt-0.5 text-xs text-gray-500">{subtitle}</div>}
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </header>
            {children}
        </section>
    );
}

export function Spinner({ className = 'h-[160px]' }) {
    return (
        <div className={`w-full flex items-center justify-center ${className}`}>
            <div className="w-7 h-7 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
    );
}

export function RoomBadges({ room }) {
    if (room.official) {
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-200 text-[10px] font-semibold uppercase tracking-wide shrink-0">
                <BadgeCheck size={11} /> Official
            </span>
        );
    }
    return room.visibility === 'public'
        ? <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300 shrink-0"><Globe size={11} /> Public</span>
        : <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 shrink-0"><Lock size={11} /> Private</span>;
}

/** A one-line name form: Enter saves, Escape gives up. `children` sit before the button. */
export function NameForm({ initial = '', placeholder, max = ROOM_NAME_MAX, submitLabel, onSubmit, onCancel, children }) {
    const [value, setValue] = useState(initial);
    return (
        <form className="flex flex-wrap items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}>
            <input
                autoFocus
                value={value}
                maxLength={max}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel(); } }}
                placeholder={placeholder}
                className="input-dark flex-1 min-w-[10rem] py-1.5 text-sm"
            />
            {children}
            <button type="submit" className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-purple-600 hover:bg-purple-500">
                {submitLabel}
            </button>
            {onCancel && (
                <button type="button" onClick={onCancel} aria-label="Cancel" className="p-1.5 rounded-lg text-gray-500 hover:text-white">
                    <X size={14} />
                </button>
            )}
        </form>
    );
}

/** Public | Private, for a new room or an admin's change. */
export function VisibilitySwitch({ value, onChange }) {
    return (
        <div className="inline-flex p-0.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs">
            {[['private', 'Private', <Lock key="i" size={11} />], ['public', 'Public', <Globe key="i" size={11} />]].map(([id, label, icon]) => (
                <button
                    key={id}
                    type="button"
                    aria-pressed={value === id}
                    onClick={() => onChange(id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md ${value === id ? 'bg-purple-500/20 text-white font-medium' : 'text-gray-400 hover:text-white'}`}
                >
                    {icon} {label}
                </button>
            ))}
        </div>
    );
}
