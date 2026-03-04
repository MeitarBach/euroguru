import { useState } from 'react';
import Sidebar from './components/Sidebar';
import StatsView from './components/StatsView';
import DashboardView from './components/DashboardView';
import RecommendationsView from './components/RecommendationsView';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="min-h-screen bg-[#050507] text-white flex">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 ml-[260px] p-8">
        {activeTab === 'dashboard' && <DashboardView />}

        {activeTab === 'stats' && <StatsView />}

        {activeTab === 'recs' && <RecommendationsView />}
      </main>
    </div>
  );
}

export default App;
