import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Users, PlusCircle, FileDown, Star, Settings, Rss, Megaphone, Wand2, Activity, Newspaper } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import JournalistsList from './pages/JournalistsList';
import JournalistDetail from './pages/JournalistDetail';
import JournalistForm from './pages/JournalistForm';
import ExportPage from './pages/ExportPage';
import AdminPublications from './pages/AdminPublications';
import AdminJournalistSuggestions from './pages/AdminJournalistSuggestions';
import CampaignList from './pages/CampaignList';
import CampaignDetail from './pages/CampaignDetail';
import CampaignStyles from './pages/CampaignStyles';
import ActivityFeed from './pages/ActivityFeed';
import PublicationDetail from './pages/PublicationDetail';
import CoveragePage from './pages/CoveragePage';
import { suggestions as suggestApi, journalistSuggestions as jSuggestApi } from './api';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/journalists', label: 'Journalists', icon: Users },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/activity', label: 'Activity Feed', icon: Activity },
  { to: '/coverage', label: 'Press Coverage', icon: Newspaper },
];

const adminItems = [
  { to: '/admin/publications', label: 'Publications', icon: Settings },
  { to: '/admin/journalist-suggestions', label: 'RSS Suggestions', icon: Rss },
  { to: '/campaigns/styles', label: 'House Style', icon: Wand2 },
  { to: '/export', label: 'Export Data', icon: FileDown },
];

export default function App() {
  const [suggestionCount, setSuggestionCount] = useState(0);
  const [jSuggestionCount, setJSuggestionCount] = useState(0);

  useEffect(() => {
    const fetchCounts = () => {
      suggestApi.count().then(r => setSuggestionCount(r.data.count)).catch(() => {});
      jSuggestApi.count().then(r => setJSuggestionCount(r.data.count)).catch(() => {});
    };
    fetchCounts();
    const interval = setInterval(fetchCounts, 60_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex bg-slate-50" style={{ margin: 0, minHeight: '100vh', width: '100%' }}>
      <aside className="w-60 bg-northstar-900 text-white flex flex-col shrink-0 fixed inset-y-0 left-0 z-10">
        <div className="p-5 border-b border-northstar-700">
          <div className="flex items-center gap-2.5">
            <Star className="w-5 h-5 text-yellow-300" fill="currentColor" />
            <div>
              <div className="font-bold text-sm leading-tight">North Star AI Labs</div>
              <div className="text-northstar-300 text-xs mt-0.5">Media Dossiers</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/journalists/new' ? false : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-northstar-600 text-white'
                    : 'text-northstar-200 hover:bg-northstar-800 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 pb-2 pt-3 border-t border-northstar-700">
          <div className="text-northstar-400 text-xs px-3 pb-1 uppercase tracking-wider">Admin</div>
          {adminItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-northstar-600 text-white'
                    : 'text-northstar-200 hover:bg-northstar-800 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
              {label === 'Publications' && suggestionCount > 0 && (
                <span className="ml-auto bg-amber-400 text-amber-900 text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {suggestionCount}
                </span>
              )}
              {label === 'RSS Suggestions' && jSuggestionCount > 0 && (
                <span className="ml-auto bg-emerald-400 text-emerald-900 text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {jSuggestionCount}
                </span>
              )}
            </NavLink>
          ))}
        </div>
        <div className="p-4 border-t border-northstar-700 text-northstar-400 text-xs">
          MVP v1.0 · Local SQLite storage
        </div>
      </aside>

      <main className="flex-1 ml-60 overflow-auto min-h-screen">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/journalists" element={<JournalistsList />} />
          <Route path="/journalists/new" element={<JournalistForm />} />
          <Route path="/journalists/:id" element={<JournalistDetail />} />
          <Route path="/journalists/:id/edit" element={<JournalistForm />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/campaigns" element={<CampaignList />} />
          <Route path="/campaigns/styles" element={<CampaignStyles />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/activity" element={<ActivityFeed />} />
          <Route path="/coverage" element={<CoveragePage />} />
          <Route path="/admin/publications/:id" element={<PublicationDetail />} />
          <Route path="/admin/publications" element={<AdminPublications />} />
          <Route path="/admin/journalist-suggestions" element={<AdminJournalistSuggestions />} />
        </Routes>
      </main>
    </div>
  );
}
