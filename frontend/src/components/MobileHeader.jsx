import React from 'react';
import { LogOut, LogIn } from 'lucide-react';
import { useAuth, initialsFor } from '../hooks/authContext';

/**
 * Slim branded bar, below md only.
 *
 * The sidebar carries the logo and wordmark on desktop and is hidden on phones, so
 * without this the mobile app opens with no name on it anywhere. It also carries the
 * account control, for the same reason: the sidebar's copy is hidden here, so this is
 * the only way to sign in on a phone.
 *
 * Sticky, which it did not used to be. While this bar was only branding, letting it
 * scroll away was the right trade - two pinned bars eat a phone screen from both ends,
 * and the bottom tab bar is the one that has to stay reachable. Putting the account
 * button up here quietly changed that calculation and the comment here kept arguing
 * the old side: scroll down the dashboard and the only Sign in control on the whole
 * page was gone, with no way back to it but scrolling to the very top. 56px of pinned
 * header is a cheaper price than a sign-in button you have to hunt for.
 *
 * z-30 sits under MobileNav (z-40) and the modals (z-50), and above page content.
 */
export default function MobileHeader() {
    const { user, available, openAuth, signOut } = useAuth();

    return (
        <header className="md:hidden sticky top-0 z-30 flex items-center gap-2.5 px-4 h-14 border-b border-[#ffffff10] bg-[#0d0d0f]">
            <img src="/guru-mark.png" alt="" className="h-8 w-auto shrink-0" />
            <span className="font-bold text-lg text-white tracking-tight">EuroGuru</span>

            {available && (
                <div className="ml-auto flex items-center gap-1.5">
                    {user ? (
                        <>
                            <div
                                className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-xs font-bold"
                                title={user.email}
                            >
                                {initialsFor(user)}
                            </div>
                            <button
                                type="button"
                                onClick={signOut}
                                aria-label="Sign out"
                                className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-[#ffffff08] transition-colors"
                            >
                                <LogOut size={16} />
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={openAuth}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#ffffff08]
                                       border border-[#ffffff10] text-xs font-medium text-gray-300
                                       hover:text-white transition-colors"
                        >
                            <LogIn size={14} />
                            Sign in
                        </button>
                    )}
                </div>
            )}
        </header>
    );
}
