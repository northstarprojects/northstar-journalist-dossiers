import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Rss, Check, X, ExternalLink, RefreshCw,
  ChevronLeft, FileText, History, Tag,
} from 'lucide-react';
import { journalistSuggestions as api } from '../api';
import type { JournalistSuggestion } from '../types';

// ─── Relevance helpers ────────────────────────────────────────────────────────

function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

function RelevanceBadge({ score }: { score: number }) {
  if (score >= 6) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
      High · {score}/10
    </span>
  );
  if (score >= 3) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 ring-1 ring-amber-200">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
      Mid · {score}/10
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-400 ring-1 ring-slate-200">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 inline-block" />
      Low · {score}/10
    </span>
  );
}

type FilterTab = 'all' | 'high' | 'mid' | 'low';

export default function AdminJournalistSuggestions() {
  const [suggestions, setSuggestions] = useState<JournalistSuggestion[]>([]);
  const [history, setHistory] = useState<JournalistSuggestion[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [scanningAll, setScanningAll] = useState(false);
  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [acceptedJournalistId, setAcceptedJournalistId] = useState<number | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [rejectingAll, setRejectingAll] = useState(false);

  const load = () => api.list().then(r => setSuggestions(r.data));
  useEffect(() => { load(); }, []);

  const handleAccept = async (s: JournalistSuggestion) => {
    setAcceptingId(s.id);
    const res = await api.accept(s.id);
    if (res.data.journalist) setAcceptedJournalistId(res.data.journalist.id);
    await load();
    setAcceptingId(null);
  };

  const handleReject = async (s: JournalistSuggestion) => {
    setRejectingId(s.id);
    await api.reject(s.id);
    await load();
    setRejectingId(null);
  };

  const handleRejectAll = async (ids: number[]) => {
    if (!confirm(`Skip all ${ids.length} low-signal suggestions? They won't reappear for 30 days.`)) return;
    setRejectingAll(true);
    for (const id of ids) await api.reject(id);
    await load();
    setRejectingAll(false);
  };

  const handleScanAll = async () => {
    setScanningAll(true);
    await api.scanAll();
    setTimeout(async () => { await load(); setScanningAll(false); }, 5000);
  };

  const loadHistory = async () => {
    const r = await api.history();
    setHistory(r.data);
    setShowHistory(true);
  };

  // Apply filter
  const filtered = suggestions.filter(s => {
    const score = s.relevanceScore ?? 0;
    if (filterTab === 'high') return score >= 6;
    if (filterTab === 'mid') return score >= 3 && score < 6;
    if (filterTab === 'low') return score < 3;
    return true;
  });

  // Group by publication, sorted by avg relevance score descending
  const grouped = filtered.reduce<Record<string, JournalistSuggestion[]>>((acc, s) => {
    const key = s.publicationName || 'Unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});

  // Sort within each group by score descending
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
  }

  // Sort publication groups by their highest score
  const sortedGroups = Object.entries(grouped).sort(([, a], [, b]) => {
    const maxA = Math.max(...a.map(s => s.relevanceScore ?? 0));
    const maxB = Math.max(...b.map(s => s.relevanceScore ?? 0));
    return maxB - maxA;
  });

  const highCount = suggestions.filter(s => (s.relevanceScore ?? 0) >= 6).length;
  const midCount  = suggestions.filter(s => (s.relevanceScore ?? 0) >= 3 && (s.relevanceScore ?? 0) < 6).length;
  const lowCount  = suggestions.filter(s => (s.relevanceScore ?? 0) < 3).length;
  const lowIds    = suggestions.filter(s => (s.relevanceScore ?? 0) < 3).map(s => s.id);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-8 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link to="/admin/publications"
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 mb-2 transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" /> Back to Publications
            </Link>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Journalist Suggestions</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Scored by AI/startup relevance across up to 10 recent articles per journalist.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={loadHistory}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:border-slate-300 transition-all shadow-sm">
              <History className="w-3.5 h-3.5" /> History
            </button>
            <button onClick={handleScanAll} disabled={scanningAll}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm">
              <RefreshCw className={`w-3.5 h-3.5 ${scanningAll ? 'animate-spin' : ''}`} />
              {scanningAll ? 'Scanning…' : 'Scan All Feeds Now'}
            </button>
          </div>
        </div>

        {/* Accepted flash */}
        {acceptedJournalistId && (
          <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            Draft record created. Claude is scoring in the background.
            <Link to={`/journalists/${acceptedJournalistId}`}
              className="ml-auto text-emerald-700 font-medium hover:underline flex items-center gap-1">
              View record <ExternalLink className="w-3 h-3" />
            </Link>
            <button onClick={() => setAcceptedJournalistId(null)} className="text-emerald-400 hover:text-emerald-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Filter tabs + bulk skip */}
        {suggestions.length > 0 && (
          <div className="flex items-center gap-2 mb-5">
            {([
              { key: 'all',  label: 'All',           count: suggestions.length },
              { key: 'high', label: '🟢 High signal', count: highCount },
              { key: 'mid',  label: '🟡 Mid signal',  count: midCount },
              { key: 'low',  label: '⚪ Low signal',  count: lowCount },
            ] as { key: FilterTab; label: string; count: number }[]).map(tab => (
              <button key={tab.key} onClick={() => setFilterTab(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  filterTab === tab.key
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'
                }`}>
                {tab.label} · {tab.count}
              </button>
            ))}

            {lowIds.length > 0 && (
              <button onClick={() => handleRejectAll(lowIds)} disabled={rejectingAll}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 transition-colors">
                <X className="w-3 h-3" />
                {rejectingAll ? 'Skipping…' : `Skip all ${lowIds.length} low-signal`}
              </button>
            )}
          </div>
        )}

        {/* Score legend */}
        {suggestions.length > 0 && (
          <div className="mb-5 flex items-center gap-4 px-4 py-2.5 bg-white rounded-xl border border-slate-100 text-xs text-slate-500">
            <Tag className="w-3.5 h-3.5 text-slate-300 shrink-0" />
            <span>Relevance scored 0–10 across up to 10 recent articles:</span>
            <span className="text-emerald-700 font-medium">6–10 High</span>
            <span className="text-slate-300">·</span>
            <span className="text-amber-700 font-medium">3–5 Mid</span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-400 font-medium">0–2 Low</span>
            <span className="text-slate-300">·</span>
            <span>Sorted by score within each publication</span>
          </div>
        )}

        {/* Empty state */}
        {suggestions.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Rss className="w-5 h-5 text-slate-400" />
            </div>
            <h2 className="font-semibold text-slate-800 mb-1">No pending suggestions</h2>
            <p className="text-slate-400 text-sm mb-5">
              Run an RSS scan to discover journalists from your active publication feeds.
            </p>
            <button onClick={handleScanAll} disabled={scanningAll}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors">
              <RefreshCw className={`w-4 h-4 ${scanningAll ? 'animate-spin' : ''}`} />
              {scanningAll ? 'Scanning feeds…' : 'Scan All Feeds Now'}
            </button>
          </div>
        )}

        {filtered.length === 0 && suggestions.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center text-slate-400 text-sm">
            No suggestions match this filter.
          </div>
        )}

        {/* Grouped suggestion cards */}
        {sortedGroups.map(([pubName, items]) => (
          <div key={pubName} className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Rss className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-sm font-semibold text-slate-700">{pubName}</span>
              <span className="text-xs text-slate-400">{items.length} suggestion{items.length !== 1 ? 's' : ''}</span>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Relevance</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Matched tags</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Best article</th>
                    <th className="px-5 py-3 w-36" />
                  </tr>
                </thead>
                <tbody>
                  {items.map(s => {
                    const tags = parseTags(s.matchedTags);
                    const score = s.relevanceScore ?? 0;
                    return (
                      <tr key={s.id}
                        className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition-colors ${
                          score < 3 ? 'opacity-60' : ''
                        }`}>
                        <td className="px-5 py-3.5">
                          <div className="font-semibold text-slate-900">{s.name}</div>
                          {(s.articleCount ?? 1) > 1 && (
                            <div className="text-xs text-slate-400 mt-0.5">{s.articleCount} articles scanned</div>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <RelevanceBadge score={score} />
                        </td>
                        <td className="px-5 py-3.5 max-w-[180px]">
                          {tags.length > 0
                            ? <div className="flex flex-wrap gap-1">
                                {tags.slice(0, 3).map(t => (
                                  <span key={t} className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded ring-1 ring-indigo-100">
                                    {t}
                                  </span>
                                ))}
                                {tags.length > 3 && (
                                  <span className="text-xs text-slate-300">+{tags.length - 3}</span>
                                )}
                              </div>
                            : <span className="text-xs text-slate-300">—</span>
                          }
                        </td>
                        <td className="px-5 py-3.5 max-w-xs">
                          {s.recentArticleUrl
                            ? <a href={s.recentArticleUrl} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-start gap-1.5 text-xs text-slate-500 hover:text-indigo-600 transition-colors group/link">
                                <FileText className="w-3.5 h-3.5 shrink-0 mt-0.5 group-hover/link:text-indigo-500" />
                                <span className="line-clamp-2">{s.recentArticleTitle || s.recentArticleUrl}</span>
                              </a>
                            : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5 justify-end">
                            <button onClick={() => handleAccept(s)} disabled={acceptingId === s.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-medium ring-1 ring-emerald-200 transition-colors">
                              <Check className="w-3 h-3" />
                              {acceptingId === s.id ? 'Adding…' : 'Accept'}
                            </button>
                            <button onClick={() => handleReject(s)} disabled={rejectingId === s.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white text-slate-500 hover:bg-red-50 hover:text-red-600 hover:ring-red-200 text-xs font-medium ring-1 ring-slate-200 transition-colors">
                              <X className="w-3 h-3" />
                              {rejectingId === s.id ? '…' : 'Skip'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {/* History modal */}
        {showHistory && (
          <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-6"
            onClick={() => setShowHistory(false)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[65vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900 text-sm">Journalist Suggestion History</h2>
                <button onClick={() => setShowHistory(false)}
                  className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto flex-1">
                {history.length === 0
                  ? <p className="p-8 text-center text-slate-400 text-sm">No history yet.</p>
                  : <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Publication</th>
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Score</th>
                          <th className="px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Decision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(h => (
                          <tr key={h.id} className="border-b border-slate-50 last:border-0">
                            <td className="px-5 py-3 font-medium text-slate-800">{h.name}</td>
                            <td className="px-5 py-3 text-slate-500 text-xs">{h.publicationName}</td>
                            <td className="px-5 py-3">
                              {h.relevanceScore != null && <RelevanceBadge score={h.relevanceScore} />}
                            </td>
                            <td className="px-5 py-3">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${
                                h.status === 'accepted'
                                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                  : 'bg-red-50 text-red-600 ring-red-200'
                              }`}>
                                {h.status === 'accepted' ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                                {h.status}
                              </span>
                            </td>
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
