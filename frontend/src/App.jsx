import { useState } from 'react';
import Sidebar from './components/Sidebar';
import StatsView from './components/StatsView';
import DashboardView from './components/DashboardView';
import RecommendationsView from './components/RecommendationsView';
import CourtVisionView from './components/CourtVisionView';
import { PlayerDetailProvider } from './hooks/usePlayerDetail';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    // The provider wraps the whole shell, not each view: every tab can open a player,
    // and a view unmounting on a tab switch must not take the modal with it.
    <PlayerDetailProvider>
      <div className="min-h-screen bg-[#050507] text-white flex">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

        <main className="flex-1 ml-[260px] p-8">
          {activeTab === 'dashboard' && <DashboardView />}

          {activeTab === 'stats' && <StatsView />}

          {activeTab === 'viz' && <CourtVisionView />}

          {activeTab === 'recs' && <RecommendationsView />}
        </main>
      </div>
    </PlayerDetailProvider>
  );
}

export default App;
