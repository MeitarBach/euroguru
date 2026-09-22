import React from 'react';
import { LayoutDashboard, Users, TrendingUp, ScatterChart, LogOut } from 'lucide-react';

export default function Sidebar({ activeTab, setActiveTab }) {
    const menu = [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'stats', label: 'Player Stats', icon: Users },
        { id: 'viz', label: 'Court Vision', icon: ScatterChart },
    { id: 'recs', label: 'Recommendations', icon: TrendingUp },
    ];

    return (
        <div className="w-64 h-screen fixed left-0 top-0 glass-panel border-r border-[#ffffff10] flex flex-col p-4"
            style={{ width: '260px', borderRadius: '0' }}>

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
                {menu.map((item) => {
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
            <div className="pt-4 border-t border-[#ffffff10]">
                <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-[#00000040]">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-xs font-bold">
                        MB
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">Meitar Bach</div>
                        <div className="text-xs text-gray-500">Pro Plan</div>
                    </div>
                    <LogOut size={16} className="text-gray-500 cursor-pointer hover:text-white" />
                </div>
            </div>
        </div>
    );
}
