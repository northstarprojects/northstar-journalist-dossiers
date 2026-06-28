import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, ChevronRight, SortDesc, Sparkles, FileText, Star, Mail } from 'lucide-react';
import { journalists as api, enrichment as enrichApi } from '../api';
import type { Journalist } from '../types';
import StatusBadge from '../components/StatusBadge';

const STATUSES = ['Not Started', 'Researching', 'Ready to Pitch', 'Pitched', 'Responded', 'In Conversation', 'Covered', 'Not a Fit', 'On Hold'];
const PUB_TYPES = ['National', 'Regional', 'Trade', 'Blog', 'Newsletter', 'Podcast', 'Wire'];

export default function JournalistsList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [list, setList] = useState<Journalist[]>([]);
  const [loading, setLoading] = useState(true);
  const [rescoring, setRescoring] = useState(false);
  const [rescoreMsg, setRescoreMsg] = useState('');
  const [backfilling, setBackfilling] = useState(false);
  const [backfillDone, setBackfillDone] = useState(false);
  const [enriching, setEnriching] = useState(false);

  const search = searchParams.get('search') || '';
  const tier = searchParams.get('tier') || '';
  const publicationType = searchParams.get('publicationType') || '';
  const outreachStatus = searchParams.get('outreachStatus') || '';
  const sortBy = searchParams.get('sortBy') || 'totalScore';
  const favOnly = searchParams.get('favOnly') === '1';

  const unscoredCount = list.filter(j => j.totalScore === 0).length;
  const missingEmailCount = list.filter(j => !j.email).length;

  const handleBulkEnrich = async () => {
    setEnriching(true);
    setRescoreMsg('');
    try {
      const res = await enrichApi.bulkRun();
      setRescoreMsg(res.data.message);
      setTimeout(reload, 30_000); // reload after ~30s to show new emails
    } catch (err: any) {
      setRescoreMsg(err.response?.data?.error || 'Enrichment failed. Check server logs.');
    } finally {
      setEnriching(false);
    }
  };

  const reload = () =>
    api.list({ search, tier, publicationType, outreachStatus, sortBy })
      .then(r => setList(r.data));

  const handleBulkRescore = async () => {
    setRescoring(true);
    setRescoreMsg('');
    try {
      const res = await api.bulkRescore();
      setRescoreMsg(res.data.message);
      setTimeout(reload, 8000);
    } catch (err: any) {
      setRescoreMsg(err.response?.data?.error || 'Re-score failed. Check server logs.');
    } finally {
      setRescoring(false);
    }
  };

  const handleBackfillArticles = async () => {
    setBackfilling(true);
    try {
      const res = await api.backfillArticles();
      setRescoreMsg(res.data.message);
      setBackfillDone(true);
    } catch (err: any) {
      setRescoreMsg('Backfill failed. Check server logs.');
    } finally {
      setBackfilling(false);
    }
  };

  const handleToggleFavorite = async (e: React.MouseEvent, j: Journalist) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await api.toggleFavorite(j.id);
      setList(prev => prev.map(x => x.id === j.id ? { ...x, isFavorite: res.data.isFavorite } : x));
    } catch { /* silent */ }
  };

  const update = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams);
    value ? p.set(key, value) : p.delete(key);
    setSearchParams(p);
  };

  useEffect(() => {
    setLoading(true);
    api.list({ search, tier, publicationType, outreachStatus, sortBy })
      .then(r => setList(r.data))
      .finally(() => setLoading(false));
  }, [search, tier, publicationType, outreachStatus, sortBy]);

  // Client-side favorites filter (avoids a backend change)
  const displayed = favOnly ? list.filter(j => j.isFavorite) : list;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Journalists</h1>
          <p className="text-slate-500 mt-1">
            {displayed.length} journalist{displayed.length !== 1 ? 's' : ''}
            {favOnly && <span className="ml-2 text-amber-600 font-medium">★ Favourites</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!backfillDone && (
            <button
              onClick={handleBackfillArticles}
              disabled={backfilling}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Seed the Articles tab from discovery data for existing journalists"
            >
              <FileText className="w-4 h-4" />
              {backfilling ? 'Seeding articles…' : 'Seed articles from discovery'}
            </button>
          )}
          {missingEmailCount > 0 && (
            <button
              onClick={handleBulkEnrich}
              disabled={enriching}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm font-medium hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Look up missing emails via Apollo"
            >
              <Mail className="w-4 h-4" />
              {enriching ? 'Looking up emails…' : `Find emails via Apollo (${missingEmailCount})`}
            </button>
          )}
          {unscoredCount > 0 && (
            <button
              onClick={handleBulkRescore}
              disabled={rescoring}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-50 border border-violet-200 text-violet-700 text-sm font-medium hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Run Claude analysis on all journalists with score 0"
            >
              <Sparkles className="w-4 h-4" />
              {rescoring ? 'Sending to Claude…' : `Re-score with Claude (${unscoredCount})`}
            </button>
          )}
          <Link to="/journalists/new" className="btn-primary">+ Add Journalist</Link>
        </div>
      </div>

      {rescoreMsg && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-violet-50 border border-violet-200 text-violet-800 text-sm">
          ✨ {rescoreMsg}
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 mb-5 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="form-input pl-9"
            placeholder="Search name, publication, beat..."
            value={search}
            onChange={e => update('search', e.target.value)}
          />
        </div>
        {/* Favourites toggle */}
        <button
          onClick={() => update('favOnly', favOnly ? '' : '1')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
            favOnly
              ? 'bg-amber-50 border-amber-300 text-amber-700'
              : 'bg-white border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600'
          }`}
        >
          <Star className={`w-3.5 h-3.5 ${favOnly ? 'fill-amber-500 text-amber-500' : ''}`} />
          Favourites
        </button>
        <select className="form-select w-auto" value={tier} onChange={e => update('tier', e.target.value)}>
          <option value="">All Tiers</option>
          {[1,2,3,4].map(t => <option key={t} value={t}>Tier {t}</option>)}
        </select>
        <select className="form-select w-auto" value={publicationType} onChange={e => update('publicationType', e.target.value)}>
          <option value="">All Types</option>
          {PUB_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="form-select w-auto" value={outreachStatus} onChange={e => update('outreachStatus', e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="form-select w-auto" value={sortBy} onChange={e => update('sortBy', e.target.value)}>
          <option value="totalScore">Sort: Score</option>
          <option value="name">Sort: Name</option>
          <option value="publication">Sort: Publication</option>
          <option value="createdAt">Sort: Added</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading...</div>
        ) : displayed.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            {favOnly
              ? <span>No favourites yet — click the ★ on any journalist to add them.</span>
              : <span>No journalists found. <Link to="/journalists/new" className="text-northstar-600 hover:underline">Add one.</Link></span>
            }
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="w-8 px-3 py-3"></th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Publication</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Beat</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 flex items-center gap-1">
                  <SortDesc className="w-3 h-3" /> Score
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayed.map(j => (
                <tr key={j.id} className={`hover:bg-slate-50 transition-colors ${j.staleFlag ? 'opacity-70' : ''}`}>
                  {/* Star */}
                  <td className="px-3 py-3 w-8">
                    <button
                      onClick={e => handleToggleFavorite(e, j)}
                      className="text-slate-300 hover:text-amber-400 transition-colors"
                      title={j.isFavorite ? 'Remove from favourites' : 'Add to favourites'}
                    >
                      <Star className={`w-4 h-4 ${j.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 flex items-center gap-2">
                      {j.name}
                      {j.staleFlag ? (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200" title="No articles found in the last 30 days">
                          stale
                        </span>
                      ) : null}
                    </div>
                    {j.roleTitle && <div className="text-xs text-slate-500">{j.roleTitle}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{j.publication}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{j.beat}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 bg-slate-100 rounded-full h-1.5">
                        <div className="bg-northstar-500 h-1.5 rounded-full" style={{ width: `${j.totalScore}%` }} />
                      </div>
                      <span className="font-mono text-xs font-medium text-slate-700">{j.totalScore}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={j.outreachStatus} /></td>
                  <td className="px-4 py-3">
                    <Link to={`/journalists/${j.id}`} className="text-northstar-600 hover:text-northstar-800 flex items-center">
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
