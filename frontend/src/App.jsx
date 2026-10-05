import { useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import MobileHeader from './components/MobileHeader';
import StatsView from './components/StatsView';
import DashboardView from './components/DashboardView';
import RecommendationsView from './components/RecommendationsView';
import CourtVisionView from './components/CourtVisionView';
import LiveView from './components/LiveView';
import { PlayerDetailProvider } from './hooks/usePlayerDetail';
import { AuthProvider } from './hooks/useAuth';

function App() {
  // An invite link (?join=) is about the Live tab, so it opens there.
  const [activeTab, setActiveTab] = useState(() => (new URLSearchParams(window.location.search).has('join') ? 'live' : 'dashboard'));
  // Live is the one view that stays mounted once opened: it polls the games, and its
  // feed and sparklines are built up over the evening, so leaving it for the stats
  // table and coming back should not start it over.
  const [liveMounted, setLiveMounted] = useState(() => new URLSearchParams(window.location.search).has('join'));
  const selectTab = (tab) => {
    if (tab === 'live') setLiveMounted(true);
    setActiveTab(tab);
  };

  return (
    // AuthProvider is outermost because the sidebar and the header both read the
    // session, and it is not a gate: every tab below renders signed out, which is what
    // keeps the free half of the app free. Signing in will unlock the paid parts
    // later; it is not the price of entry.
    <AuthProvider>
    {/* The provider wraps the whole shell, not each view: every tab can open a player,
        and a view unmounting on a tab switch must not take the modal with it. */}
    <PlayerDetailProvider>
      <div className="min-h-screen bg-[#050507] text-white flex">
        <Sidebar activeTab={activeTab} setActiveTab={selectTab} />

        {/* min-w-0 is load-bearing. A flex item defaults to min-width:auto, so it
            refuses to shrink below its content: a wide stats table stretched this
            element past the viewport, the whole page scrolled sideways, and the rows
            slid underneath the fixed sidebar. With it, the table's own overflow-x-auto
            scrolls internally and the page never scrolls horizontally at all.

            The margin matches the sidebar and disappears with it below md, where the
            content takes the full width. pb-24 is the bottom tab bar's clearance - the
            last row of a table would otherwise sit under it. */}
        <main className="flex-1 min-w-0 ml-0 md:ml-[260px] pb-24 md:pb-8">
          <MobileHeader />

          <div className="p-4 md:p-8">
            {activeTab === 'dashboard' && <DashboardView />}

            {liveMounted && (
              <div hidden={activeTab !== 'live'}>
                <LiveView />
              </div>
            )}

            {activeTab === 'stats' && <StatsView />}

            {activeTab === 'viz' && <CourtVisionView />}

            {activeTab === 'recs' && <RecommendationsView />}
          </div>
        </main>

        <MobileNav activeTab={activeTab} setActiveTab={selectTab} />
      </div>
    </PlayerDetailProvider>
    <Analytics />
    </AuthProvider>
  );
}

export default App;
