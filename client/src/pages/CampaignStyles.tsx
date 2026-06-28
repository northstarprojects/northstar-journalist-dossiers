import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Save, Check, Sparkles } from 'lucide-react';
import { campaignStyles as api } from '../api';

type CampaignType = 'cold_intro' | 'event' | 'hackathon' | 'founder_promo';

const TYPE_META: Record<CampaignType, { label: string; color: string; placeholder: string }> = {
  cold_intro: {
    label: 'Cold Introduction',
    color: 'border-slate-300 focus:border-slate-400',
    placeholder: `Examples:
- Always sign off as: Letitia Chang, Head of Communications, North Star AI Labs
- End every email with: "Happy to send over our latest research brief if useful."
- Never mention funding rounds or valuations.
- Keep the intro to one sentence — journalists know who we are.`,
  },
  event: {
    label: 'Event Coverage',
    color: 'border-blue-200 focus:border-blue-400',
    placeholder: `Examples:
- Always include the event date and city in the first paragraph.
- Offer a press pass or reserved seat in every email.
- Mention that founders from [specific company] will be attending if relevant.`,
  },
  hackathon: {
    label: 'Hackathon',
    color: 'border-violet-200 focus:border-violet-400',
    placeholder: `Examples:
- Emphasise the prize pool and number of expected participants.
- Lead with the problem statement the hackathon is solving, not the logistics.
- Always include a link to last year's winner story if available.`,
  },
  founder_promo: {
    label: 'Founder Spotlight',
    color: 'border-amber-200 focus:border-amber-400',
    placeholder: `Examples:
- Lead with the founder's origin story before the company description.
- Always reference traction metrics if the founder has provided them.
- Avoid "disruptive" — use specific, concrete language about what they've built.`,
  },
};

interface StyleRow {
  type: CampaignType;
  instructions: string;
  updatedAt: string;
}

export default function CampaignStyles() {
  const [styles, setStyles] = useState<Record<CampaignType, string>>({
    cold_intro: '', event: '', hackathon: '', founder_promo: '',
  });
  const [savedAt, setSavedAt] = useState<Record<CampaignType, string>>({
    cold_intro: '', event: '', hackathon: '', founder_promo: '',
  });
  const [saving, setSaving] = useState<CampaignType | null>(null);
  const [justSaved, setJustSaved] = useState<CampaignType | null>(null);

  useEffect(() => {
    api.list().then(r => {
      const s: Record<CampaignType, string> = { cold_intro: '', event: '', hackathon: '', founder_promo: '' };
      const d: Record<CampaignType, string> = { cold_intro: '', event: '', hackathon: '', founder_promo: '' };
      for (const row of r.data as StyleRow[]) {
        s[row.type] = row.instructions;
        d[row.type] = row.updatedAt;
      }
      setStyles(s);
      setSavedAt(d);
    });
  }, []);

  const handleSave = async (type: CampaignType) => {
    setSaving(type);
    await api.update(type, styles[type]);
    setSaving(null);
    setJustSaved(type);
    setSavedAt(prev => ({ ...prev, [type]: new Date().toISOString() }));
    setTimeout(() => setJustSaved(null), 2000);
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <Link to="/campaigns" className="text-sm text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-5">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to campaigns
      </Link>

      <div className="mb-7">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-northstar-500" /> House Style
        </h1>
        <p className="text-slate-500 mt-1 text-sm max-w-xl">
          Standing instructions Claude follows when drafting emails for each campaign type.
          Write anything you'd normally edit in by hand — sign-off name, mandatory disclaimers,
          tone rules, things to always or never say.
        </p>
      </div>

      <div className="space-y-6">
        {(Object.keys(TYPE_META) as CampaignType[]).map(type => {
          const meta = TYPE_META[type];
          const isSaving = saving === type;
          const isSaved = justSaved === type;
          const lastSaved = savedAt[type];
          const hasContent = styles[type].trim().length > 0;

          return (
            <div key={type} className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-slate-900">{meta.label}</h2>
                  {hasContent && (
                    <span className="text-xs bg-northstar-50 text-northstar-600 border border-northstar-100 px-2 py-0.5 rounded-full font-medium">
                      active
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {lastSaved && (
                    <span className="text-xs text-slate-400">
                      saved {new Date(lastSaved).toLocaleDateString()}
                    </span>
                  )}
                  <button
                    onClick={() => handleSave(type)}
                    disabled={isSaving}
                    className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                      isSaved
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-northstar-600 text-white hover:bg-northstar-700'
                    }`}
                  >
                    {isSaved
                      ? <><Check className="w-3.5 h-3.5" /> Saved</>
                      : <><Save className="w-3.5 h-3.5" /> {isSaving ? 'Saving…' : 'Save'}</>
                    }
                  </button>
                </div>
              </div>

              <textarea
                className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-northstar-200 resize-none font-mono leading-relaxed ${meta.color}`}
                rows={6}
                value={styles[type]}
                onChange={e => setStyles(prev => ({ ...prev, [type]: e.target.value }))}
                placeholder={meta.placeholder}
              />

              <p className="text-xs text-slate-400 mt-2">
                These instructions are appended to every Claude prompt for <strong>{meta.label}</strong> campaigns.
                They take effect immediately on the next draft generation — no need to regenerate existing campaigns.
              </p>
            </div>
          );
        })}
      </div>

      {/* Tip */}
      <div className="mt-6 px-4 py-3 rounded-lg bg-blue-50 border border-blue-100 text-blue-800 text-sm">
        <strong>Tip:</strong> The more specific you are, the better. Instead of "be professional", write
        "avoid emojis, don't use exclamation marks, and never start a sentence with 'Exciting'."
        Claude follows literal instructions much better than style adjectives.
      </div>
    </div>
  );
}
