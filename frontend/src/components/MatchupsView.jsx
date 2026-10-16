import React, { useEffect, useMemo, useState } from 'react';
import { fetchDefenseVsPosition } from '../services/api';
import { useOpenPlayer } from '../hooks/playerDetailContext';
import { useGate } from '../hooks/authContext';
import { LockedControl } from './Gate';
import InfoTip from './InfoTip';
import { CURRENT_SEASON } from '../seasons';
import SoftestCards from './matchups/SoftestCards';
import DefenseTable from './matchups/DefenseTable';
import ValidationCards from './matchups/ValidationCards';
import FixtureCard from './matchups/FixtureCard';
import MatchupBoost from './matchups/MatchupBoost';

const METHOD = [
    'Every player line of the season, grouped by the opponent and the player\'s position (G / F / C).',
    'Per 36 min is the fairer view: FPT allowed to a position ÷ minutes played there × 36. Per game also depends on how many players of each position opponents use.',
    'A round is built only from the rounds before it, so once its games are played it doubles as a test of the numbers.',
    'Early in the season every team has only a few games, and the numbers also reflect who they have played. Treat it as a tiebreaker.',
].join(' ');

function Section({ title, info, subtitle, children }) {
    return (
        <section className="space-y-3">
            <div>
                <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                    {title}
                    {info && <InfoTip text={info} />}
                </h3>
                {subtitle && <p className="text-sm text-gray-400">{subtitle}</p>}
            </div>
            {children}
        </section>
    );
}

export default function MatchupsView() {
    const { locked, unlock } = useGate();
    const openPlayer = useOpenPlayer();
    // null asks for the round in progress (or the next one); the response names it.
    const [round, setRound] = useState(null);
    const [data, setData] = useState(undefined);

    // A signed-out visitor sees the current round only; signing out resets the pick.
    const shownRound = locked ? null : round;

    useEffect(() => {
        let cancelled = false;
        fetchDefenseVsPosition(CURRENT_SEASON, shownRound).then(d => {
            if (!cancelled) setData(d);
        });
        return () => { cancelled = true; };
    }, [shownRound]);

    const teamIndex = useMemo(
        () => Object.fromEntries((data?.teams ?? []).map(t => [t.code, t])),
        [data]
    );
    const open = name => openPlayer(name, CURRENT_SEASON);

    if (data === undefined) {
        return <div className="text-gray-400 text-sm py-12 text-center">Loading matchups…</div>;
    }
    if (data === null) {
        return (
            <div className="glass-panel p-8 text-center text-gray-400">
                Matchups aren't available right now. They're rebuilt by each data run, starting once the season's first round is played.
            </div>
        );
    }

    const R = data.round;
    const status = R < data.current_round ? 'final' : data.fixtures.some(f => f.played) ? 'in progress' : 'upcoming';
    const done = data.fixtures.filter(f => f.played).length;

    return (
        <div className="space-y-8">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold">Matchups</h2>
                    <p className="text-gray-400 text-sm">
                        Defense vs position: who gives up fantasy points to guards, forwards and centers, and what it means for round {R}.
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                        Round {R} {status} · built on rounds {data.based_on[0]}–{data.based_on[1]} · {data.games} games · {data.player_lines} player lines
                    </p>
                </div>
                <LockedControl reason="Look back at past rounds">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Round</label>
                        <select
                            value={R}
                            onChange={e => setRound(parseInt(e.target.value, 10))}
                            className="input-dark bg-[#0a0a0c] min-w-[190px] text-purple-400 font-medium"
                        >
                            {[...data.rounds_available].reverse().map(r => (
                                <option key={r} value={r}>
                                    Round {r}{r === data.current_round ? ' (current)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                </LockedControl>
            </header>

            <SoftestCards teams={data.teams} league={data.league} />

            <Section
                title="Who gives up the most, by position"
                info={METHOD}
                subtitle="FPT the opponent's guards, forwards and centers scored against each team. Green = soft defense (a good matchup), red = tough. Click a team for its game-by-game breakdown."
            >
                <DefenseTable teams={data.teams} league={data.league} locked={locked} unlock={unlock} openPlayer={open} />
            </Section>

            <Section
                title={`Did it work? Round ${R}${data.validation ? ` (${done} of ${data.fixtures.length} games)` : ''}`}
                subtitle="Round-by-round test: the projections above never saw this round's games. Each check compares doing nothing (the team's or player's own average) with that average adjusted for the opponent."
            >
                <ValidationCards
                    validation={data.validation}
                    round={R}
                    canPickPrevious={!locked && data.rounds_available.includes(R - 1)}
                    onPickRound={setRound}
                />
            </Section>

            <Section
                title={`Round ${R} matchups`}
                subtitle="Chips show the defense each side faces, per position, against the league (+% = allows more than average)."
            >
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {data.fixtures.map(f => (
                        <FixtureCard key={f.game_code} fixture={f} teams={teamIndex} league={data.league} />
                    ))}
                </div>
            </Section>

            <Section
                title={`Round ${R} matchup boost`}
                info="Season FPT × how soft the opponent is at the player's position (FPT/36 allowed ÷ league). Players with 15+ minutes and 2+ games. A single multiplier, not the EuroGuru model - it shows the size of the matchup effect."
                subtitle="Who the matchup lifts most this round. Actual fills in as the games are played (PIR, +10% for a win)."
            >
                <MatchupBoost picks={data.picks} locked={locked} openPlayer={open} />
            </Section>
        </div>
    );
}
