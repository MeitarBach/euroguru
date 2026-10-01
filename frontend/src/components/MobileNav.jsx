import React from 'react';
import { Lock } from 'lucide-react';
import { NAV_ITEMS } from '../navigation';
import { useGate } from '../hooks/authContext';
import useGameOn from '../hooks/useGameOn';
import LiveDot from './live/LiveDot';

/**
 * Bottom tab bar, below md only.
 *
 * The desktop sidebar is 260px of a phone's ~390px, so it hides and this takes over.
 * A bottom bar rather than a hamburger because there are only five destinations and
 * they stay one tap away, at the reachable end of the screen.
 *
 * Opaque for the same reason the sidebar is: content scrolls underneath it.
 */
export default function MobileNav({ activeTab, setActiveTab }) {
    const { locked } = useGate();
    const gameOn = useGameOn();
    return (
        <nav
            className="md:hidden fixed bottom-0 inset-x-0 z-40 flex border-t border-[#ffffff10]
                       bg-[#0d0d0f] pb-[env(safe-area-inset-bottom)]"
            aria-label="Main"
        >
            {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                    <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        aria-current={isActive ? 'page' : undefined}
                        // min-h-14 keeps every target comfortably past the ~44px floor
                        // even though the label is 10px.
                        className={`flex-1 min-h-14 flex flex-col items-center justify-center gap-1 py-2
                                    transition-colors ${isActive
                                ? 'text-purple-300'
                                : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <span className="relative">
                            <Icon size={20} />
                            {item.id === 'live' && gameOn && (
                                <span className="absolute -top-0.5 -right-1.5"><LiveDot /></span>
                            )}
                            {locked && item.gated && (
                                <Lock size={9} className="absolute -top-1 -right-2 text-gray-500" aria-label="Preview until you sign in" />
                            )}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] font-medium leading-none">
                            {item.short}
                            {item.badge && (
                                <span className="px-1 py-px rounded-sm text-[7px] font-bold uppercase tracking-wide bg-purple-500/25 text-purple-200">
                                    {item.badge}
                                </span>
                            )}
                        </span>
                    </button>
                );
            })}
        </nav>
    );
}
