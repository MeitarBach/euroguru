import React, { useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { euroleagueCode } from '../../lib/live/teams';
import { nameMatches } from '../../lib/live/names';
import SearchInput from '../SearchInput';
import { COACH_OUTCOMES, coachExpected, coachScore, pct } from '../../lib/optimizer/score';

const fold = (text) => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const one = (x) => (x === null || x === undefined || Number.isNaN(x) ? '–' : x.toFixed(1));
const PAGE = 60;

const SORTS = {
    exp: { label: 'Expected', key: (r) => r.fpt ?? -Infinity },
    value: { label: 'Exp per CR', key: (r) => (r.cr ? (r.fpt ?? 0) / r.cr : -Infinity) },
    avg: { label: 'Season avg', key: (r) => r.avg ?? -Infinity },
    cr: { label: 'Price', key: (r) => r.cr ?? -Infinity },
};

function Tabs({ value, onChange, options }) {
    return (
        <div className="inline-flex p-0.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs">
            {options.map(([id, label]) => (
                <button
                    key={id}
                    type="button"
                    aria-pressed={value === id}
                    onClick={() => onChange(id)}
                    className={`px-2.5 py-1 rounded-md ${value === id ? 'bg-purple-500/20 text-white font-medium' : 'text-gray-400 hover:text-white'}`}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

/**
 * Every priced player (or coach) with what he is expected to score next round, to add
 * to the lineup or take out of it. `remaining` is the budget left (null = no budget
 * set); "Fits" keeps to players who would not take the team over it. `names` (PlayerKey ->
 * full name, from the headshots) lets the search find "Kendrick" as well as "K. Nunn".
 */
export default function PlayerPool({
    kind: kindProp, onKind, initialKind = 'players', tall = false,
    roster, names, coaches, expected, lineup, remaining, editable, onTogglePlayer, onPickCoach,
}) {
    // Players | Coaches: driven by the page beside the court, or kept here in the modal.
    const [ownKind, setOwnKind] = useState(initialKind);
    const kind = kindProp ?? ownKind;
    const changeKind = onKind ?? setOwnKind;
    const [query, setQuery] = useState('');
    const [position, setPosition] = useState('All');
    const [sort, setSort] = useState('exp');
    const [fits, setFits] = useState(false);
    const [shown, setShown] = useState(PAGE);
    const inTeam = useMemo(() => new Set(lineup.keys), [lineup.keys]);

    const players = useMemo(() => (roster ?? []).map(p => ({
        key: p.PlayerKey,
        player: p,
        fpt: expected.players?.[p.PlayerKey]?.fpt ?? null,
        injury: expected.players?.[p.PlayerKey]?.injury ?? null,
        avg: typeof p.Average_Score === 'number' ? p.Average_Score : null,
        cr: typeof p.CR === 'number' ? p.CR : null,
    })), [roster, expected]);

    const list = useMemo(() => {
        const q = fold(query.trim());
        const by = SORTS[sort].key;
        return players
            .filter(r => position === 'All' || r.player.position === position)
            .filter(r => !q || nameMatches(q, r.player.PlayerName, names?.[r.key]) || fold(euroleagueCode(r.player)) === q)
            .filter(r => !fits || remaining === null || inTeam.has(r.key) || (r.cr ?? 0) <= remaining)
            .sort((a, b) => by(b) - by(a));
    }, [players, names, query, position, sort, fits, remaining, inTeam]);

    const coachList = useMemo(() => (coaches ?? []).map(c => {
        const key = `coach:${c.CoachID}`;
        return { key, coach: c, outlook: expected.coaches?.[key] ?? null, cr: typeof c.CR === 'number' ? c.CR : null };
    // Best most-likely score first; among equals, the likelier win.
    }).sort((a, b) => ((b.outlook?.likely ?? -99) - (a.outlook?.likely ?? -99))
        || ((b.outlook?.win ?? 0) - (a.outlook?.win ?? 0))), [coaches, expected]);

    return (
        <div className="glass-panel p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Tabs value={kind} onChange={changeKind} options={[['players', 'Players'], ['coaches', 'Coaches']]} />
                {remaining !== null && (
                    <span className={`text-xs ${remaining < 0 ? 'text-red-300' : 'text-gray-400'}`}>{one(remaining)} CR left</span>
                )}
            </div>

            {kind === 'players' ? (
                <>
                    <div className="flex flex-col gap-2">
                        <SearchInput
                            value={query}
                            onChange={(v) => { setQuery(v); setShown(PAGE); }}
                            placeholder="Search a player or club code"
                            inputClassName="input-dark w-full py-1.5 text-sm"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                            <Tabs value={position} onChange={(v) => { setPosition(v); setShown(PAGE); }} options={[['All', 'All'], ['G', 'G'], ['F', 'F'], ['C', 'C']]} />
                            <select value={sort} onChange={(e) => setSort(e.target.value)} className="input-dark py-1 text-xs">
                                {Object.entries(SORTS).map(([id, s]) => <option key={id} value={id}>Sort: {s.label}</option>)}
                            </select>
                            {remaining !== null && (
                                <label className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                                    <input type="checkbox" checked={fits} onChange={(e) => setFits(e.target.checked)} /> Fits budget
                                </label>
                            )}
                        </div>
                    </div>
                    {/* On a phone the list flows with the page rather than scrolling in a box of its own. */}
                    <div className={`${tall ? '' : 'sm:max-h-[560px] sm:overflow-y-auto'} -mx-1 px-1 space-y-0.5`}>
                        <div className="grid grid-cols-[1fr_3rem_3rem] sm:grid-cols-[1fr_3.5rem_3.5rem_3rem] gap-2 px-2.5 pb-1 text-[10px] uppercase tracking-wider text-gray-600">
                            <span>Player</span><span className="text-right">Exp</span><span className="hidden sm:block text-right">Avg</span><span className="text-right">CR</span>
                        </div>
                        {list.slice(0, shown).map(r => {
                            const selected = inTeam.has(r.key);
                            return (
                                <button
                                    key={r.key}
                                    type="button"
                                    disabled={!editable}
                                    onClick={() => onTogglePlayer(r.key)}
                                    aria-pressed={selected}
                                    className={`w-full grid grid-cols-[1fr_3rem_3rem] sm:grid-cols-[1fr_3.5rem_3.5rem_3rem] items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-sm border transition-colors
                                        ${selected ? 'bg-purple-500/15 border-purple-500/40' : 'border-transparent enabled:hover:bg-white/[0.04]'}`}
                                >
                                    <span className="min-w-0 flex items-center gap-2">
                                        <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${selected ? 'bg-purple-500 border-purple-500 text-white' : 'border-white/20 text-gray-600'}`}>
                                            {selected ? <Check size={11} strokeWidth={3} /> : <Plus size={10} />}
                                        </span>
                                        <span className="min-w-0">
                                            <span className={`block truncate ${selected ? 'text-white font-medium' : 'text-gray-200'}`}>{r.player.PlayerName}</span>
                                            <span className="block text-[11px] text-gray-500">
                                                {r.player.position} · {euroleagueCode(r.player)}
                                                {r.injury && <span className={String(r.injury).toUpperCase().startsWith('OUT') ? 'text-red-300' : 'text-amber-300'}> · {String(r.injury).toUpperCase().startsWith('OUT') ? 'OUT' : 'GTD'}</span>}
                                            </span>
                                        </span>
                                    </span>
                                    <span className="text-right font-mono text-white tabular-nums">{one(r.fpt)}</span>
                                    {/* A phone shows Exp and CR only: the name needs the room. */}
                                    <span className="hidden sm:block text-right font-mono text-gray-400 tabular-nums">{one(r.avg)}</span>
                                    <span className="text-right font-mono text-gray-400 tabular-nums">{one(r.cr)}</span>
                                </button>
                            );
                        })}
                        {!list.length && <p className="px-2.5 py-3 text-sm text-gray-500">Nobody matches.</p>}
                        {list.length > shown && (
                            <button type="button" onClick={() => setShown(n => n + PAGE)} className="w-full py-2 text-xs text-purple-300 hover:text-purple-200">
                                Show more ({list.length - shown})
                            </button>
                        )}
                    </div>
                </>
            ) : (
                <div className="space-y-0.5">
                    <div className="grid grid-cols-[1fr_4rem_3rem_2.5rem] sm:grid-cols-[1fr_4.5rem_3.5rem_3rem] gap-2 px-2.5 pb-1 text-[10px] uppercase tracking-wider text-gray-600">
                        <span>Coach</span><span>Next</span>
                        <span className="text-right" title="The score he most likely makes, and its chance">Likely</span>
                        <span className="text-right">CR</span>
                    </div>
                    {coachList.map(c => {
                        const selected = lineup.coach === c.key;
                        return (
                            <button
                                key={c.key}
                                type="button"
                                disabled={!editable}
                                onClick={() => onPickCoach(c.key)}
                                aria-pressed={selected}
                                className={`w-full grid grid-cols-[1fr_4rem_3rem_2.5rem] sm:grid-cols-[1fr_4.5rem_3.5rem_3rem] items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-sm border transition-colors
                                    ${selected ? 'bg-purple-500/15 border-purple-500/40' : 'border-transparent enabled:hover:bg-white/[0.04]'}`}
                            >
                                <span className="min-w-0">
                                    <span className={`block truncate ${selected ? 'text-white font-medium' : 'text-gray-200'}`}>{c.coach.CoachName}</span>
                                    <span className="block text-[11px] text-gray-500">{c.coach.TeamCode}</span>
                                </span>
                                <span className="text-xs text-gray-400">
                                    {c.outlook?.opp ? (
                                        <>
                                            <span className="block">{c.outlook.home ? 'vs' : '@'} {c.outlook.opp}</span>
                                            <span className="block text-[11px] text-gray-500">{pct(c.outlook.win)} win</span>
                                        </>
                                    ) : 'No game'}
                                </span>
                                <span className="text-right" title={c.outlook?.dist ? COACH_OUTCOMES.map(p => `${coachScore(p)}: ${pct(c.outlook.dist[String(p)])}`).join('  ') : undefined}>
                                    <span className="block font-mono text-white tabular-nums">{coachScore(coachExpected(c.outlook))}</span>
                                    {c.outlook?.opp && <span className="block text-[11px] text-gray-500 tabular-nums">{pct(c.outlook.chance)}</span>}
                                </span>
                                <span className="text-right font-mono text-gray-400 tabular-nums">{one(c.cr)}</span>
                            </button>
                        );
                    })}
                    {!coachList.length && <p className="px-2.5 py-3 text-sm text-gray-500">The coaches aren't loaded yet.</p>}
                </div>
            )}
        </div>
    );
}
