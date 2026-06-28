import { useEffect, useState } from 'react';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, ExternalLink, Check, X,
  Sparkles, RefreshCw, History, ChevronUp, ChevronDown,
  Globe, ChevronRight, Rss, AlertCircle, HelpCircle, ScanLine,
  BookOpen, Search, TriangleAlert, Upload, Layers, Zap, Users,
} from 'lucide-react';
import { publications as pubApi, suggestions as suggestApi, journalistSuggestions as jSuggestApi, healthCheck as healthApi } from '../api';
import type { Publication, PublicationSuggestion, PublicationFeed } from '../types';

// ─── Tier config ─────────────────────────────────────────────────────────────

const TIER_CONFIG = {
  A: {
    label: 'Major Tech & AI',
    pill: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
    accent: 'border-indigo-400',
    bg: 'bg-indigo-50',
    text: 'text-indigo-700',
    dot: 'bg-indigo-400',
    description: 'Large-audience national publications where AI and tech is the primary editorial beat.',
    examples: 'TechCrunch, Wired, MIT Technology Review, The Verge, VentureBeat',
    when: 'Product launches, funding rounds, research breakthroughs — anything with broad industry reach.',
  },
  B: {
    label: 'Business / Mid-Tier',
    pill: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
    accent: 'border-sky-400',
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    dot: 'bg-sky-400',
    description: 'Business publications with dedicated tech or AI desks. Audience skews executive and investor.',
    examples: 'Forbes Technology, Fortune Tech, Fast Company, Bloomberg Technology, WSJ Tech',
    when: 'Funding announcements, leadership profiles, enterprise AI adoption stories.',
  },
  C: {
    label: 'Regional & Niche',
    pill: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
    accent: 'border-slate-400',
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    dot: 'bg-slate-400',
    description: 'Regional outlets (especially Southeast US), AI newsletters, and emerging vertical publications.',
    examples: 'Hypepotamus, Atlanta Business Chronicle, AJC, GeekWire, AI newsletters',
    when: 'Local ecosystem stories, community announcements. Not lower priority — just more targeted.',
  },
} as const;

type Tier = keyof typeof TIER_CONFIG;

const TierPill = ({ tier, showLabel = false }: { tier: Tier; showLabel?: boolean }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${TIER_CONFIG[tier].pill}`}>
    {tier}{showLabel && <span className="font-normal opacity-70">· {TIER_CONFIG[tier].label}</span>}
  </span>
);

// ─── Empty form ───────────────────────────────────────────────────────────────

// RSS status badge
const RSS_STATUS = {
  active:   { label: 'Active',   cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200',  icon: Rss },
  inactive: { label: 'Failed',   cls: 'bg-red-50 text-red-600 ring-red-200',              icon: AlertCircle },
  none:     { label: 'No RSS',   cls: 'bg-slate-100 text-slate-400 ring-slate-200',       icon: X },
  unknown:  { label: 'Unknown',  cls: 'bg-amber-50 text-amber-600 ring-amber-200',        icon: HelpCircle },
};

function RssStatusBadge({ status }: { status: string }) {
  const s = RSS_STATUS[status as keyof typeof RSS_STATUS] ?? RSS_STATUS.unknown;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${s.cls}`}>
      <Icon className="w-3 h-3" /> {s.label}
    </span>
  );
}

const empty = { name: '', url: '', tier: 'B' as Tier, focus: '', notes: '', rssUrl: '', active: 1 };

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminPublications() {
  const [pubs, setPubs]             = useState<Publication[]>([]);
  const [suggestions, setSuggestions] = useState<PublicationSuggestion[]>([]);
  const [editingId, setEditingId]   = useState<number | null>(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [form, setForm]             = useState({ ...empty });
  const [saving, setSaving]         = useState(false);
  const [runningJob, setRunningJob] = useState(false);
  const [sortCol, setSortCol]       = useState<'name' | 'tier' | 'active'>('tier');
  const [sortAsc, setSortAsc]       = useState(true);
  const [filterTier, setFilterTier] = useState<string>('');
  const [showTierGuide, setShowTierGuide] = useState(false);
  const [showHistory, setShowHistory]     = useState(false);
  const [history, setHistory]       = useState<PublicationSuggestion[]>([]);
  const [acceptingId, setAcceptingId]   = useState<number | null>(null);
  const [rejectingId, setRejectingId]   = useState<number | null>(null);
  const [scanningId, setScanningId]             = useState<number | null>(null);
  const [staffScanningId, setStaffScanningId]   = useState<number | null>(null);
  const [discoveringFeedsId, setDiscoveringFeedsId] = useState<number | null>(null);
  const [feedsDiscoveryResult, setFeedsDiscoveryResult] = useState<{ pubName: string; added: number } | null>(null);
  const [expandedFeedsPubId, setExpandedFeedsPubId] = useState<number | null>(null);
  const [pubFeeds, setPubFeeds] = useState<Record<number, PublicationFeed[]>>({});
  const [manualFeedUrl, setManualFeedUrl] = useState('');
  const [manualFeedLabel, setManualFeedLabel] = useState('');
  const [addingFeed, setAddingFeed] = useState(false);
  const [staffScanResult, setStaffScanResult] = useState<{ pubName: string; added: number; pageScanned: string | null; error?: string } | null>(null);
  const [discoveringRssId, setDiscoveringRssId] = useState<number | null>(null);
  const [jSuggestionCount, setJSuggestionCount] = useState(0);
  const [opmlImporting, setOpmlImporting] = useState(false);
  const [opmlResult, setOpmlResult] = useState<{ added: number; total: number; skippedDuplicate: number; preview: string[]; message: string; error?: string } | null>(null);
  const opmlInputRef = useRef<HTMLInputElement>(null);
  const [healthWarnings, setHealthWarnings] = useState<{ unreachable: any[]; stale: any[]; inactiveFeeds: any[] }>({ unreachable: [], stale: [], inactiveFeeds: [] });

  // Blog discovery
  const [showDiscover, setShowDiscover]     = useState(false);
  const [discoverQuery, setDiscoverQuery]   = useState('AI startup machine learning');
  const [discovering, setDiscovering]       = useState(false);
  const [discoverResults, setDiscoverResults] = useState<any[]>([]);
  const [discoverError, setDiscoverError]   = useState('');
  const [addingDiscover, setAddingDiscover] = useState<string | null>(null); // url being added

  const loadPubs        = () => pubApi.list().then(r => setPubs(r.data));
  const loadSuggestions = () => suggestApi.list().then(r => setSuggestions(r.data));
  const loadJCount      = () => jSuggestApi.count().then(r => setJSuggestionCount(r.data.count)).catch(() => {});
  const loadHealth      = () => healthApi.summary().then(r => setHealthWarnings(r.data)).catch(() => {});

  useEffect(() => { loadPubs(); loadSuggestions(); loadJCount(); loadHealth(); }, []);

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const startEdit = (p: Publication) => {
    setEditingId(p.id);
    setForm({ name: p.name, url: p.url, tier: p.tier, focus: p.focus, notes: p.notes || '', active: p.active });
    setShowAdd(false);
  };
  const cancelEdit = () => { setEditingId(null); setForm({ ...empty }); };

  const handleSave = async () => {
    if (!form.name.trim()) return alert('Name is required');
    setSaving(true);
    try {
      if (editingId) { await pubApi.update(editingId, form); setEditingId(null); }
      else           { await pubApi.create(form); setShowAdd(false); }
      setForm({ ...empty });
      loadPubs();
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this publication? Journalists linked to it will keep their existing publication text.')) return;
    await pubApi.delete(id);
    loadPubs();
  };

  const toggleActive = async (p: Publication) => {
    await pubApi.update(p.id, { active: p.active ? 0 : 1 });
    loadPubs();
  };

  const handleAccept = async (s: PublicationSuggestion) => {
    setAcceptingId(s.id);
    await suggestApi.accept(s.id);
    await Promise.all([loadPubs(), loadSuggestions()]);
    setAcceptingId(null);
  };

  const handleReject = async (s: PublicationSuggestion) => {
    setRejectingId(s.id);
    await suggestApi.reject(s.id);
    await loadSuggestions();
    setRejectingId(null);
  };

  const handleScanRss = async (p: Publication) => {
    if (!p.rssUrl) return alert('No RSS URL set for this publication. Edit it to add one.');
    setScanningId(p.id);
    await jSuggestApi.scanPublication(p.id);
    setTimeout(async () => {
      await Promise.all([loadPubs(), loadJCount()]);
      setScanningId(null);
    }, 3000);
  };

  const handleStaffScan = async (p: Publication) => {
    if (!p.url) return alert('No homepage URL set for this publication.');
    setStaffScanningId(p.id);
    setStaffScanResult(null);
    try {
      const res = await jSuggestApi.staffScan(p.id);
      setStaffScanResult({ pubName: p.name, added: res.data.added, pageScanned: res.data.pageScanned, error: res.data.error });
      await loadJCount();
    } finally {
      setStaffScanningId(null);
    }
  };

  const handleDiscoverRss = async (p: Publication) => {
    setDiscoveringRssId(p.id);
    await pubApi.update(p.id, {}); // triggers backend discovery via PUT
    setTimeout(async () => { await loadPubs(); setDiscoveringRssId(null); }, 6000);
  };

  const handleDiscoverFeeds = async (p: Publication) => {
    setDiscoveringFeedsId(p.id);
    setFeedsDiscoveryResult(null);
    await pubApi.discoverFeeds(p.id);
    // Poll after 20s — discovery runs in background
    setTimeout(async () => {
      const [feedRes] = await Promise.all([pubApi.getFeeds(p.id), loadPubs()]);
      const feeds: PublicationFeed[] = feedRes.data;
      const categoryFeeds = feeds.filter(f => f.feedType === 'category');
      setPubFeeds(prev => ({ ...prev, [p.id]: feeds }));
      setFeedsDiscoveryResult({ pubName: p.name, added: categoryFeeds.length });
      setExpandedFeedsPubId(p.id);
      setDiscoveringFeedsId(null);
    }, 20000);
  };

  const loadFeeds = async (pubId: number) => {
    const res = await pubApi.getFeeds(pubId);
    setPubFeeds(prev => ({ ...prev, [pubId]: res.data }));
  };

  const handleDeleteFeed = async (pubId: number, feedId: number) => {
    await pubApi.deleteFeed(pubId, feedId);
    await Promise.all([loadFeeds(pubId), loadPubs()]);
  };

  const handleAddFeedManually = async (pubId: number) => {
    if (!manualFeedUrl.trim()) return;
    setAddingFeed(true);
    try {
      await pubApi.addFeed(pubId, manualFeedUrl.trim(), manualFeedLabel.trim() || 'Category');
      setManualFeedUrl('');
      setManualFeedLabel('');
      await Promise.all([loadFeeds(pubId), loadPubs()]);
    } finally {
      setAddingFeed(false);
    }
  };

  const handleDiscover = async () => {
    if (!discoverQuery.trim()) return;
    setDiscovering(true);
    setDiscoverError('');
    setDiscoverResults([]);
    try {
      const res = await pubApi.discover(discoverQuery.trim());
      setDiscoverResults(res.data);
      if (res.data.length === 0) setDiscoverError('No new results found. Try a different search term.');
    } catch (err: any) {
      setDiscoverError(err.response?.data?.error || 'Discovery failed. Check server logs.');
    } finally {
      setDiscovering(false);
    }
  };

  const handleAddDiscovered = async (item: any) => {
    setAddingDiscover(item.url);
    try {
      await pubApi.create({
        name: item.name,
        url: item.url,
        tier: item.suggestedTier,
        focus: item.focus || item.description || '',
        rssUrl: item.feedUrl,
        active: 1,
      });
      // Remove from results so the list shrinks naturally
      setDiscoverResults(prev => prev.filter(r => r.url !== item.url));
      loadPubs();
    } finally {
      setAddingDiscover(null);
    }
  };

  const toggleFeedsPanel = async (pubId: number) => {
    if (expandedFeedsPubId === pubId) {
      setExpandedFeedsPubId(null);
      return;
    }
    if (!pubFeeds[pubId]) await loadFeeds(pubId);
    setExpandedFeedsPubId(pubId);
  };

  const handleOpmlFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOpmlImporting(true);
    setOpmlResult(null);
    try {
      const text = await file.text();
      const res = await pubApi.importOpml(text);
      setOpmlResult(res.data);
      if (res.data.added > 0) await loadSuggestions();
    } catch (err: any) {
      setOpmlResult({ added: 0, total: 0, skippedDuplicate: 0, preview: [], message: '', error: err.response?.data?.error || 'Import failed' });
    } finally {
      setOpmlImporting(false);
      if (opmlInputRef.current) opmlInputRef.current.value = '';
    }
  };

  const handleRunNow = async () => {
    setRunningJob(true);
    await suggestApi.runNow();
    setTimeout(async () => { await loadSuggestions(); setRunningJob(false); }, 4000);
  };

  const loadHistory = async () => {
    const r = await suggestApi.history();
    setHistory(r.data);
    setShowHistory(true);
  };

  const sortedPubs = [...pubs]
    .filter(p => !filterTier || p.tier === filterTier)
    .sort((a, b) => {
      let va: any = a[sortCol], vb: any = b[sortCol];
      if (sortCol === 'tier') { va = ['A','B','C'].indexOf(a.tier); vb = ['A','B','C'].indexOf(b.tier); }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(true); }
  };

  const SortBtn = ({ col, children }: { col: typeof sortCol; children: React.ReactNode }) => (
    <button onClick={() => toggleSort(col)}
      className="flex items-center gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wide hover:text-slate-800 transition-colors">
      {children}
      {sortCol === col
        ? (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
        : <ChevronDown className="w-3 h-3 opacity-25" />}
    </button>
  );

  const counts = { A: pubs.filter(p => p.tier === 'A').length, B: pubs.filter(p => p.tier === 'B').length, C: pubs.filter(p => p.tier === 'C').length };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-screen-xl mx-auto px-6 py-8">

        {/* ── Page header ── */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Publications</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Track which outlets to source journalists from.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Hidden file input for OPML */}
            <input
              ref={opmlInputRef}
              type="file"
              accept=".opml,.xml"
              className="hidden"
              onChange={handleOpmlFile}
            />
            {/* Icon-only utility buttons */}
            <button onClick={handleRunNow} disabled={runningJob}
              title="Suggest with AI — runs weekly discovery and adds suggestions for review"
              className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 transition-all">
              <RefreshCw className={`w-4 h-4 ${runningJob ? 'animate-spin text-indigo-500' : ''}`} />
            </button>
            <button onClick={() => opmlInputRef.current?.click()} disabled={opmlImporting}
              title="Import publications from an OPML file (Feedly, Feedspot, etc.)"
              className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 transition-all">
              <Upload className={`w-4 h-4 ${opmlImporting ? 'animate-bounce text-indigo-500' : ''}`} />
            </button>
            {/* Discover blogs — labelled since it's a primary discovery action */}
            <button
              onClick={() => { setShowDiscover(v => !v); setDiscoverResults([]); setDiscoverError(''); }}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                showDiscover
                  ? 'bg-northstar-50 border-northstar-300 text-northstar-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              Discover
            </button>
            <button
              onClick={() => { setShowAdd(v => !v); setEditingId(null); setForm({ ...empty }); }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors">
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
        </div>

        {/* ── Discover blogs panel ── */}
        {showDiscover && (
          <div className="mb-6 card p-5 border-northstar-200 bg-northstar-50/30">
            <h3 className="font-semibold text-slate-900 mb-1">Discover blogs & newsletters</h3>
            <p className="text-slate-500 text-sm mb-4">
              Search across Feedly, Substack and Medium for publications covering your topics. Already-tracked publications are filtered out automatically.
            </p>
            <div className="flex gap-2 mb-4">
              <input
                className="form-input flex-1"
                placeholder="e.g. AI startup machine learning deep learning"
                value={discoverQuery}
                onChange={e => setDiscoverQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleDiscover()}
              />
              <button
                onClick={handleDiscover}
                disabled={discovering || !discoverQuery.trim()}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-northstar-600 text-white text-sm font-medium hover:bg-northstar-700 disabled:opacity-50 transition-colors"
              >
                {discovering
                  ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Searching…</>
                  : <><Search className="w-3.5 h-3.5" /> Search</>
                }
              </button>
            </div>

            {discoverError && (
              <p className="text-sm text-rose-600 mb-3">{discoverError}</p>
            )}

            {discoverResults.length > 0 && (
              <>
                <div className="text-xs text-slate-500 mb-3 flex items-center gap-2">
                  <span><strong>{discoverResults.length}</strong> new publications found</span>
                  <span className="flex items-center gap-1.5">
                    {['feedly','substack','medium'].map(src => {
                      const count = discoverResults.filter(r => r.source === src).length;
                      return count > 0 ? (
                        <span key={src} className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-xs">
                          {src} {count}
                        </span>
                      ) : null;
                    })}
                  </span>
                </div>
                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {discoverResults.map(item => (
                    <div key={item.url} className="bg-white rounded-lg border border-slate-200 px-4 py-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="font-medium text-slate-900 text-sm truncate">{item.name}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                            item.source === 'feedly'   ? 'bg-emerald-50 text-emerald-700' :
                            item.source === 'substack' ? 'bg-orange-50 text-orange-700' :
                            'bg-blue-50 text-blue-700'
                          }`}>{item.source}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                            item.suggestedTier === 'A' ? 'bg-indigo-50 text-indigo-700' :
                            item.suggestedTier === 'B' ? 'bg-sky-50 text-sky-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>Tier {item.suggestedTier}</span>
                          {item.subscribers > 0 && (
                            <span className="text-xs text-slate-400">{item.subscribers.toLocaleString()} subscribers</span>
                          )}
                        </div>
                        <a href={item.url} target="_blank" rel="noreferrer"
                          className="text-xs text-slate-400 hover:text-northstar-600 truncate block">
                          {item.url}
                        </a>
                        {item.description && (
                          <p className="text-xs text-slate-500 mt-1 line-clamp-1">{item.description}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleAddDiscovered(item)}
                        disabled={addingDiscover === item.url}
                        className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-northstar-50 text-northstar-700 border border-northstar-200 text-xs font-medium hover:bg-northstar-100 disabled:opacity-50 transition-colors"
                      >
                        {addingDiscover === item.url ? 'Adding…' : '+ Add'}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── AI suggestions banner ── */}
        {suggestions.length > 0 && (
          <div className="mb-6 bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-amber-100 bg-amber-50/60">
              <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              </div>
              <div>
                <span className="text-sm font-semibold text-slate-800">
                  {suggestions.length} new suggestion{suggestions.length !== 1 ? 's' : ''} from AI Discovery
                </span>
                <span className="text-xs text-slate-400 ml-2">Review and accept or reject each one</span>
              </div>
            </div>
            <div className="divide-y divide-slate-50">
              {suggestions.map(s => {
                const tier = (s.tier || 'B') as Tier;
                const cfg = TIER_CONFIG[tier];
                return (
                  <div key={s.id} className="flex items-start gap-4 px-5 py-4 hover:bg-slate-50/60 transition-colors">
                    {/* Left accent */}
                    <div className={`w-0.5 self-stretch rounded-full ${cfg.dot} shrink-0 mt-0.5`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-slate-900">{s.name}</span>
                        <TierPill tier={tier} showLabel />
                      </div>
                      {s.url && (
                        <a href={s.url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-600 transition-colors mb-1.5">
                          <Globe className="w-3 h-3" />
                          {s.url.replace(/^https?:\/\//, '')}
                          <ExternalLink className="w-2.5 h-2.5 opacity-50" />
                        </a>
                      )}
                      {s.focus && <p className="text-xs text-slate-500 mb-1">{s.focus}</p>}
                      {s.reason && (
                        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 inline-block border border-amber-100">
                          💡 {s.reason}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 pt-0.5">
                      <button onClick={() => handleAccept(s)} disabled={acceptingId === s.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-medium border border-emerald-200 transition-colors">
                        <Check className="w-3.5 h-3.5" />
                        {acceptingId === s.id ? 'Adding…' : 'Accept'}
                      </button>
                      <button onClick={() => handleReject(s)} disabled={rejectingId === s.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-xs font-medium border border-slate-200 transition-colors">
                        <X className="w-3.5 h-3.5" />
                        {rejectingId === s.id ? 'Rejecting…' : 'Reject'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Health warnings ── */}
        {(healthWarnings.unreachable.length > 0 || healthWarnings.inactiveFeeds.length > 0) && (
          <div className="mb-6 bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-amber-100 bg-amber-50/60">
              <TriangleAlert className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-semibold text-slate-800">Data health warnings</span>
              <button onClick={() => setHealthWarnings({ unreachable: [], stale: [], inactiveFeeds: [] })}
                className="ml-auto text-slate-300 hover:text-slate-500"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-3 flex flex-wrap gap-3 text-xs">
              {healthWarnings.unreachable.map(p => (
                <span key={p.id} className="bg-red-50 text-red-700 ring-1 ring-red-200 px-2.5 py-1 rounded-full">
                  ⚠️ {p.name} unreachable
                </span>
              ))}
              {healthWarnings.inactiveFeeds.map(p => (
                <span key={p.id} className="bg-amber-50 text-amber-700 ring-1 ring-amber-200 px-2.5 py-1 rounded-full">
                  📡 {p.name} RSS inactive
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── OPML import result ── */}
        {opmlResult && (
          <div className={`mb-4 rounded-2xl border shadow-sm overflow-hidden ${
            opmlResult.error ? 'bg-red-50 border-red-200' : opmlResult.added > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex items-start gap-3 px-5 py-4">
              <Upload className={`w-4 h-4 mt-0.5 shrink-0 ${opmlResult.error ? 'text-red-500' : opmlResult.added > 0 ? 'text-emerald-600' : 'text-slate-400'}`} />
              <div className="flex-1">
                {opmlResult.error
                  ? <p className="text-sm font-medium text-red-700">{opmlResult.error}</p>
                  : <>
                    <p className="text-sm font-semibold text-slate-800 mb-1">
                      OPML import complete — {opmlResult.total} feeds parsed
                    </p>
                    <div className="flex flex-wrap gap-3 text-xs text-slate-500 mb-2">
                      <span className="text-emerald-700 font-medium">{opmlResult.added} added to review queue</span>
                      {opmlResult.skippedDuplicate > 0 && <span>{opmlResult.skippedDuplicate} already in your list</span>}
                    </div>
                    {opmlResult.preview.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {opmlResult.preview.map(name => (
                          <span key={name} className="text-xs bg-white text-slate-600 ring-1 ring-slate-200 px-2 py-0.5 rounded-full">{name}</span>
                        ))}
                        {opmlResult.added > 10 && <span className="text-xs text-slate-400">+{opmlResult.added - 10} more</span>}
                      </div>
                    )}
                    {opmlResult.added > 0 && (
                      <p className="text-xs text-slate-400 mt-2">Scroll up to review the new suggestions ↑</p>
                    )}
                  </>
                }
              </div>
              <button onClick={() => setOpmlResult(null)} className="text-slate-300 hover:text-slate-500 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── Staff scan result toast ── */}
        {staffScanResult && (
          <div className={`mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
            staffScanResult.error
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}>
            <BookOpen className="w-4 h-4 shrink-0" />
            {staffScanResult.error
              ? <span>Deep scan of <strong>{staffScanResult.pubName}</strong>: {staffScanResult.error}</span>
              : <span>Deep scan of <strong>{staffScanResult.pubName}</strong>: found {staffScanResult.added} new journalist{staffScanResult.added !== 1 ? 's' : ''} from {staffScanResult.pageScanned}</span>
            }
            <button onClick={() => setStaffScanResult(null)} className="ml-auto opacity-50 hover:opacity-100">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ── Feed discovery result banner ── */}
        {feedsDiscoveryResult && (
          <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border bg-violet-50 border-violet-200 text-sm text-violet-800">
            <Layers className="w-4 h-4 shrink-0" />
            <span>
              Discovered <strong>{feedsDiscoveryResult.added}</strong> category feed{feedsDiscoveryResult.added !== 1 ? 's' : ''} for <strong>{feedsDiscoveryResult.pubName}</strong>.
              {feedsDiscoveryResult.added > 0 && ' Click "Feeds" on the row to review them.'}
              {feedsDiscoveryResult.added === 0 && ' No new AI/tech section RSS feeds found on this site.'}
            </span>
            <button onClick={() => setFeedsDiscoveryResult(null)} className="ml-auto opacity-50 hover:opacity-100">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ── Add form ── */}
        {showAdd && (
          <div className="mb-6 bg-white rounded-2xl border border-indigo-100 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">New Publication</h2>
            <PublicationForm form={form} set={set} saving={saving} onSave={handleSave}
              onCancel={() => { setShowAdd(false); setForm({ ...empty }); }} />
          </div>
        )}

        {/* ── Main card ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

          {/* Toolbar */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
            {/* Filter pills */}
            <div className="flex items-center gap-1.5">
              {(['', 'A', 'B', 'C'] as const).map(t => (
                <button key={t} onClick={() => setFilterTier(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    filterTier === t
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100'
                  }`}>
                  {t === '' ? `All · ${pubs.length}` : `Tier ${t} · ${counts[t as Tier]}`}
                </button>
              ))}
            </div>

            {/* Tier guide toggle */}
            <button onClick={() => setShowTierGuide(v => !v)}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-indigo-600 ml-1 transition-colors">
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showTierGuide ? 'rotate-90' : ''}`} />
              {showTierGuide ? 'Hide tier guide' : 'Tier guide'}
            </button>

            {jSuggestionCount > 0 && (
              <a href="/admin/journalist-suggestions"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg ring-1 ring-emerald-200 hover:bg-emerald-100 transition-colors">
                <Rss className="w-3 h-3" />
                {jSuggestionCount} new journalist{jSuggestionCount !== 1 ? 's' : ''} found
              </a>
            )}
            <button onClick={loadHistory}
              className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors">
              <History className="w-3.5 h-3.5" /> History
            </button>
          </div>

          {/* Tier guide — inline collapsible */}
          {showTierGuide && (
            <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/50">
              {(['A', 'B', 'C'] as Tier[]).map(t => {
                const cfg = TIER_CONFIG[t];
                return (
                  <div key={t} className="px-5 py-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TierPill tier={t} />
                      <span className="text-xs font-semibold text-slate-700">{cfg.label}</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed mb-2">{cfg.description}</p>
                    <p className="text-xs text-slate-400"><span className="font-medium text-slate-500">e.g. </span>{cfg.examples}</p>
                    <p className={`text-xs mt-2 rounded-lg px-2.5 py-1.5 ${cfg.bg} ${cfg.text} leading-relaxed`}>{cfg.when}</p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Edit form inline */}
          {editingId !== null && (
            <div className="px-5 py-4 border-b border-indigo-100 bg-indigo-50/30">
              <p className="text-xs font-semibold text-indigo-700 mb-3">Editing publication</p>
              <PublicationForm form={form} set={set} saving={saving} onSave={handleSave} onCancel={cancelEdit} />
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="px-5 py-3 text-left"><SortBtn col="name">Name</SortBtn></th>
                <th className="px-4 py-3 text-left w-16"><SortBtn col="tier">Tier</SortBtn></th>
                <th className="px-4 py-3 text-left">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Focus</span>
                </th>
                <th className="px-4 py-3 text-left w-32">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                    <Rss className="w-3 h-3" /> Feeds
                  </span>
                </th>
                <th className="px-4 py-3 text-center w-16"><SortBtn col="active">Active</SortBtn></th>
                <th className="px-4 py-3 w-24" />
              </tr>
            </thead>
            <tbody>
              {sortedPubs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-400 text-sm">
                    No publications found.
                  </td>
                </tr>
              )}
              {sortedPubs.map(p => {
                const feeds = pubFeeds[p.id] || [];
                return (<>
                <tr key={p.id}
                  className={`border-b border-slate-50 last:border-0 group transition-colors ${
                    editingId === p.id ? 'bg-indigo-50/40' :
                    !p.active ? 'opacity-40 hover:opacity-60' : 'hover:bg-slate-50/70'
                  }`}>
                  {/* Name + URL subtitle */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <Link to={`/admin/publications/${p.id}`}
                        className="font-medium text-slate-800 hover:text-northstar-600 transition-colors text-sm">
                        {p.name}
                      </Link>
                      {p.isVirtual === 1 && (
                        <span className="text-xs bg-purple-50 text-purple-600 ring-1 ring-purple-200 px-1.5 py-0.5 rounded-full">Virtual</span>
                      )}
                    </div>
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-slate-400 hover:text-indigo-500 transition-colors mt-0.5 block">
                        {p.url.replace(/^https?:\/\//, '')}
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3.5"><TierPill tier={p.tier as Tier} /></td>
                  <td className="px-4 py-3.5 text-xs text-slate-500 max-w-[200px]">
                    <span className="truncate block" title={p.focus}>{p.focus || <span className="text-slate-300">—</span>}</span>
                  </td>
                  {/* Combined feeds + RSS status */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <RssStatusBadge status={p.rssStatus || 'unknown'} />
                      {p.isVirtual !== 1 && (
                        <button onClick={() => toggleFeedsPanel(p.id)}
                          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-600 transition-colors"
                          title="View / manage feeds">
                          <Layers className="w-3 h-3" />
                          {p.feedCount}
                          <ChevronRight className={`w-3 h-3 transition-transform ${expandedFeedsPubId === p.id ? 'rotate-90' : ''}`} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <button onClick={() => toggleActive(p)}
                      title={p.active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                      className={`w-8 h-5 rounded-full transition-colors relative mx-auto block ${p.active ? 'bg-emerald-400' : 'bg-slate-200'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${p.active ? 'left-3.5' : 'left-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-3 py-3.5">
                    <div className="flex items-center gap-0.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleScanRss(p)} disabled={scanningId === p.id}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                        title="Scan feeds for journalist suggestions">
                        {scanningId === p.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
                      </button>
                      <Link to={`/admin/publications/${p.id}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-northstar-600 hover:bg-northstar-50 transition-colors" title="View journalists">
                        <Users className="w-3.5 h-3.5" />
                      </Link>
                      <button onClick={() => startEdit(p)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors" title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(p.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
                {/* ── Feeds panel (inline expanded row) ── */}
                {expandedFeedsPubId === p.id && (
                  <tr key={`feeds-${p.id}`} className="bg-slate-50/80 border-b border-slate-100">
                    <td colSpan={6} className="px-8 py-4">
                      <div className="flex items-start gap-6">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-3">
                            <Layers className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-xs font-semibold text-slate-600">RSS Feeds — {p.name}</span>
                            <span className="text-xs text-slate-400">{feeds.length} feed{feeds.length !== 1 ? 's' : ''}</span>
                          </div>
                          {/* Feed list */}
                          {feeds.length === 0
                            ? <p className="text-xs text-slate-400 italic mb-3">No feeds yet. Auto-discover or add one manually below.</p>
                            : <div className="space-y-1.5 mb-3">
                                {feeds.map(f => (
                                  <div key={f.id} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-white border border-slate-100">
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                      f.rssStatus === 'active' ? 'bg-emerald-400' :
                                      f.rssStatus === 'inactive' ? 'bg-red-400' : 'bg-slate-300'
                                    }`} />
                                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
                                      f.feedType === 'main'
                                        ? 'bg-slate-100 text-slate-500'
                                        : 'bg-indigo-50 text-indigo-600'
                                    }`}>
                                      {f.feedType === 'main' ? 'Main' : 'Category'}
                                    </span>
                                    <span className="text-xs font-medium text-slate-700 shrink-0 min-w-[100px]">{f.feedLabel}</span>
                                    <a href={f.feedUrl} target="_blank" rel="noopener noreferrer"
                                      className="text-xs text-slate-400 hover:text-indigo-600 truncate transition-colors flex items-center gap-1 min-w-0">
                                      {f.feedUrl.replace(/^https?:\/\//, '')}
                                      <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                                    </a>
                                    <button onClick={() => handleDeleteFeed(p.id, f.id)}
                                      className="ml-auto p-1 text-slate-300 hover:text-red-500 rounded transition-colors shrink-0" title="Remove feed">
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                          }

                          {/* Manual add feed */}
                          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                            <input
                              type="url"
                              placeholder="https://techcrunch.com/category/artificial-intelligence/feed/"
                              value={expandedFeedsPubId === p.id ? manualFeedUrl : ''}
                              onChange={e => setManualFeedUrl(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleAddFeedManually(p.id)}
                              className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white placeholder:text-slate-300"
                            />
                            <input
                              type="text"
                              placeholder="Label (e.g. AI)"
                              value={expandedFeedsPubId === p.id ? manualFeedLabel : ''}
                              onChange={e => setManualFeedLabel(e.target.value)}
                              className="w-28 text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white placeholder:text-slate-300"
                            />
                            <button
                              onClick={() => handleAddFeedManually(p.id)}
                              disabled={addingFeed || !manualFeedUrl.trim()}
                              className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-medium ring-1 ring-indigo-200 transition-colors disabled:opacity-40"
                            >
                              {addingFeed ? 'Adding…' : '+ Add feed'}
                            </button>
                          </div>
                        </div>

                        {/* Right: scan actions */}
                        <div className="flex flex-col gap-2 shrink-0 pt-5">
                          {p.url && p.isVirtual !== 1 && (
                            <>
                              <button
                                onClick={() => handleDiscoverFeeds(p)}
                                disabled={discoveringFeedsId === p.id}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 text-xs font-medium ring-1 ring-violet-200 transition-colors"
                              >
                                <Zap className={`w-3.5 h-3.5 ${discoveringFeedsId === p.id ? 'animate-pulse' : ''}`} />
                                {discoveringFeedsId === p.id ? 'Discovering… (~20s)' : 'Auto-discover feeds'}
                              </button>
                              <button
                                onClick={() => handleStaffScan(p)}
                                disabled={staffScanningId === p.id}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-medium ring-1 ring-indigo-200 transition-colors"
                              >
                                <BookOpen className={`w-3.5 h-3.5 ${staffScanningId === p.id ? 'animate-pulse' : ''}`} />
                                {staffScanningId === p.id ? 'Scanning staff page…' : 'Scan staff page'}
                              </button>
                            </>
                          )}
                          <p className="text-xs text-slate-400 max-w-[150px] leading-relaxed">These scans find journalists automatically</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </>);
              })}
            </tbody>
          </table>
          </div>{/* end overflow-x-auto */}
        </div>

        {/* ── History modal ── */}
        {showHistory && (
          <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-6"
            onClick={() => setShowHistory(false)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[65vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900 text-sm">Suggestion History</h2>
                <button onClick={() => setShowHistory(false)}
                  className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto flex-1">
                {history.length === 0
                  ? <p className="p-8 text-center text-slate-400 text-sm">No history yet.</p>
                  : <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Publication</th>
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Decision</th>
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(h => (
                          <tr key={h.id} className="border-b border-slate-50 last:border-0">
                            <td className="px-5 py-3 text-slate-800 font-medium">{h.name}</td>
                            <td className="px-5 py-3">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                                h.status === 'accepted'
                                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                                  : 'bg-red-50 text-red-600 ring-1 ring-red-200'
                              }`}>
                                {h.status === 'accepted' ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                                {h.status}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-slate-400 text-xs">{h.createdAt?.slice(0, 10)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                }
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Publication form ─────────────────────────────────────────────────────────

function PublicationForm({ form, set, saving, onSave, onCancel }: {
  form: typeof empty; set: (k: string, v: any) => void;
  saving: boolean; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-3 items-end">
      <div className="col-span-2">
        <label className="form-label">Name *</label>
        <input className="form-input" value={form.name}
          onChange={e => set('name', e.target.value)} placeholder="e.g. TechCrunch" autoFocus />
      </div>
      <div className="col-span-2">
        <label className="form-label">Homepage URL</label>
        <input className="form-input" value={form.url}
          onChange={e => set('url', e.target.value)} placeholder="https://..." />
      </div>
      <div className="col-span-2">
        <label className="form-label flex items-center gap-1">
          <Rss className="w-3 h-3 text-emerald-500" /> RSS Feed URL
        </label>
        <input className="form-input" value={form.rssUrl}
          onChange={e => set('rssUrl', e.target.value)} placeholder="https://.../feed/" />
      </div>
      <div className="col-span-2">
        <label className="form-label">Tier</label>
        <select className="form-select" value={form.tier} onChange={e => set('tier', e.target.value)}>
          <option value="A">A — Major Tech & AI</option>
          <option value="B">B — Business / Mid-tier</option>
          <option value="C">C — Regional & Niche</option>
        </select>
      </div>
      <div className="col-span-2">
        <label className="form-label">Focus</label>
        <input className="form-input" value={form.focus}
          onChange={e => set('focus', e.target.value)} placeholder="AI funding, startups…" />
      </div>
      <div className="col-span-2">
        <label className="form-label">Notes</label>
        <input className="form-input" value={form.notes}
          onChange={e => set('notes', e.target.value)} placeholder="Internal notes…" />
      </div>
      <div className="col-span-12 flex items-center gap-2 pt-1">
        <button className="btn-primary py-1.5 text-sm" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn-secondary py-1.5 text-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
