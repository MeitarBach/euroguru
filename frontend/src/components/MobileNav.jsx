import React from 'react';
import { NAV_ITEMS } from '../navigation';

/**
 * Bottom tab bar, below md only.
 *
 * The desktop sidebar is 260px of a phone's ~390px, so it hides and this takes over.
 * A bottom bar rather than a hamburger because there are exactly four destinations and
 * they stay one tap away, at the reachable end of the screen.
 *
 * Opaque for the same reason the sidebar is: content scrolls underneath it.
 */
export default function MobileNav({ activeTab, setActiveTab }) {
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
                        <Icon size={20} />
                        <span className="text-[10px] font-medium leading-none">{item.short}</span>
                    </button>
                );
            })}
        </nav>
    );
}
