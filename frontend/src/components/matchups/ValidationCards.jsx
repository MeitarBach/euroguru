import React from 'react';

const smaller = (base, adj) => Math.round((1 - adj / base) * 100);

// "Did it work?": the round's played games against the projections made before them.
// An adjustment that makes the error bigger is shown as such - the point of these
// cards is to find out whether the signal deserves trust, not to advertise it.
function ErrorCard({ label, base, adj, note }) {
    const pct = smaller(base, adj);
    const better = pct > 0;
    return (
        <div className="glass-panel p-4">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">{label}</div>
            <div className="mt-1 text-2xl font-semibold">
                <span className="font-mono text-gray-300">{base.toFixed(2)}</span>
                <span className="text-gray-600 mx-2">→</span>
                <span className={`font-mono ${better ? 'text-green-400' : 'text-red-400'}`}>{adj.toFixed(2)}</span>
            </div>
            <div className="mt-1 text-xs text-gray-400">
                {note} <b className={better ? 'text-green-400' : 'text-red-400'}>
                    {better ? `${pct}% smaller` : `${-pct}% bigger`}
                </b>.
            </div>
        </div>
    );
}

export default function ValidationCards({ validation, round, onPickRound, canPickPrevious }) {
    if (!validation) {
        return (
            <div className="glass-panel p-4 text-sm text-gray-400">
                No round {round} game is in the data yet, so there is nothing to check.
                {canPickPrevious && (
                    <> <button className="text-purple-300 hover:text-purple-200 underline underline-offset-2" onClick={() => onPickRound(round - 1)}>
                        See how round {round - 1} went
                    </button>.</>
                )}
            </div>
        );
    }

    const v = validation;
    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ErrorCard
                label="Player FPT error"
                base={v.player_mae_base}
                adj={v.player_mae_adj}
                note={`Average miss per player, season average vs matchup-adjusted (${v.players} players):`}
            />
            <ErrorCard
                label="Position-group error"
                base={v.group_mae_base}
                adj={v.group_mae_adj}
                note={`FPT a team's G / F / C scored together (${v.groups} groups):`}
            />
            <div className="glass-panel p-4">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Called the direction</div>
                <div className="mt-1 text-2xl font-semibold font-mono text-gray-100">{v.direction_hits}/{v.groups}</div>
                <div className="mt-1 text-xs text-gray-400">
                    How often a group finished above or below its own average the way the matchup said.
                    With a strong signal (±15%+): <span className="font-mono text-gray-200">{v.strong_hits}/{v.strong_n}</span>.
                </div>
            </div>
        </div>
    );
}
