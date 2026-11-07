import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import PlayerPool from './PlayerPool';
import { STARTERS, BENCH } from '../../lib/teams';

const TITLE = { starter: 'Pick your starters', bench: 'Pick your bench', coach: 'Pick a coach' };

/**
 * The player list, opened over the page from an empty spot on the court: the free spot
 * says what is being picked (a starter, a bench player or the coach), and the list stays
 * open while you fill the rest - a coach, being one, closes it.
 */
export default function PickerModal({ role, lineup, onClose, onPickPlayer, onPickCoach, ...pool }) {
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        // The page behind stays put while the list scrolls.
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = overflow;
        };
    }, [onClose]);

    const starters = lineup.keys.length - lineup.bench.length;
    const kind = role === 'coach' ? 'coaches' : 'players';

    return (
        <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-0 sm:p-6"
            onClick={onClose}
        >
            <div
                className="w-full max-w-3xl my-0 sm:my-8 min-h-screen sm:min-h-0 rounded-none sm:rounded-2xl bg-[#0d0d12] border border-white/10 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 sm:px-5 pt-4 pb-3 bg-[#0d0d12] border-b border-white/5 rounded-t-2xl">
                    <div>
                        <h2 className="text-lg font-bold text-white">{TITLE[role] ?? 'Pick players'}</h2>
                        <p className="text-xs text-gray-400 mt-0.5">
                            Starters {starters}/{STARTERS} · Bench {lineup.bench.length}/{BENCH} · {lineup.coach ? 'Coach picked' : 'No coach yet'}
                            {role === 'bench' && ' · new picks go to the bench'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button type="button" onClick={onClose} className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-white bg-purple-600 hover:bg-purple-500">
                            Done
                        </button>
                        <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5">
                            <X size={18} />
                        </button>
                    </div>
                </div>
                <div className="p-2 sm:p-3">
                    <PlayerPool
                        {...pool}
                        lineup={lineup}
                        initialKind={kind}
                        tall
                        onTogglePlayer={onPickPlayer}
                        onPickCoach={(key) => { onPickCoach(key); onClose(); }}
                    />
                </div>
            </div>
        </div>
    );
}
