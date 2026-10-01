import React from 'react';
import { Lock, Check } from 'lucide-react';
import { useGate } from '../hooks/authContext';
import { accountBenefits } from '../lib/gate';

/**
 * The sign-in pitch shown where a signed-out preview ends.
 *
 * `title` names what is behind the wall ("See all 20 picks"); the same string is
 * handed to the modal so it opens on the thing the user was reaching for.
 */
export function GateWall({ title }) {
    const { unlock } = useGate();
    return (
        <div className="mx-auto max-w-sm text-center px-4">
            <div className="mx-auto mb-3 w-10 h-10 rounded-full flex items-center justify-center
                            bg-purple-500/15 border border-purple-500/30 text-purple-300">
                <Lock size={18} />
            </div>
            <h3 className="font-semibold text-white">{title}</h3>
            {/* Centred as a block, left-aligned inside, so every check shares one edge
                rather than each line centring on its own length. */}
            <ul className="mt-2 inline-flex flex-col items-start space-y-1 text-xs text-gray-400 text-left">
                {accountBenefits().map(b => (
                    <li key={b} className="flex items-center gap-1.5">
                        <Check size={12} className="text-emerald-400 shrink-0" /> {b}
                    </li>
                ))}
            </ul>
            <button
                type="button"
                onClick={() => unlock(title)}
                className="mt-4 px-5 py-2.5 rounded-lg text-sm font-medium text-white
                           bg-gradient-to-r from-purple-600 to-purple-500
                           hover:from-purple-500 hover:to-purple-400 transition-colors"
            >
                Sign in free
            </button>
        </div>
    );
}

/**
 * Fade the blurred rows above it into the wall.
 *
 * Placed in normal flow straight after the content, then pulled up over its tail with
 * a negative margin. An overlay positioned inside the table would need the rows to be
 * a known height, and the game log's rows are not the stats table's.
 */
export function GateFade({ title }) {
    return (
        <div className="relative -mt-32 pt-20 pb-6 bg-gradient-to-b from-transparent via-[#0b0b0dee] to-[#0b0b0d]">
            <GateWall title={title} />
        </div>
    );
}

/**
 * A control that only works signed in.
 *
 * The control still renders, dimmed and inert, so the visitor can see what it would
 * do; a transparent button over it raises the sign-in modal instead.
 */
export function LockedControl({ reason, children, className = '' }) {
    const { locked, unlock } = useGate();
    if (!locked) return children;
    return (
        <div className={`relative ${className}`}>
            <div inert className="opacity-40">{children}</div>
            <button
                type="button"
                onClick={() => unlock(reason)}
                title={reason}
                aria-label={reason}
                className="absolute inset-0 rounded-lg cursor-pointer hover:bg-[#ffffff06] transition-colors"
            >
                <Lock size={11} className="absolute top-0 right-0 text-purple-300" />
            </button>
        </div>
    );
}
