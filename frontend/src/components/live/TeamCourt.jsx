import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Crown, X } from 'lucide-react';
import AnimatedNumber from './AnimatedNumber';
import LiveDot from './LiveDot';
import { GameNote } from './WatchCard';
import { photoUrl } from '../../lib/live/photos';
import { decimalsFor, marginText } from '../../lib/live/format';
import { STARTERS, BENCH } from '../../lib/teams';
import { crChange } from '../../lib/optimizer/score';

const MotionSpan = motion.span;

// The floor of the team optimizer's card (.claude/skills/euroguru-social/court.html):
// a FIBA half court 15 m wide, basket at the top, drawn at 1088x760 - or deeper, toward
// the half-way line, when the figures need the room (see courtLayout).
const W = 1088;
const H = 760;
const S = W / 15; // px per metre
// Where each position's starters stand, basket end first, until the figures are
// measured (as a share of the floor's height); and the spread of a row of 1-5 players,
// as a share of its width.
const ROW_TOP = { C: 96 / H, F: 312 / H, G: 534 / H };
const ROW_INDEX = { C: 0, F: 1, G: 2 };
// A figure's width, in % of the floor's: a row of 4-5 is narrower.
const FIGURE_CQW = 21.7;
const FIGURE_CQW_CROWDED = 18.5;
// How far the captain's crown rises above a figure, as a share of the figure's width.
const CROWN_LIFT = 0.075;
const LABEL_PX = 26; // the "Starting five" line above the centers
const GAP_PX = 6;
const BOTTOM_PX = 10;
const SPREAD = {
    1: [0], 2: [-0.175, 0.175], 3: [-0.303, 0, 0.303],
    4: [-0.375, -0.125, 0.125, 0.375], 5: [-0.4, -0.2, 0, 0.2, 0.4],
};
const BUBBLE_MS = 4000;
// How far a press must travel before it is a drag rather than a tap.
const DRAG_START_PX = 6;

const fixed = (x) => x.toFixed(decimalsFor(x));
const surname = (name) => String(name ?? '').replace(/\s*\([^)]*\)$/, '').split(' ').slice(1).join(' ') || name;
const initials = (name) => String(name ?? '?').replace(/\s*\([^)]*\)$/, '').split(/[\s.]+/).filter(Boolean)
    .map(w => w[0]).slice(0, 2).join('').toUpperCase();

/**
 * The floor's height in px and each row's top (CSS), for a floor `width` wide whose tallest
 * figure (photo + name plate) is `figure` high. Rows sit at least a figure apart, with
 * room for a crown above each head, so no head or crown reaches the plate in front of
 * it; the floor keeps the card's proportions when that fits and grows deeper when it
 * does not (a phone, where the plates keep a readable size).
 */
function courtLayout(width, figure) {
    const flat = width * H / W;
    if (!width || !figure) return { height: flat, top: (pos) => `${ROW_TOP[pos] * 100}%` };
    const lift = CROWN_LIFT * (FIGURE_CQW / 100) * width;
    const first = LABEL_PX + lift + GAP_PX;
    const pitch = figure + lift + GAP_PX;
    const need = first + 2 * pitch + figure + BOTTOM_PX;
    const height = Math.max(flat, need);
    // Room to spare spreads the rows out, a little above the centers too.
    const spare = height - need;
    return { height, top: (pos) => `${first + spare * 0.2 + ROW_INDEX[pos] * (pitch + spare * 0.3)}px` };
}

/** The lines, `depth` floor-px deep: past 14 m that is the half-way line and its circle. */
function CourtLines({ depth = H }) {
    const bx = W / 2;
    const by = 1.575 * S;
    const r3 = 6.75 * S;
    const c3 = 0.9 * S;
    const y3 = by + Math.sqrt(r3 ** 2 - (bx - c3) ** 2);
    const line = { fill: 'none', stroke: 'rgba(255,255,255,0.20)', strokeWidth: 2.5 };
    return (
        <svg viewBox={`0 0 ${W} ${depth}`} className="absolute inset-0 w-full h-full" aria-hidden="true">
            <rect x={bx - 2.45 * S} y={0} width={4.9 * S} height={5.8 * S}
                fill="rgba(139,92,246,0.16)" stroke="rgba(196,181,253,0.35)" strokeWidth={2.5} />
            <circle cx={bx} cy={5.8 * S} r={1.8 * S} {...line} />
            <path d={`M ${bx - 1.25 * S} ${by} A ${1.25 * S} ${1.25 * S} 0 0 0 ${bx + 1.25 * S} ${by}`} {...line} />
            <line x1={bx - 0.9 * S} y1={1.2 * S} x2={bx + 0.9 * S} y2={1.2 * S} stroke="rgba(255,255,255,0.55)" strokeWidth={4} />
            <circle cx={bx} cy={by} r={0.23 * S} fill="none" stroke="#fb923c" strokeWidth={3.5} />
            <path d={`M ${c3} 0 L ${c3} ${y3} A ${r3} ${r3} 0 0 0 ${W - c3} ${y3} L ${W - c3} 0`} {...line} />
            {depth > 14 * S && (
                <>
                    <line x1={0} y1={14 * S} x2={W} y2={14 * S} {...line} />
                    <path d={`M ${bx - 1.8 * S} ${14 * S} A ${1.8 * S} ${1.8 * S} 0 0 1 ${bx + 1.8 * S} ${14 * S}`} {...line} />
                </>
            )}
        </svg>
    );
}

/** A cutout headshot over a halo, or the player's initials when there is no photo. */
function Bust({ url, name, captain, size }) {
    const [broken, setBroken] = useState(false);
    const halo = captain
        ? 'radial-gradient(circle, rgba(250,204,21,0.42), rgba(139,92,246,0.25) 45%, rgba(139,92,246,0) 70%)'
        : 'radial-gradient(circle, rgba(139,92,246,0.60), rgba(139,92,246,0) 70%)';
    return (
        <div className="relative" style={{ height: `calc(${size} * 0.62)` }}>
            <div className="absolute left-1/2 -translate-x-1/2 top-0 rounded-full" style={{ width: `calc(${size} * 0.72)`, height: `calc(${size} * 0.72)`, background: halo }} />
            {url && !broken ? (
                <img
                    src={url}
                    alt=""
                    loading="lazy"
                    onError={() => setBroken(true)}
                    className="absolute left-1/2 -translate-x-1/2 max-w-none pointer-events-none select-none"
                    style={{
                        top: `calc(${size} * 0.02)`, height: `calc(${size} * 1.23)`,
                        WebkitMaskImage: 'linear-gradient(to bottom, #000 40%, transparent 50%)',
                        maskImage: 'linear-gradient(to bottom, #000 40%, transparent 50%)',
                    }}
                />
            ) : (
                <div
                    className="absolute left-1/2 -translate-x-1/2 rounded-full flex items-center justify-center font-extrabold text-violet-200 bg-violet-500/25 border-2 border-violet-400/45"
                    style={{ top: `calc(${size} * 0.08)`, width: `calc(${size} * 0.47)`, height: `calc(${size} * 0.47)`, fontSize: `calc(${size} * 0.17)` }}
                >
                    {initials(name)}
                </div>
            )}
        </div>
    );
}

/** A "+2.0" over a player who just scored, for a few seconds. */
function Bubble({ event, factor, now }) {
    const recent = event && now - event.at < BUBBLE_MS ? event : null;
    const value = recent ? Math.round(recent.delta * factor * 100) / 100 : 0;
    return (
        <AnimatePresence>
            {recent && value !== 0 && (
                <MotionSpan
                    key={recent.at}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className={`absolute -top-1 right-[18%] z-10 px-1.5 py-0.5 rounded-md text-[11px] font-bold font-mono shadow-lg
                        ${value > 0 ? 'bg-emerald-500 text-emerald-950' : 'bg-red-500 text-white'}`}
                >
                    {value > 0 ? '+' : ''}{fixed(value)}
                </MotionSpan>
            )}
        </AnimatePresence>
    );
}

/**
 * The armband, as a crown on the player's head: gold on the captain. With `onClick` it is
 * a button on every starter - a faint crown to tap to make him captain, the gold one to
 * take it off; without, only the captain wears it.
 */
function CaptainCrown({ captain, onClick }) {
    if (!onClick && !captain) return null;
    const style = { width: 'max(20px, 3.4cqw)', height: 'max(20px, 3.4cqw)' };
    const icon = (
        <Crown
            className="w-full h-full"
            strokeWidth={2}
            fill={captain ? 'currentColor' : 'none'}
        />
    );
    const place = 'absolute left-1/2 -translate-x-1/2 z-10';
    const top = { top: `calc(var(--fig) * -${CROWN_LIFT})` };
    if (!onClick) {
        return (
            <span className={`${place} text-yellow-400 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)] pointer-events-none`} style={{ ...top, ...style }} aria-label="Captain">
                {icon}
            </span>
        );
    }
    return (
        <button
            type="button"
            onClick={onClick}
            onPointerDown={(e) => e.stopPropagation()}
            title={captain ? 'Captain: counts double. Tap to take the armband off.' : 'Make captain (counts double)'}
            aria-label={captain ? 'Take the armband off' : 'Make captain'}
            aria-pressed={captain}
            className={`${place} p-0.5 rounded-full transition-colors drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]
                ${captain ? 'text-yellow-400 hover:text-yellow-300' : 'text-white/30 hover:text-yellow-300'}`}
            style={{ ...top, ...style }}
        >
            {icon}
        </button>
    );
}

/** A small x in a player's corner that takes him out of the team. */
function RemoveButton({ onClick, className = '', style }) {
    return (
        <button
            type="button"
            onClick={onClick}
            onPointerDown={(e) => e.stopPropagation()}
            title="Remove from the team"
            aria-label="Remove from the team"
            className={`absolute z-10 rounded-full flex items-center justify-center bg-[#0a0812]/90 border border-white/20 text-gray-300
                hover:bg-red-500 hover:border-red-400 hover:text-white transition-colors shadow-lg ${className}`}
            style={style}
        >
            <X className="w-3/5 h-3/5" strokeWidth={2.5} />
        </button>
    );
}

/** A price and, when the injury report has him, OUT or GTD - for building a team. */
function PriceLine({ row, style, className = '' }) {
    const out = row.injury && String(row.injury).toUpperCase().startsWith('OUT');
    return (
        <div className={`text-gray-500 whitespace-nowrap ${className}`} style={style}>
            {typeof row.cr === 'number' ? `${row.cr.toFixed(1)} CR` : ''}
            {row.injury && <span className={`ml-1 font-bold ${out ? 'text-red-300' : 'text-amber-300'}`}>{out ? 'OUT' : 'GTD'}</span>}
        </div>
    );
}

/** How a player's price moved with a played round (My Teams' Round dropdown). */
function DeltaLine({ delta, style, className = '' }) {
    const { text, tone } = crChange(delta);
    return (
        <div className={`font-semibold whitespace-nowrap ${tone} ${className}`} style={style} title="Price change with this round">
            {text} CR
        </div>
    );
}

/** Where a drag is over: a player (`key`) or an empty part of the floor or bench (`zone`). */
function dropTargetAt(x, y) {
    const el = document.elementFromPoint(x, y)?.closest('[data-drop-key],[data-drop-zone]');
    if (!el) return null;
    return el.dataset.dropKey ? { key: el.dataset.dropKey } : { zone: el.dataset.dropZone };
}

/**
 * Dragging players around the court, with a mouse or a finger. Pointer events rather
 * than HTML drag-and-drop, which never fires on a phone. A press that travels less
 * than DRAG_START_PX stays a tap (the player's details); one that travels further follows
 * the pointer, and on release `onDrop(key, target)` gets what it was let go over.
 */
function useCourtDrag({ enabled, onDrop }) {
    const [drag, setDrag] = useState(null); // { key, name, photo, x, y, over }
    const press = useRef(null);
    const dragged = useRef(false);
    const onDropRef = useRef(onDrop);
    useEffect(() => { onDropRef.current = onDrop; });

    useEffect(() => {
        if (!enabled) return undefined;
        const move = (e) => {
            const p = press.current;
            if (!p || e.pointerId !== p.id) return;
            if (!p.active) {
                if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < DRAG_START_PX) return;
                p.active = true;
            }
            e.preventDefault();
            setDrag({ key: p.key, name: p.name, photo: p.photo, x: e.clientX, y: e.clientY, over: dropTargetAt(e.clientX, e.clientY) });
        };
        const up = (e) => {
            const p = press.current;
            if (!p || e.pointerId !== p.id) return;
            press.current = null;
            if (!p.active) return;
            // The click that follows this release must not open the player.
            dragged.current = true;
            setTimeout(() => { dragged.current = false; }, 0);
            setDrag(null);
            const target = dropTargetAt(e.clientX, e.clientY);
            if (target) onDropRef.current?.(p.key, target);
        };
        const cancel = () => { press.current = null; setDrag(null); };
        window.addEventListener('pointermove', move, { passive: false });
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel);
        };
    }, [enabled]);

    const handlers = (row, photo) => (enabled ? {
        onPointerDown: (e) => {
            if (e.button !== 0) return;
            press.current = { key: row.key, name: row.player.PlayerName, photo, x0: e.clientX, y0: e.clientY, id: e.pointerId, active: false };
        },
        // The page must not scroll under a finger that is moving a player.
        style: { touchAction: 'none' },
    } : {});
    return { drag, handlers, wasDrag: () => dragged.current };
}

/** What follows the pointer while a player is being moved. */
function DragGhost({ drag }) {
    if (!drag) return null;
    return (
        <div
            className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-[#141022] border border-violet-400/60 shadow-2xl"
            style={{ left: drag.x, top: drag.y }}
        >
            <span className="w-8 h-8 rounded-full overflow-hidden bg-violet-500/25 flex items-center justify-center text-[11px] font-bold text-violet-200">
                {drag.photo ? <img src={photoUrl(drag.photo, 80)} alt="" className="w-full h-full object-cover object-top" /> : initials(drag.name)}
            </span>
            <span className="text-sm font-bold text-white">{surname(drag.name)}</span>
        </div>
    );
}

/**
 * One starter on the floor: photo, name plate, points; a tap opens his details. The
 * captain wears a gold crown. With `onCaptain` / `onRemove` (an editable team) every
 * starter has a crown to tap for the armband and an x in the corner.
 */
function Starter({ row, photo, left, top, width, now, lastEvent, onTap, onCaptain, onRemove, expected, past, dragProps, dragging, dropOver }) {
    const size = `${width}cqw`;
    return (
        <div
            data-drop-key={row.key}
            className={`absolute -translate-x-1/2 transition-opacity ${dragging ? 'opacity-35' : ''}`}
            style={{ left: `${left * 100}%`, top, width: size, '--fig': size }}
        >
            <button
                type="button"
                onClick={onTap}
                {...dragProps}
                data-figure=""
                aria-label={`${row.player.PlayerName}: player details`}
                className={`block w-full text-center focus:outline-none group rounded-xl ${dropOver ? 'ring-2 ring-emerald-400/80' : ''}`}
            >
                <div className="relative">
                    <Bust url={photoUrl(photo, 240)} name={row.player.PlayerName} captain={row.captain} size={size} />
                    <Bubble event={lastEvent} factor={row.factor} now={now} />
                </div>
                <div
                    className={`relative -mt-1 px-1.5 py-1 rounded-xl bg-[#0a0812]/90 border shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-colors
                        ${row.captain ? 'border-yellow-400/75 shadow-[0_0_0_1px_rgba(250,204,21,0.25),0_8px_28px_rgba(250,204,21,0.18)]' : 'border-violet-400/40 group-hover:border-violet-300/70'}`}
                >
                    <div className="font-extrabold text-white truncate" style={{ fontSize: 'max(12px, 2cqw)' }}>
                        <span className="inline-block mr-1 px-1 rounded bg-violet-500/25 text-violet-300 font-extrabold align-middle" style={{ fontSize: 'max(9px, 1.1cqw)' }}>
                            {row.player.position || '?'}
                        </span>
                        {surname(row.player.PlayerName)}
                    </div>
                    <div className="flex items-center justify-center gap-1 text-gray-400 whitespace-nowrap" style={{ fontSize: 'max(10px, 1.4cqw)' }}>
                        {row.state === 'live' && <LiveDot />}
                        {row.counted === null ? (
                            <span className="truncate"><GameNote row={row} now={now} /></span>
                        ) : past && row.fpt === null ? (
                            <span className="font-bold text-gray-500">DNP</span>
                        ) : (
                            <>
                                <AnimatedNumber value={row.counted} decimals={expected ? 1 : decimalsFor(row.counted)} className="font-mono font-bold text-white" />
                                <span>{expected && !past ? 'exp' : 'FPT'}{row.captain ? ' ×2' : ''}</span>
                            </>
                        )}
                    </div>
                    {past
                        ? <DeltaLine delta={row.delta} style={{ fontSize: 'max(9px, 1.2cqw)' }} />
                        : expected && <PriceLine row={row} style={{ fontSize: 'max(9px, 1.2cqw)' }} />}
                </div>
            </button>
            <CaptainCrown captain={row.captain} onClick={onCaptain} />
            {onRemove && (
                <RemoveButton
                    onClick={onRemove}
                    className="right-[10%]"
                    style={{ top: 'calc(var(--fig) * 0.03)', width: 'max(20px, 2.8cqw)', height: 'max(20px, 2.8cqw)' }}
                />
            )}
        </div>
    );
}

/**
 * A tile under the court - the sixth man, a bench player, the coach or an empty spot -
 * all one size, so the row reads as a row whatever is in it.
 */
function Tile({ children, tone = '', onClick, dashed }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={!onClick}
            className={`relative h-[168px] w-full overflow-hidden rounded-2xl text-center px-1.5 pb-2 border transition-colors flex flex-col items-center
                ${dashed ? 'justify-center border-dashed border-white/15 text-gray-500 hover:text-white hover:border-violet-400/50'
                    : `bg-white/[0.045] border-white/[0.08] ${onClick ? 'hover:border-violet-400/40' : ''} ${tone}`}`}
        >
            {children}
        </button>
    );
}

/** The photo area every tile shares: the same height whether it holds a face or a crest. */
const TILE_PHOTO = 'relative w-full h-[84px] shrink-0';

/**
 * A fantasy team on a half court, like the social skill's team card: the starting five
 * on the floor by position, each with their photo, the captain in gold; under it the
 * sixth man (first on the bench, x1), the rest of the bench (x0.5) and the coach. Every
 * number is the counted FPT of the row as the group scores it - live in the Live tab,
 * or, with `expected`, what it is expected to score next round (My Teams), with each
 * player's price beside it; with `past` as well, what each scored in a played round
 * (DNP when he did not play) and how his price moved with it.
 *
 * A tap on a player opens his details. `editable` puts a crown on every starter's head
 * (tap it for the armband), an x in every player's corner (remove him) and empty spots
 * to fill (`onAddPlayers('starter' | 'bench')`); with `onSwap(a, b)` players move by
 * dragging - onto another player to swap them, between the floor and the bench, or
 * along the bench (its first is the sixth man). `photos` maps PlayerKey to a headshot
 * URL and `crests` a club to its crest (the coach's tile), both from /api/headshots.
 */
export default function TeamCourt({
    group, photos = {}, crests = {}, now, lastEvent, editable = false, expected = false, past = false,
    onToggleCaptain, onToggleBench, onRemove, onOpenPlayer, onAddPlayers, onPickCoach, onSwap,
}) {
    // Editable teams can be rearranged by dragging: a player onto another swaps them (a
    // starter with a bench player, or two on the bench - which is how the sixth man
    // changes), onto the floor starts him, onto the bench benches him.
    const { drag, handlers, wasDrag } = useCourtDrag({
        enabled: editable && Boolean(onSwap),
        onDrop: (key, target) => {
            const row = group.rows.find(r => r.key === key);
            if (!row) return;
            if (target.key) {
                if (target.key !== key) onSwap(key, target.key);
            } else if (target.zone === 'court' && row.benched) {
                onToggleBench?.(key);
            } else if (target.zone === 'bench' && !row.benched) {
                onToggleBench?.(key);
            }
        },
    });
    // The floor's width and its tallest figure, measured before paint and whenever the
    // floor is resized, set the rows (courtLayout).
    const floorRef = useRef(null);
    const [box, setBox] = useState({ width: 0, figure: 0 });
    const measure = useCallback(() => {
        const el = floorRef.current;
        if (!el) return;
        let figure = 0;
        el.querySelectorAll('[data-figure]').forEach((f) => { figure = Math.max(figure, f.offsetHeight); });
        const width = el.clientWidth;
        setBox(b => (b.width === width && b.figure === figure ? b : { width, figure }));
    }, []);
    useLayoutEffect(() => { measure(); });
    useEffect(() => {
        const el = floorRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [measure]);
    const layout = courtLayout(box.width, box.figure);
    const overKey = drag?.over?.key ?? null;
    const overZone = drag?.over?.zone ?? null;
    // Expected points read best at one decimal; live points keep the feed's own.
    const fmt = expected ? (x) => x.toFixed(1) : fixed;
    const starters = group.rows.filter(r => !r.benched);
    // In the lineup's own order: the first is the sixth man, who counts in full.
    const bench = group.bench.map(k => group.rows.find(r => r.key === k)).filter(Boolean);
    const coach = group.coachRow;

    // Rows by position, the best of three in the middle as on the card.
    const rows = { C: [], F: [], G: [] };
    for (const r of starters) (rows[r.player.position] ?? rows.F).push(r);
    const placed = [];
    for (const [pos, list] of Object.entries(rows)) {
        const sorted = [...list].sort((a, b) => (b.countedAvg ?? 0) - (a.countedAvg ?? 0));
        const ordered = sorted.length === 3 ? [sorted[1], sorted[0], sorted[2]] : sorted;
        const xs = SPREAD[ordered.length] ?? SPREAD[5];
        ordered.forEach((r, i) => placed.push({ row: r, left: 0.5 + xs[i], top: layout.top(pos), width: ordered.length >= 4 ? FIGURE_CQW_CROWDED : FIGURE_CQW }));
    }
    const formation = ['G', 'F', 'C'].map(p => rows[p].length).join('-');

    const tap = (row) => {
        if (wasDrag()) return;
        onOpenPlayer?.(row.player.PlayerName);
    };
    const emptyBench = editable ? Math.max(0, BENCH - bench.length) : 0;

    return (
        <div className="space-y-3">
            <DragGhost drag={drag} />
            <div
                ref={floorRef}
                data-drop-zone="court"
                className={`relative w-full rounded-[22px] overflow-hidden border transition-colors ${overZone === 'court' ? 'border-emerald-400/70' : 'border-violet-400/30'}`}
                style={{
                    ...(box.width ? { height: `${layout.height}px` } : { aspectRatio: `${W} / ${H}` }),
                    containerType: 'inline-size',
                    background: 'radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.28), rgba(139,92,246,0) 60%), linear-gradient(180deg, #15102a 0%, #0c0a16 100%)',
                }}
            >
                <CourtLines depth={box.width ? (W * layout.height) / box.width : H} />
                <div className="absolute top-[2.4%] left-[2%] font-extrabold uppercase tracking-[0.15em] text-violet-300" style={{ fontSize: 'max(10px, 1.3cqw)' }}>
                    Starting five{starters.length ? <> · <b className="text-white">{formation}</b></> : null}
                    <span className="ml-2 normal-case tracking-normal font-mono text-white">
                        {fmt(starters.reduce((s, r) => s + (r.counted ?? 0), 0))}
                    </span>
                </div>
                {placed.map(({ row, left, top, width }) => (
                    <Starter
                        key={row.key}
                        row={row}
                        photo={photos[row.key]}
                        left={left}
                        top={top}
                        width={width}
                        now={now}
                        lastEvent={lastEvent?.get(row.key)}
                        expected={expected}
                        past={past}
                        dragProps={handlers(row, photos[row.key])}
                        dragging={drag?.key === row.key}
                        dropOver={overKey === row.key && drag?.key !== row.key}
                        onTap={() => tap(row)}
                        onCaptain={editable && onToggleCaptain ? () => onToggleCaptain(row.key) : undefined}
                        onRemove={editable && onRemove ? () => onRemove(row.key) : undefined}
                    />
                ))}
                {editable && starters.length < STARTERS && (
                    <button
                        type="button"
                        onClick={() => onAddPlayers?.('starter')}
                        className="absolute bottom-[3%] right-[2.5%] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-violet-400/50 text-violet-200 bg-[#0a0812]/80 hover:bg-violet-500/15"
                        style={{ fontSize: 'max(11px, 1.3cqw)' }}
                    >
                        <Plus size={13} /> {STARTERS - starters.length} starter{STARTERS - starters.length === 1 ? '' : 's'} to pick
                    </button>
                )}
            </div>

            <div
                data-drop-zone="bench"
                className={`grid grid-cols-3 sm:grid-cols-6 gap-2 rounded-2xl transition-shadow ${overZone === 'bench' ? 'ring-2 ring-emerald-400/60 ring-offset-4 ring-offset-[#050507]' : ''}`}
            >
                {bench.map(row => (
                    <div
                        key={row.key}
                        data-drop-key={row.key}
                        className={`relative rounded-2xl transition-opacity ${drag?.key === row.key ? 'opacity-35' : ''} ${overKey === row.key && drag?.key !== row.key ? 'ring-2 ring-emerald-400/80' : ''}`}
                        {...handlers(row, photos[row.key])}
                    >
                        <Tile onClick={() => tap(row)} tone={row.sixth ? '!border-emerald-400/45' : ''}>
                            <div className={TILE_PHOTO}>
                                <Bust url={photoUrl(photos[row.key], 140)} name={row.player.PlayerName} size="128px" />
                                <Bubble event={lastEvent?.get(row.key)} factor={row.factor} now={now} />
                            </div>
                            <div className="mt-0.5 w-full text-[13px] font-extrabold text-white truncate">
                                <span className="mr-1 px-1 rounded bg-violet-500/25 text-violet-300 text-[9px] align-middle">{row.player.position || '?'}</span>
                                {surname(row.player.PlayerName)}
                            </div>
                            <div className="w-full flex items-center justify-center gap-1 text-[11px] text-gray-400 whitespace-nowrap">
                                {row.state === 'live' && <LiveDot />}
                                {row.counted === null
                                    ? <span className="truncate"><GameNote row={row} now={now} /></span>
                                    : past && row.fpt === null
                                        ? <span className="font-bold text-gray-500">DNP</span>
                                        : row.factor === 0.5
                                            ? <><span className="font-mono font-bold text-white">{fmt(row.counted)}</span> of {fmt(row.score)}</>
                                            : <><span className="font-mono font-bold text-white">{fmt(row.counted)}</span> {expected && !past ? 'exp' : 'FPT'}</>}
                            </div>
                            {past
                                ? <DeltaLine delta={row.delta} className="text-[10px]" />
                                : expected && <PriceLine row={row} className="text-[10px]" />}
                            <div className={`mt-auto inline-block whitespace-nowrap text-[9px] font-extrabold tracking-normal sm:tracking-wider uppercase px-1.5 py-0.5 rounded
                                ${row.sixth ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-gray-400'}`}>
                                {row.sixth ? '6th man · 100%' : 'Bench · 50%'}
                            </div>
                        </Tile>
                        {editable && onRemove && (
                            <RemoveButton onClick={() => onRemove(row.key)} className="top-1.5 right-1.5 w-[22px] h-[22px]" />
                        )}
                    </div>
                ))}
                {Array.from({ length: emptyBench }, (_, i) => (
                    <Tile key={`empty-${i}`} dashed onClick={() => onAddPlayers?.('bench')}>
                        <Plus size={16} />
                        <span className="mt-1 text-[11px]">{bench.length === 0 && i === 0 ? '6th man · 100%' : 'Bench · 50%'}</span>
                    </Tile>
                ))}
                {coach ? (
                    <Tile tone="!border-violet-500/30" onClick={editable ? onPickCoach : undefined}>
                        <div className={`${TILE_PHOTO} flex items-center justify-center`}>
                            <div className="absolute w-[88px] h-[88px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.5), rgba(139,92,246,0) 70%)' }} />
                            {crests[coach.code] ? (
                                // Crests are drawn for a light background; many are dark.
                                <span className="relative flex items-center justify-center w-[62px] h-[62px] rounded-full bg-white/90 shadow-lg">
                                    <img src={photoUrl(crests[coach.code], 120)} alt="" className="h-[44px] w-[44px] object-contain" />
                                </span>
                            ) : (
                                <span className="relative text-lg font-extrabold text-violet-200">{initials(coach.player.PlayerName)}</span>
                            )}
                        </div>
                        <div className="mt-0.5 w-full text-[13px] font-extrabold text-white truncate">
                            <span className="mr-1 px-1 rounded bg-violet-500/25 text-violet-300 text-[9px] align-middle">HC</span>
                            {surname(coach.player.PlayerName)}
                        </div>
                        <div className="w-full flex items-center justify-center gap-1 text-[11px] text-gray-400 whitespace-nowrap">
                            {coach.state === 'live' && <LiveDot />}
                            {coach.counted === null
                                ? <span className="truncate"><GameNote row={coach} now={now} /></span>
                                : <><span className="font-mono font-bold text-white">{coach.counted > 0 ? '+' : ''}{fmt(coach.counted)}</span>
                                    <span className="truncate">{coach.note ?? (coach.margin !== null && coach.margin !== undefined ? marginText(coach.margin, coach.state === 'final') : '')}</span></>}
                        </div>
                        {expected && !past && <PriceLine row={coach} className="text-[10px]" />}
                        <div className="mt-auto inline-block text-[9px] font-extrabold tracking-wider uppercase px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-200">
                            Coach
                        </div>
                    </Tile>
                ) : editable ? (
                    <Tile dashed onClick={onPickCoach}>
                        <Plus size={16} />
                        <span className="mt-1 text-[11px]">Coach</span>
                    </Tile>
                ) : null}
            </div>
            {editable && onSwap && group.rows.length > 1 && (
                <p className="text-center text-[11px] text-gray-500">
                    Drag a player onto another to swap them - the first on the bench is the 6th man. Tap one for his details.
                </p>
            )}
        </div>
    );
}
