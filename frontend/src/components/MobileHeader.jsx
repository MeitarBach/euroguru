import React from 'react';

/**
 * Slim branded bar, below md only.
 *
 * The sidebar carries the logo and wordmark on desktop and is hidden on phones, so
 * without this the mobile app opens with no name on it anywhere. Static rather than
 * sticky - the bottom tab bar is what needs to stay put, and two fixed bars would eat
 * a phone screen from both ends.
 */
export default function MobileHeader() {
    return (
        <header className="md:hidden flex items-center gap-2.5 px-4 h-14 border-b border-[#ffffff10] bg-[#0d0d0f]">
            <img src="/guru-mark.png" alt="" className="h-8 w-auto shrink-0" />
            <span className="font-bold text-lg text-white tracking-tight">EuroGuru</span>
        </header>
    );
}
