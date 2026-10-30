import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Crown, ArrowDownUp, X, UserRound, ChevronsLeft } from 'lucide-react';
import AnimatedNumber from './AnimatedNumber';
import LiveDot from './LiveDot';
import { GameNote } from './WatchCard';
import { photoUrl } from '../../lib/live/photos';
import { decimalsFor, marginText } from '../../lib/live/format';
import { STARTERS, BENCH } from '../../lib/leagues';

const MotionSpan = motion.span;

// The floor of the team optimizer's card (.claude/skills/euroguru-social/court.html):
// a FIBA half court 15 m wide, basket at the top, drawn at 1088x760.
const W = 1088;
const H = 760;
const S = W / 15; // px per metre
// Where each position's starters stand, basket end first, as a share of the floor's
// height; and the spread of a row of 1-5 players, as a share of its width.
// A figure (photo + plate) is ~210 of the floor's 760 high, so the rows sit far enough
// apart that a guard's head never reaches the plate of the forward in front of him.
const ROW_TOP = { C: 96 / H, F: 312 / H, G: 534 / H };
const SPREAD = {
    1: [0], 2: [-0.175, 0.175], 3: [-0.303, 0, 0.303],
    4: [-0.375, -0.125, 0.125, 0.375], 5: [-0.4, -0.2, 0, 0.2, 0.4],
};
const BUBBLE_MS = 4000;

const fixed = (x) => x.toFixed(decimalsFor(x));
const surname = (name) => String(name ?? '').replace(/\s*\([^)]*\)$/, '').split(' ').slice(1).join(' ') || name;
const initials = (name) => String(name ?? '?').replace(/\s*\([^)]*\)$/, '').split(/[\s.]+/).filter(Boolean)
    .map(w => w[0]).slice(0, 2).join('').toUpperCase();

function CourtLines() {
    const bx = W / 2;
    const by = 1.575 * S;
    const r3 = 6.75 * S;
    const c3 = 0.9 * S;
    const y3 = by + Math.sqrt(r3 ** 2 - (bx - c3) ** 2);
    const line = { fill: 'none', stroke: 'rgba(255,255,255,0.20)', strokeWidth: 2.5 };
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full" aria-hidden="true">
            <rect x={bx - 2.45 * S} y={0} width={4.9 * S} height={5.8 * S}
                fill="rgba(139,92,246,0.16)" stroke="rgba(196,181,253,0.35)" strokeWidth={2.5} />
            <circle cx={bx} cy={5.8 * S} r={1.8 * S} {...line} />
            <path d={`M ${bx - 1.25 * S} ${by} A ${1.25 * S} ${1.25 * S} 0 0 0 ${bx + 1.25 * S} ${by}`} {...line} />
            <line x1={bx - 0.9 * S} y1={1.2 * S} x2={bx + 0.9 * S} y2={1.2 * S} stroke="rgba(255,255,255,0.55)" strokeWidth={4} />
            <circle cx={bx} cy={by} r={0.23 * S} fill="none" stroke="#fb923c" strokeWidth={3.5} />
            <path d={`M ${c3} 0 L ${c3} ${y3} A ${r3} ${r3} 0 0 0 ${W - c3} ${y3} L ${W - c3} 0`} {...line} />
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

/** Captain / bench / remove / details for one player, opened by tapping them. */
function PlayerMenu({ row, onAction, onClose }) {
    const item = 'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-sm hover:bg-white/[0.07]';
    return (
        <>
            <button type="button" aria-label="Close" className="fixed inset-0 z-30 cursor-default" onClick={onClose} />
            <div className="absolute left-1/2 -translate-x-1/2 top-[40%] z-40 w-44 rounded-xl border border-white/10 bg-[#141418] shadow-2xl p-1">
                {!row.benched && (
                    <button type="button" className={`${item} text-amber-200`} onClick={() => onAction('captain')}>
                        <Crown size={14} /> {row.captain ? 'Take the armband' : 'Make captain'}
                    </button>
                )}
                {row.benched && !row.sixth && (
                    <button type="button" className={`${item} text-emerald-200`} onClick={() => onAction('sixth')}>
                        <ChevronsLeft size={14} /> Make 6th man
                    </button>
                )}
                <button type="button" className={`${item} text-gray-200`} onClick={() => onAction('bench')}>
                    <ArrowDownUp size={14} /> {row.benched ? 'Start him' : 'To the bench'}
                </button>
                <button type="button" className={`${item} text-gray-300`} onClick={() => onAction('details')}>
                    <UserRound size={14} /> Player details
                </button>
                <button type="button" className={`${item} text-red-300`} onClick={() => onAction('remove')}>
                    <X size={14} /> Remove
                </button>
            </div>
        </>
    );
}

/** One starter on the floor: photo, name plate, live points. The captain wears gold. */
function Starter({ row, photo, left, top, width, now, lastEvent, menuOpen, onTap, onAction, onClose }) {
    const size = `${width}cqw`;
    return (
        <div className="absolute -translate-x-1/2" style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: size }}>
            <button type="button" onClick={onTap} className="block w-full text-center focus:outline-none group">
                <div className="relative">
                    <Bust url={photoUrl(photo, 240)} name={row.player.PlayerName} captain={row.captain} size={size} />
                    {row.captain && (
                        <span
                            className="absolute right-[16%] top-[4%] rounded-full flex items-center justify-center font-black bg-yellow-400 text-gray-950 shadow-lg"
                            style={{ width: 'max(20px, 3cqw)', height: 'max(20px, 3cqw)', fontSize: 'max(11px, 1.6cqw)' }}
                        >
                            C
                        </span>
                    )}
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
                        ) : (
                            <>
                                <AnimatedNumber value={row.counted} decimals={decimalsFor(row.counted)} className="font-mono font-bold text-white" />
                                <span>FPT{row.captain ? ' ×2' : ''}</span>
                            </>
                        )}
                    </div>
                </div>
            </button>
            {menuOpen && <PlayerMenu row={row} onAction={onAction} onClose={onClose} />}
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
 * A fantasy team on a half court, like the team optimizer's card: the starting five on
 * the floor by position, each with their photo, the captain in gold; under it the
 * sixth man (first on the bench, x1), the rest of the bench (x0.5) and the coach. Every number is live - the counted FPT of the
 * row as the group scores it.
 *
 * `editable` turns a tap into a menu (captain, bench, remove) and shows empty spots to
 * fill; otherwise a tap opens the player's details. `photos` maps PlayerKey to a
 * headshot URL and `crests` a club to its crest (the coach's tile), both from
 * /api/headshots.
 */
export default function TeamCourt({
    group, photos = {}, crests = {}, now, lastEvent, editable = false,
    onToggleCaptain, onToggleBench, onMakeSixth, onRemove, onOpenPlayer, onAddPlayers, onPickCoach,
}) {
    const [menu, setMenu] = useState(null);
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
        ordered.forEach((r, i) => placed.push({ row: r, left: 0.5 + xs[i], top: ROW_TOP[pos], width: ordered.length >= 4 ? 18.5 : 21.7 }));
    }
    const formation = ['G', 'F', 'C'].map(p => rows[p].length).join('-');

    const act = (row, action) => {
        setMenu(null);
        if (action === 'captain') onToggleCaptain?.(row.key);
        else if (action === 'bench') onToggleBench?.(row.key);
        else if (action === 'sixth') onMakeSixth?.(row.key);
        else if (action === 'remove') onRemove?.(row.key);
        else onOpenPlayer?.(row.player.PlayerName);
    };
    const tap = (row) => (editable ? setMenu(m => (m === row.key ? null : row.key)) : onOpenPlayer?.(row.player.PlayerName));
    const emptyBench = editable ? Math.max(0, BENCH - bench.length) : 0;

    return (
        <div className="space-y-3">
            <div
                className="relative w-full rounded-[22px] overflow-hidden border border-violet-400/30"
                style={{
                    aspectRatio: `${W} / ${H}`,
                    containerType: 'inline-size',
                    background: 'radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.28), rgba(139,92,246,0) 60%), linear-gradient(180deg, #15102a 0%, #0c0a16 100%)',
                }}
            >
                <CourtLines />
                <div className="absolute top-[2.4%] left-[2%] font-extrabold uppercase tracking-[0.15em] text-violet-300" style={{ fontSize: 'max(10px, 1.3cqw)' }}>
                    Starting five{starters.length ? <> · <b className="text-white">{formation}</b></> : null}
                    <span className="ml-2 normal-case tracking-normal font-mono text-white">
                        {fixed(starters.reduce((s, r) => s + (r.counted ?? 0), 0))}
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
                        menuOpen={menu === row.key}
                        onTap={() => tap(row)}
                        onAction={(a) => act(row, a)}
                        onClose={() => setMenu(null)}
                    />
                ))}
                {editable && starters.length < STARTERS && (
                    <button
                        type="button"
                        onClick={onAddPlayers}
                        className="absolute bottom-[3%] right-[2.5%] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-violet-400/50 text-violet-200 bg-[#0a0812]/80 hover:bg-violet-500/15"
                        style={{ fontSize: 'max(11px, 1.3cqw)' }}
                    >
                        <Plus size={13} /> {STARTERS - starters.length} starter{STARTERS - starters.length === 1 ? '' : 's'} to pick
                    </button>
                )}
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {bench.map(row => (
                    <div key={row.key} className="relative">
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
                                    : row.factor === 0.5
                                        ? <><span className="font-mono font-bold text-white">{fixed(row.counted)}</span> of {fixed(row.score)}</>
                                        : <><span className="font-mono font-bold text-white">{fixed(row.counted)}</span> FPT</>}
                            </div>
                            <div className={`mt-auto inline-block text-[9px] font-extrabold tracking-wider uppercase px-1.5 py-0.5 rounded
                                ${row.sixth ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-gray-400'}`}>
                                {row.sixth ? '6th man · 100%' : 'Bench · 50%'}
                            </div>
                        </Tile>
                        {menu === row.key && <PlayerMenu row={row} onAction={(a) => act(row, a)} onClose={() => setMenu(null)} />}
                    </div>
                ))}
                {Array.from({ length: emptyBench }, (_, i) => (
                    <Tile key={`empty-${i}`} dashed onClick={onAddPlayers}>
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
                                : <><span className="font-mono font-bold text-white">{coach.counted > 0 ? '+' : ''}{fixed(coach.counted)}</span>
                                    <span className="truncate">{coach.margin !== null && coach.margin !== undefined ? marginText(coach.margin, coach.state === 'final') : ''}</span></>}
                        </div>
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
        </div>
    );
}
