import React from 'react';
import { LogOut, LogIn } from 'lucide-react';
import { NAV_ITEMS } from '../navigation';
import { useAuth, initialsFor } from '../hooks/authContext';

export default function Sidebar({ activeTab, setActiveTab }) {
    // Opaque, and above the page, rather than the glass-panel it used to be. A 3%-white
    // background is fine for a card sitting on the page, but not for fixed chrome that
    // content can pass beneath: anything scrolled under the sidebar stayed visible
    // through it. #0d0d0f is what that translucent panel already resolved to over the
    // #050507 page, so this looks unchanged - it just no longer shows what is behind it.
    //
    // Hidden below md, where 260px would be two thirds of a phone screen; MobileNav
    // takes over there.
    return (
        <div className="w-64 h-screen fixed left-0 top-0 z-30 border-r border-[#ffffff10] hidden md:flex flex-col p-4 bg-[#0d0d0f]"
            style={{ width: '260px' }}>

            {/* Brand */}
            <div className="flex items-center gap-3 mb-8 px-2 mt-2">
                {/* Served from public/, like every other static asset here, rather than
                    imported as a module. alt is empty on purpose: the <h1> beside it
                    already says "EuroGuru", so a label here would just repeat it. */}
                <img
                    src="/guru-mark.png"
                    alt=""
                    className="h-10 w-auto shrink-0"
                />
                {/* A plan badge sat under this name until there were plans to tell apart.
                    It belongs back here once authentication lands - wrap this h1 and the
                    badge in a div again, which is what stacked them. */}
                <h1 className="font-bold text-xl text-white tracking-tight">EuroGuru</h1>
            </div>

            {/* Menu */}
            <nav className="flex-1 space-y-1">
                {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all duration-200 
                ${isActive
                                    ? 'bg-gradient-to-r from-[#8b5cf680] to-[#8b5cf620] text-white font-medium border border-[#ffffff10]'
                                    : 'text-gray-400 hover:text-white hover:bg-[#ffffff05]'}`}
                        >
                            <Icon size={20} />
                            {item.label}
                        </button>
                    );
                })}
            </nav>

            {/* Footer */}
            <AccountCard />
        </div>
    );
}

/**
 * Who you are, or an invitation to say so.
 *
 * This card showed a hardcoded name and a Sign out button that did nothing until
 * Supabase landed. Hidden entirely when the build has no auth configured, rather than
 * offering a button that cannot work.
 */
function AccountCard() {
    const { user, available, openAuth, signOut } = useAuth();

    if (!available) return null;

    return (
        <div className="pt-4 border-t border-[#ffffff10]">
            {user ? (
                <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-[#00000040]">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-xs font-bold shrink-0">
                        {initialsFor(user)}
                    </div>
                    {/* min-w-0 lets truncate actually bite - a long email would other-
                        wise push the sign-out button off the edge of the sidebar. */}
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" title={user.email}>
                            {user.email}
                        </div>
                        <div className="text-xs text-gray-500">Signed in</div>
                    </div>
                    {/* Was a bare 16px <svg> with a cursor style - not focusable, not
                        announced, and far below a usable tap target. The icon still
                        looks the same; the padding is the hit area. */}
                    <button
                        type="button"
                        onClick={signOut}
                        aria-label="Sign out"
                        className="p-2 -m-1 rounded-lg text-gray-500 hover:text-white hover:bg-[#ffffff08] transition-colors"
                    >
                        <LogOut size={16} />
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={openAuth}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
                               bg-[#ffffff08] border border-[#ffffff10] text-sm font-medium
                               text-gray-300 hover:text-white hover:bg-[#ffffff12] transition-colors"
                >
                    <LogIn size={16} />
                    Sign in
                </button>
            )}
        </div>
    );
}
