import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, Plus, Trash2, Calendar, Users } from 'lucide-react';
import { campaigns as api } from '../api';
import type { Campaign, CampaignType } from '../types';

const TYPE_LABELS: Record<CampaignType, string> = {
  cold_intro:    'Cold Introduction',
  event:         'Event Coverage',
  hackathon:     'Hackathon',
  founder_promo: 'Founder Spotlight',
};

const TYPE_COLORS: Record<CampaignType, string> = {
  cold_intro:    'bg-slate-100 text-slate-700',
  event:         'bg-blue-50 text-blue-700',
  hackathon:     'bg-violet-50 text-violet-700',
  founder_promo: 'bg-amber-50 text-amber-700',
};

const STATUS_COLORS: Record<string, string> = {
  draft:     'bg-slate-100 text-slate-600',
  active:    'bg-emerald-50 text-emerald-700',
  completed: 'bg-indigo-50 text-indigo-700',
};

export default function CampaignList() {
  const [list, setList] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'cold_intro' as CampaignType, brief: '' });
  const [saving, setSaving] = useState(false);

  const load = () => api.list().then(r => setList(r.data)).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.brief.trim()) return;
    setSaving(true);
    await api.create(form);
    setSaving(false);
    setShowForm(false);
    setForm({ name: '', type: 'cold_intro', brief: '' });
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this campaign and all its drafts?')) return;
    await api.delete(id);
    load();
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-northstar-600" />
            Outreach Campaigns
          </h1>
          <p className="text-slate-500 mt-1">
            {list.length} campaign{list.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowForm(v => !v)}>
          <Plus className="w-4 h-4" /> New Campaign
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="card p-5 mb-6 border-northstar-200 bg-northstar-50">
          <h3 className="font-semibold text-slate-900 mb-4">New Campaign</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="form-label">Campaign name</label>
              <input
                className="form-input"
                placeholder="e.g. Cold Intro — Q3 2026"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="form-label">Type</label>
              <select
                className="form-select"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as CampaignType }))}
              >
                {Object.entries(TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="form-label">
                Brief
                <span className="text-slate-400 font-normal ml-1">
                  — what are you pitching? Claude uses this to write each email.
                </span>
              </label>
              <textarea
                className="form-textarea"
                rows={4}
                placeholder={
                  form.type === 'cold_intro'
                    ? "Introduce North Star AI Labs — who we are, what we do, why we're interesting to cover. Include any specific stories or angles you want journalists to know about."
                    : form.type === 'event'
                    ? "Event name, date, location, what's happening, why it's newsworthy, who's attending..."
                    : form.type === 'hackathon'
                    ? "Hackathon name, date, theme, prize, expected participants, what makes it unique..."
                    : "Founder name, company, what they've built, traction, the story angle..."
                }
                value={form.brief}
                onChange={e => setForm(f => ({ ...f, brief: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={saving || !form.name.trim() || !form.brief.trim()}
            >
              {saving ? 'Creating…' : 'Create Campaign'}
            </button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Campaign list */}
      {loading ? (
        <div className="card p-8 text-center text-slate-400">Loading…</div>
      ) : list.length === 0 ? (
        <div className="card p-12 text-center">
          <Megaphone className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <div className="text-slate-500 font-medium">No campaigns yet</div>
          <div className="text-slate-400 text-sm mt-1">Create one to start drafting personalised outreach with Claude.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(c => (
            <Link
              key={c.id}
              to={`/campaigns/${c.id}`}
              className="card p-5 flex items-center gap-5 hover:border-northstar-300 hover:shadow-sm transition-all group"
            >
              {/* Type + name */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[c.type]}`}>
                    {TYPE_LABELS[c.type]}
                  </span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[c.status]}`}>
                    {c.status}
                  </span>
                </div>
                <div className="font-semibold text-slate-900 group-hover:text-northstar-700 truncate">
                  {c.name}
                </div>
                {c.brief && (
                  <div className="text-sm text-slate-400 mt-0.5 truncate">{c.brief}</div>
                )}
              </div>

              {/* Stats */}
              <div className="flex items-center gap-6 shrink-0">
                <div className="text-center">
                  <div className="flex items-center gap-1 text-slate-500">
                    <Users className="w-3.5 h-3.5" />
                    <span className="text-sm font-semibold text-slate-700">{c.journalistCount ?? 0}</span>
                  </div>
                  <div className="text-xs text-slate-400">journalists</div>
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold text-emerald-600">{c.sentCount ?? 0}</div>
                  <div className="text-xs text-slate-400">sent</div>
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-400">
                  <Calendar className="w-3 h-3" />
                  {new Date(c.createdAt).toLocaleDateString()}
                </div>
              </div>

              {/* Delete */}
              <button
                className="opacity-0 group-hover:opacity-100 btn-danger text-xs px-2 py-1 transition-opacity"
                onClick={e => { e.preventDefault(); handleDelete(c.id); }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
