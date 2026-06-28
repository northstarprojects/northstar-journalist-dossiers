import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Newspaper, Plus, ExternalLink, Search, X, Edit2, Trash2,
  Check, Loader2, Link2, ChevronDown,
} from 'lucide-react';
import { coverage as covApi, journalists as jApi } from '../api';
import type { CoverageItem, CoverageType, CoverageSentiment, Journalist } from '../types';

// ── Config ────────────────────────────────────────────────────────────────────

const COVERAGE_TYPES: { value: CoverageType; label: string }[] = [
  { value: 'mention',   label: 'Mention' },
  { value: 'feature',   label: 'Feature' },
  { value: 'interview', label: 'Interview' },
  { value: 'quote',     label: 'Quote' },
  { value: 'review',    label: 'Review' },
  { value: 'op-ed',     label: 'Op-Ed' },
];

const SENTIMENTS: { value: CoverageSentiment; label: string; color: string }[] = [
  { value: 'positive', label: 'Positive', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'neutral',  label: 'Neutral',  color: 'bg-slate-100 text-slate-600 border-slate-200' },
  { value: 'mixed',    label: 'Mixed',    color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'negative', label: 'Negative', color: 'bg-rose-50 text-rose-600 border-rose-200' },
];

const TYPE_COLORS: Record<CoverageType | string, string> = {
  mention:   'bg-slate-100 text-slate-600',
  feature:   'bg-northstar-50 text-northstar-700',
  interview: 'bg-violet-50 text-violet-700',
  quote:     'bg-blue-50 text-blue-700',
  review:    'bg-amber-50 text-amber-700',
  'op-ed':   'bg-rose-50 text-rose-700',
};

const sentimentStyle = (s: string) =>
  SENTIMENTS.find(x => x.value === s)?.color || 'bg-slate-100 text-slate-600 border-slate-200';

// ── Blank form ────────────────────────────────────────────────────────────────

const BLANK = {
  title: '', url: '', publication: '', publishDate: '',
  journalistId: null as number | null, journalistName: '',
  coverageType: 'mention' as CoverageType, sentiment: 'neutral' as CoverageSentiment,
  summary: '', notes: '',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function CoveragePage() {
  const [items, setItems] = useState<CoverageItem[]>([]);
  const [journalists, setJournalists] = useState<Journalist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CoverageItem | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sentimentFilter, setSentimentFilter] = useState('');

  // Journalist search inside form
  const [jSearch, setJSearch] = useState('');
  const [jOpen, setJOpen] = useState(false);
  const jRef = useRef<HTMLDivElement>(null);

  const load = (params?: any) =>
    covApi.list(params).then(r => setItems(r.data)).finally(() => setLoading(false));

  useEffect(() => {
    load();
    jApi.list({ sortBy: 'totalScore' }).then(r => setJournalists(r.data));
  }, []);

  // Close journalist dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (jRef.current && !jRef.current.contains(e.target as Node)) setJOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Apply filters
  useEffect(() => {
    const params: any = {};
    if (search)         params.search    = search;
    if (typeFilter)     params.type      = typeFilter;
    if (sentimentFilter) params.sentiment = sentimentFilter;
    load(params);
  }, [search, typeFilter, sentimentFilter]);

  const openAdd = () => {
    setEditing(null);
    setForm({ ...BLANK });
    setJSearch('');
    setFetchError('');
    setShowForm(true);
  };

  const openEdit = (item: CoverageItem) => {
    setEditing(item);
    setForm({
      title: item.title, url: item.url, publication: item.publication,
      publishDate: item.publishDate, journalistId: item.journalistId,
      journalistName: item.journalistName || item.linkedJournalistName,
      coverageType: item.coverageType, sentiment: item.sentiment,
      summary: item.summary, notes: item.notes,
    });
    setJSearch(item.linkedJournalistName || item.journalistName || '');
    setFetchError('');
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFetchMeta = async () => {
    if (!form.url.trim()) return;
    setFetching(true);
    setFetchError('');
    try {
      const r = await covApi.fetchMeta(form.url.trim());
      const { title, publication, publishDate, description } = r.data;
      setForm(f => ({
        ...f,
        title:       title       || f.title,
        publication: publication || f.publication,
        publishDate: publishDate || f.publishDate,
        summary:     description || f.summary,
      }));
    } catch (err: any) {
      setFetchError(err.response?.data?.error || 'Could not fetch that URL.');
    } finally {
      setFetching(false);
    }
  };

  const handleSelectJournalist = (j: Journalist) => {
    setForm(f => ({
      ...f,
      journalistId:  j.id,
      journalistName: j.name,
      publication:   f.publication || j.publication,
    }));
    setJSearch(j.name);
    setJOpen(false);
  };

  const handleClearJournalist = () => {
    setForm(f => ({ ...f, journalistId: null, journalistName: '' }));
    setJSearch('');
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await covApi.update(editing.id, form);
      } else {
        await covApi.create(form);
      }
      setShowForm(false);
      setEditing(null);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this coverage item?')) return;
    await covApi.delete(id);
    load();
  };

  const filteredJournalists = journalists.filter(j => {
    if (!jSearch) return true;
    const s = jSearch.toLowerCase();
    return j.name.toLowerCase().includes(s) || j.publication.toLowerCase().includes(s);
  }).slice(0, 8);

  // Stats
  const positiveCount = items.filter(i => i.sentiment === 'positive').length;
  const featureCount  = items.filter(i => i.coverageType === 'feature').length;
  const linkedCount   = items.filter(i => i.journalistId).length;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-northstar-600" /> Press Coverage
          </h1>
          <p className="text-slate-500 mt-1 text-sm">Articles written about North Star AI Labs.</p>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Coverage
        </button>
      </div>

      {/* Stats */}
      {items.length > 0 && (
        <div className="flex items-center gap-6 mb-5 text-sm">
          <span className="text-slate-500"><strong className="text-slate-800">{items.length}</strong> articles</span>
          {positiveCount > 0 && <span className="text-slate-500"><strong className="text-emerald-700">{positiveCount}</strong> positive</span>}
          {featureCount > 0  && <span className="text-slate-500"><strong className="text-northstar-700">{featureCount}</strong> features</span>}
          {linkedCount > 0   && <span className="text-slate-500"><strong className="text-blue-700">{linkedCount}</strong> linked to journalists</span>}
        </div>
      )}

      {/* Add / Edit form */}
      {showForm && (
        <div className="card p-6 mb-6 border-northstar-200 bg-northstar-50/30">
          <h3 className="font-semibold text-slate-900 mb-4">
            {editing ? 'Edit coverage' : 'Add coverage'}
          </h3>

          {/* URL row with auto-fill */}
          <div className="mb-4">
            <label className="form-label">Article URL</label>
            <div className="flex gap-2">
              <input
                className="form-input flex-1"
                placeholder="https://techcrunch.com/…"
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleFetchMeta()}
              />
              <button
                onClick={handleFetchMeta}
                disabled={fetching || !form.url.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 hover:border-slate-300 font-medium disabled:opacity-50 transition-colors"
              >
                {fetching
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching…</>
                  : <><Link2 className="w-3.5 h-3.5" /> Auto-fill</>
                }
              </button>
            </div>
            {fetchError && <p className="text-xs text-rose-600 mt-1">{fetchError}</p>}
            <p className="text-xs text-slate-400 mt-1">Paste a URL and click Auto-fill to extract title, publication and date automatically.</p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Title */}
            <div className="col-span-2">
              <label className="form-label">Title <span className="text-rose-400">*</span></label>
              <input
                className="form-input"
                placeholder="Article headline"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>

            {/* Publication */}
            <div>
              <label className="form-label">Publication</label>
              <input
                className="form-input"
                placeholder="TechCrunch"
                value={form.publication}
                onChange={e => setForm(f => ({ ...f, publication: e.target.value }))}
              />
            </div>

            {/* Date */}
            <div>
              <label className="form-label">Publish date</label>
              <input
                type="date"
                className="form-input"
                value={form.publishDate}
                onChange={e => setForm(f => ({ ...f, publishDate: e.target.value }))}
              />
            </div>

            {/* Coverage type */}
            <div>
              <label className="form-label">Coverage type</label>
              <select
                className="form-select"
                value={form.coverageType}
                onChange={e => setForm(f => ({ ...f, coverageType: e.target.value as CoverageType }))}
              >
                {COVERAGE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {/* Sentiment */}
            <div>
              <label className="form-label">Sentiment</label>
              <select
                className="form-select"
                value={form.sentiment}
                onChange={e => setForm(f => ({ ...f, sentiment: e.target.value as CoverageSentiment }))}
              >
                {SENTIMENTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            {/* Journalist link */}
            <div className="col-span-2" ref={jRef}>
              <label className="form-label">Link to journalist <span className="text-slate-400 font-normal">(optional)</span></label>
              {form.journalistId ? (
                <div className="flex items-center gap-2">
                  <Link
                    to={`/journalists/${form.journalistId}`}
                    target="_blank"
                    className="text-sm text-northstar-600 hover:underline flex items-center gap-1"
                  >
                    {form.journalistName}
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                  <button onClick={handleClearJournalist} className="text-slate-400 hover:text-rose-500 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    className="form-input"
                    placeholder="Search journalist name…"
                    value={jSearch}
                    onChange={e => { setJSearch(e.target.value); setJOpen(true); }}
                    onFocus={() => setJOpen(true)}
                  />
                  {jOpen && filteredJournalists.length > 0 && (
                    <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                      {filteredJournalists.map(j => (
                        <button
                          key={j.id}
                          className="w-full text-left px-4 py-2.5 hover:bg-northstar-50 flex items-center justify-between"
                          onMouseDown={() => handleSelectJournalist(j)}
                        >
                          <div>
                            <div className="text-sm font-medium text-slate-900">{j.name}</div>
                            <div className="text-xs text-slate-400">{j.publication} · {j.beat}</div>
                          </div>
                          <ChevronDown className="w-3.5 h-3.5 text-slate-300 rotate-[-90deg]" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Summary */}
            <div className="col-span-2">
              <label className="form-label">Summary / key quote <span className="text-slate-400 font-normal">(optional)</span></label>
              <textarea
                className="form-textarea"
                rows={3}
                placeholder="What did the article say about us? Any key quotes?"
                value={form.summary}
                onChange={e => setForm(f => ({ ...f, summary: e.target.value }))}
              />
            </div>

            {/* Notes */}
            <div className="col-span-2">
              <label className="form-label">Internal notes <span className="text-slate-400 font-normal">(optional)</span></label>
              <textarea
                className="form-textarea"
                rows={2}
                placeholder="Context, follow-up actions, how this coverage came about…"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !form.title.trim()}
              className="btn-primary"
            >
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add coverage'}
            </button>
            <button onClick={() => { setShowForm(false); setEditing(null); }} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="form-input pl-9"
            placeholder="Search title, publication or journalist…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="form-select text-sm" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {COVERAGE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select className="form-select text-sm" value={sentimentFilter} onChange={e => setSentimentFilter(e.target.value)}>
          <option value="">All sentiments</option>
          {SENTIMENTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {(search || typeFilter || sentimentFilter) && (
          <button
            onClick={() => { setSearch(''); setTypeFilter(''); setSentimentFilter(''); }}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Coverage list */}
      {loading ? (
        <div className="card p-8 text-center text-slate-400">Loading…</div>
      ) : items.length === 0 ? (
        <div className="card p-12 text-center">
          <Newspaper className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <div className="text-slate-500 font-medium">No coverage tracked yet</div>
          <div className="text-slate-400 text-sm mt-1">Add your first article to start building your press log.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className="card p-5 hover:shadow-sm transition-shadow group">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  {/* Title + badges */}
                  <div className="flex items-start gap-2 flex-wrap mb-1">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${TYPE_COLORS[item.coverageType]}`}>
                      {COVERAGE_TYPES.find(t => t.value === item.coverageType)?.label || item.coverageType}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${sentimentStyle(item.sentiment)}`}>
                      {item.sentiment}
                    </span>
                  </div>

                  <div className="flex items-start gap-2">
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-slate-900 hover:text-northstar-600 flex items-center gap-1.5 text-sm leading-snug"
                      >
                        {item.title}
                        <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-50" />
                      </a>
                    ) : (
                      <span className="font-semibold text-slate-900 text-sm leading-snug">{item.title}</span>
                    )}
                  </div>

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-slate-500">
                    {item.publication && <span className="font-medium text-slate-700">{item.publication}</span>}
                    {item.publishDate && <span>{item.publishDate}</span>}
                    {(item.linkedJournalistName || item.journalistName) && (
                      <>
                        <span className="text-slate-300">·</span>
                        {item.journalistId ? (
                          <Link
                            to={`/journalists/${item.journalistId}`}
                            className="text-northstar-600 hover:underline flex items-center gap-0.5 font-medium"
                          >
                            {item.linkedJournalistName || item.journalistName}
                          </Link>
                        ) : (
                          <span>{item.journalistName}</span>
                        )}
                      </>
                    )}
                  </div>

                  {item.summary && (
                    <p className="text-sm text-slate-600 mt-2 leading-relaxed line-clamp-2">{item.summary}</p>
                  )}
                  {item.notes && (
                    <p className="text-xs text-slate-400 mt-1 italic">{item.notes}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEdit(item)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-northstar-600 hover:bg-northstar-50 transition-colors"
                    title="Edit"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
