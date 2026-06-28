import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, Info, ExternalLink } from 'lucide-react';
import { journalists as api, publications as pubApi } from '../api';
import type { Publication } from '../types';

const STATUSES = ['Not Started', 'Researching', 'Ready to Pitch', 'Pitched', 'Responded', 'In Conversation', 'Covered', 'Not a Fit', 'On Hold'];
const PUB_TYPES = ['National', 'Regional', 'Trade', 'Blog', 'Newsletter', 'Podcast', 'Wire', 'Other'];

const empty = {
  name: '', publication: '', roleTitle: '', beat: '', location: '', publicationType: '',
  aiRelevanceScore: 0, startupRelevanceScore: 0, northStarFitScore: 0,
  publicationAuthorityScore: 0, audienceReachScore: 0, contactabilityScore: 0,
  email: '', contactUrl: '', linkedinUrl: '', twitterUrl: '', personalWebsite: '', muckRackUrl: '',
  bestPitchAngle: '', notes: '', outreachStatus: 'Not Started',
  lastContactedDate: '', nextFollowUpDate: '',
};

function calcTotal(form: typeof empty) {
  return Math.min(form.aiRelevanceScore, 25) +
    Math.min(form.startupRelevanceScore, 20) +
    Math.min(form.northStarFitScore, 20) +
    Math.min(form.publicationAuthorityScore, 15) +
    Math.min(form.audienceReachScore, 10) +
    Math.min(form.contactabilityScore, 10);
}

function calcTier(total: number) {
  return total >= 80 ? 1 : total >= 60 ? 2 : total >= 40 ? 3 : 4;
}

export default function JournalistForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const [form, setForm] = useState<any>({ ...empty });
  const [saving, setSaving] = useState(false);
  const [pubList, setPubList] = useState<Publication[]>([]);
  const [pubSearch, setPubSearch] = useState('');
  const [showPubDropdown, setShowPubDropdown] = useState(false);

  useEffect(() => {
    pubApi.list().then(r => setPubList(r.data.filter((p: Publication) => p.active)));
  }, []);

  useEffect(() => {
    if (isEdit && id) {
      api.get(Number(id)).then(r => {
        setForm(r.data);
        setPubSearch(r.data.publication || '');
      });
    }
  }, [id, isEdit]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const total = calcTotal(form);
  const tier = calcTier(total);

  const handleSubmit = async () => {
    if (!form.name) return alert('Name is required');
    setSaving(true);
    try {
      if (isEdit) {
        await api.update(Number(id), form);
        navigate(`/journalists/${id}`);
      } else {
        const res = await api.create(form);
        navigate(`/journalists/${res.data.id}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link to={isEdit ? `/journalists/${id}` : '/journalists'} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-5">
        <ChevronLeft className="w-4 h-4" /> {isEdit ? 'Back to journalist' : 'Back to list'}
      </Link>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{isEdit ? 'Edit Journalist' : 'Add Journalist'}</h1>
        <div className="flex items-center gap-3">
          <div className="text-sm text-slate-500">Calculated score:</div>
          <div className="text-2xl font-bold text-northstar-600">{total}</div>
          <div className="text-sm text-slate-400">/ 100 · Tier {tier}</div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Basic Info */}
        <Section title="Basic Information">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Name *</label>
              <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="relative">
              <label className="form-label">Publication</label>
              <input
                className="form-input"
                value={pubSearch}
                onChange={e => {
                  setPubSearch(e.target.value);
                  set('publication', e.target.value);
                  setShowPubDropdown(true);
                }}
                onFocus={() => setShowPubDropdown(true)}
                onBlur={() => setTimeout(() => setShowPubDropdown(false), 150)}
                placeholder="Search or type a publication..."
              />
              {showPubDropdown && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {pubList
                    .filter(p => p.name.toLowerCase().includes(pubSearch.toLowerCase()) || pubSearch === '')
                    .map(p => (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-northstar-50 flex items-center justify-between group"
                        onMouseDown={() => {
                          set('publication', p.name);
                          setPubSearch(p.name);
                          setShowPubDropdown(false);
                        }}
                      >
                        <span className="text-sm text-slate-900">{p.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          p.tier === 'A' ? 'bg-northstar-100 text-northstar-700' :
                          p.tier === 'B' ? 'bg-blue-50 text-blue-600' :
                          'bg-slate-100 text-slate-500'
                        }`}>Tier {p.tier}</span>
                      </button>
                    ))}
                  {pubList.filter(p => p.name.toLowerCase().includes(pubSearch.toLowerCase()) || pubSearch === '').length === 0 && (
                    <div className="px-3 py-2 text-sm text-slate-400">No match — value will be saved as typed</div>
                  )}
                </div>
              )}
              {form.publication && pubList.find(p => p.name === form.publication)?.url && (
                <a
                  href={pubList.find(p => p.name === form.publication)!.url}
                  target="_blank" rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-northstar-500 hover:underline"
                >
                  <ExternalLink className="w-3 h-3" /> Visit site
                </a>
              )}
            </div>
            <div>
              <label className="form-label">Role / Title</label>
              <input className="form-input" value={form.roleTitle} onChange={e => set('roleTitle', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Beat</label>
              <input className="form-input" value={form.beat} onChange={e => set('beat', e.target.value)} placeholder="AI, Startups, Tech, Education..." />
            </div>
            <div>
              <label className="form-label">Location</label>
              <input className="form-input" value={form.location} onChange={e => set('location', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Publication Type</label>
              <select className="form-select" value={form.publicationType} onChange={e => set('publicationType', e.target.value)}>
                <option value="">Select...</option>
                {PUB_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </Section>

        {/* Scoring */}
        <Section title="Relevance Scoring">
          <div className="mb-3 flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Score each dimension to calculate the journalist's total priority score.
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ScoreField label="AI Relevance" max={25} value={form.aiRelevanceScore}
              hint="Coverage of AI/ML/LLM topics"
              onChange={v => set('aiRelevanceScore', v)} />
            <ScoreField label="Startup Relevance" max={20} value={form.startupRelevanceScore}
              hint="Covers startup ecosystem"
              onChange={v => set('startupRelevanceScore', v)} />
            <ScoreField label="North Star Fit" max={20} value={form.northStarFitScore}
              hint="Alignment with NS AI Labs mission"
              onChange={v => set('northStarFitScore', v)} />
            <ScoreField label="Publication Authority" max={15} value={form.publicationAuthorityScore}
              hint="Reach and credibility of publication"
              onChange={v => set('publicationAuthorityScore', v)} />
            <ScoreField label="Audience Reach" max={10} value={form.audienceReachScore}
              hint="Readership / social following"
              onChange={v => set('audienceReachScore', v)} />
            <ScoreField label="Contactability" max={10} value={form.contactabilityScore}
              hint="How easy to reach and responsive"
              onChange={v => set('contactabilityScore', v)} />
          </div>
        </Section>

        {/* Contact */}
        <Section title="Contact Information">
          <p className="text-xs text-slate-500 mb-3">Only add publicly available professional contact info.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Contact Page URL</label>
              <input className="form-input" value={form.contactUrl} onChange={e => set('contactUrl', e.target.value)} placeholder="https://" />
            </div>
            <div>
              <label className="form-label">LinkedIn URL</label>
              <input className="form-input" value={form.linkedinUrl} onChange={e => set('linkedinUrl', e.target.value)} placeholder="https://linkedin.com/in/..." />
            </div>
            <div>
              <label className="form-label">Twitter/X URL</label>
              <input className="form-input" value={form.twitterUrl} onChange={e => set('twitterUrl', e.target.value)} placeholder="https://x.com/..." />
            </div>
            <div>
              <label className="form-label">Personal Website</label>
              <input className="form-input" value={form.personalWebsite} onChange={e => set('personalWebsite', e.target.value)} placeholder="https://" />
            </div>
            <div>
              <label className="form-label">MuckRack URL</label>
              <input className="form-input" value={form.muckRackUrl} onChange={e => set('muckRackUrl', e.target.value)} placeholder="https://muckrack.com/..." />
            </div>
          </div>
        </Section>

        {/* Outreach */}
        <Section title="Outreach & Notes">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Outreach Status</label>
              <select className="form-select" value={form.outreachStatus} onChange={e => set('outreachStatus', e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Last Contacted Date</label>
              <input className="form-input" type="date" value={form.lastContactedDate} onChange={e => set('lastContactedDate', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Next Follow-up Date</label>
              <input className="form-input" type="date" value={form.nextFollowUpDate} onChange={e => set('nextFollowUpDate', e.target.value)} />
            </div>
          </div>
          <div className="mt-4">
            <label className="form-label">Best Pitch Angle</label>
            <textarea className="form-textarea" rows={3} value={form.bestPitchAngle} onChange={e => set('bestPitchAngle', e.target.value)}
              placeholder="What story would resonate with this journalist? Why does North Star AI Labs fit their beat?" />
          </div>
          <div className="mt-3">
            <label className="form-label">Internal Notes</label>
            <textarea className="form-textarea" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Any notes about this journalist, their preferences, past interactions, etc." />
          </div>
        </Section>
      </div>

      <div className="flex items-center gap-3 mt-8">
        <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Journalist'}
        </button>
        <Link to={isEdit ? `/journalists/${id}` : '/journalists'} className="btn-secondary">Cancel</Link>
        <div className="ml-auto text-sm text-slate-500">Score: <strong className="text-northstar-600">{total}/100</strong> · Tier {tier}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h2 className="font-semibold text-slate-900 mb-4 pb-3 border-b border-slate-100">{title}</h2>
      {children}
    </div>
  );
}

function ScoreField({ label, max, value, hint, onChange }: {
  label: string; max: number; value: number; hint: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="form-label mb-0">{label}</label>
        <span className="text-xs text-slate-400">max {max}</span>
      </div>
      <div className="text-xs text-slate-400 mb-1">{hint}</div>
      <div className="flex items-center gap-2">
        <input
          type="range" min={0} max={max} value={value}
          className="flex-1 accent-northstar-600"
          onChange={e => onChange(Number(e.target.value))}
        />
        <input
          type="number" min={0} max={max} value={value}
          className="form-input w-16 text-center"
          onChange={e => onChange(Math.min(max, Math.max(0, Number(e.target.value))))}
        />
      </div>
    </div>
  );
}
