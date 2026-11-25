import React from 'react';
import { statusOf, OUT, GTD } from '../injuries';
import useInjuries from '../hooks/useInjuries';

// On a photo the usual tinted chip disappears: solid colours there.
const SOLID = {
    [OUT]: 'bg-red-600 text-white border-red-300/60',
    [GTD]: 'bg-amber-400 text-gray-900 border-amber-100/60',
};

const SIZE = {
    xs: 'text-[9px] px-1 leading-[14px]',
    sm: 'text-[10px] px-1.5 py-0.5',
    md: 'text-xs px-2 py-0.5',
};

/**
 * The injured badge, the same everywhere a player is shown: OUT (red) or GTD (amber),
 * the injury in its tooltip (or beside it, `withInjury`); `solid` on a photo. Nothing for a healthy player.
 *
 * Give `status` (and `injury`) when the player's own data carries them - an empty
 * status means healthy. Without `status`, `name` (the app's PlayerName) is looked up in
 * the current injury report.
 */
export default function InjuryBadge({ name, status, injury, size = 'sm', withInjury = false, solid = false, className = '' }) {
    const report = useInjuries();
    const hit = status !== undefined && status !== null ? { InjuryStatus: status, Injury: injury } : report[name];
    const raw = String(hit?.InjuryStatus ?? '').trim();
    if (!raw) return null;
    const s = statusOf(raw);
    // Some rows carry the status but not the injury: the report has it.
    const detail = String(hit?.Injury || report[name]?.Injury || '').trim();
    const title = `${s.label}${detail ? ` · ${detail}` : ''}`;
    return (
        <span
            title={title}
            aria-label={`Injured: ${title}`}
            className={`inline-flex items-center shrink-0 rounded border font-semibold tracking-wide ${SIZE[size] ?? SIZE.sm} ${solid ? (SOLID[s.key] ?? 'bg-gray-600 text-white border-white/30') : s.chip} ${className}`}
        >
            {s.short}{withInjury && detail ? <span className="font-normal ml-1">· {detail}</span> : null}
        </span>
    );
}
