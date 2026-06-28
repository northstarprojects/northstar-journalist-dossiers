import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Edit2, Trash2, ExternalLink, Mail, AtSign, Link2, Globe, FileText,
  MessageSquare, ChevronLeft, Plus, Target, Sparkles, TrendingUp,
  Clock, Send, CheckCircle2, XCircle, AlertCircle,
} from 'lucide-react';
import { journalists as jApi, articles as aApi, outreach as oApi, enrichment as enrichApi } from '../api';
import type { Journalist, Article, OutreachLog } from '../types';
import TierBadge from '../components/TierBadge';
import StatusBadge from '../components/StatusBadge';
import ArticleForm from '../components/ArticleForm';
import OutreachForm from '../components/OutreachForm';

export default function JournalistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [journalist, setJournalist] = useState<Journalist | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [outreach, setOutreach] = useState<OutreachLog[]>([]);
  const [tab, setTab] = useState<'overview' | 'articles' | 'outreach' | 'briefing'>('overview');
  const [showArticleForm, setShowArticleForm] = useState(false);
  const [showOutreachForm, setShowOutreachForm] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const [editingOutreach, setEditingOutreach] = useState<OutreachLog | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<{ email?: string; status?: string; error?: string } | null>(null);

  const loadData = () => {
    if (!id) return;
    jApi.get(Number(id)).then(r => setJournalist(r.data));
    aApi.byJournalist(Number(id)).then(r => setArticles(r.data));
    oApi.byJournalist(Number(id)).then(r => setOutreach(r.data));
  };

  useEffect(() => { loadData(); }, [id]);

  const handleDelete = async () => {
    if (!confirm('Delete this journalist? This cannot be undone.')) return;
    await jApi.delete(Number(id));
    navigate('/journalists');
  };

  const handleEnrich = async () => {
    setEnriching(true);
    setEnrichResult(null);
    try {
      const r = await enrichApi.enrich(Number(id));
      const { email, emailStatus, saved } = r.data;
      setEnrichResult({ email, status: emailStatus });
      if (saved) loadData(); // refresh journalist so email appears in contact links
    } catch (err: any) {
      setEnrichResult({ error: err.response?.data?.error || 'Apollo lookup failed.' });
    } finally {
      setEnriching(false);
    }
  };

  if (!journalist) return <div className="p-8 text-slate-400">Loading...</div>;

  // ── Relationship stats derived from outreach logs ──────────────────────
  const pitchesSent = outreach.filter(o =>
    ['Sent', 'No Response', 'Pitched'].includes(o.status)
  ).length;
  const hasResponded = outreach.some(o =>
    ['Responded', 'Meeting Scheduled', 'Covered', 'In Conversation'].includes(o.status)
  );
  const hasCovered = outreach.some(o => o.status === 'Covered');
  const hasDeclined = outreach.some(o => ['Not a Fit', 'Declined'].includes(o.status));

  const daysSinceContact = (() => {
    if (!journalist.lastContactedDate) return null;
    const diff = Math.floor(
      (Date.now() - new Date(journalist.lastContactedDate).getTime()) / 86_400_000
    );
    return diff;
  })();

  const lastLog = outreach[0]; // already sorted desc by server

  const scoreItems = [
    { label: 'AI Relevance', value: journalist.aiRelevanceScore, max: 25 },
    { label: 'Startup Relevance', value: journalist.startupRelevanceScore, max: 20 },
    { label: 'North Star Fit', value: journalist.northStarFitScore, max: 20 },
    { label: 'Publication Authority', value: journalist.publicationAuthorityScore, max: 15 },
    { label: 'Audience Reach', value: journalist.audienceReachScore, max: 10 },
    { label: 'Contactability', value: journalist.contactabilityScore, max: 10 },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Back */}
      <Link to="/journalists" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-5">
        <ChevronLeft className="w-4 h-4" /> Back to journalists
      </Link>

      {/* Header */}
      <div className="card p-6 mb-5">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">{journalist.name}</h1>
              <TierBadge tier={journalist.priorityTier} />
              <StatusBadge status={journalist.outreachStatus} />
            </div>
            <div className="text-slate-600 mt-1">{journalist.roleTitle && `${journalist.roleTitle} · `}{journalist.publication}</div>
            {journalist.beat && <div className="text-sm text-slate-500 mt-0.5">Beat: {journalist.beat}</div>}
            {journalist.location && <div className="text-xs text-slate-400 mt-0.5">{journalist.location}</div>}

            {/* Contact links */}
            <div className="flex flex-wrap gap-2 mt-4">
              {journalist.email && (
                <a href={`mailto:${journalist.email}`} className="btn-secondary text-xs">
                  <Mail className="w-3 h-3" /> {journalist.email}
                </a>
              )}
              {!journalist.email && (
                <button
                  onClick={handleEnrich}
                  disabled={enriching}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-northstar-400 hover:text-northstar-600 hover:bg-northstar-50 transition-colors disabled:opacity-50"
                >
                  <Mail className="w-3 h-3" />
                  {enriching ? 'Looking up via Apollo…' : 'Find email via Apollo'}
                </button>
              )}
              {journalist.email && (
                <button
                  onClick={handleEnrich}
                  disabled={enriching}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-northstar-600 transition-colors disabled:opacity-50"
                  title="Re-run Apollo lookup"
                >
                  {enriching ? '…' : '↻ Apollo'}
                </button>
              )}
              {journalist.twitterUrl && (
                <a href={journalist.twitterUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
                  <AtSign className="w-3 h-3" /> Twitter/X
                </a>
              )}
              {journalist.linkedinUrl && (
                <a href={journalist.linkedinUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
                  <Link2 className="w-3 h-3" /> LinkedIn
                </a>
              )}
              {journalist.personalWebsite && (
                <a href={journalist.personalWebsite} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
                  <Globe className="w-3 h-3" /> Website
                </a>
              )}
              {journalist.muckRackUrl && (
                <a href={journalist.muckRackUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
                  <ExternalLink className="w-3 h-3" /> MuckRack
                </a>
              )}
              {journalist.contactUrl && (
                <a href={journalist.contactUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
                  <ExternalLink className="w-3 h-3" /> Contact Page
                </a>
              )}
            </div>

            {/* Apollo enrichment result */}
            {enrichResult && (
              <div className={`mt-3 px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
                enrichResult.error
                  ? 'bg-rose-50 border border-rose-200 text-rose-700'
                  : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              }`}>
                {enrichResult.error ? (
                  <><XCircle className="w-3.5 h-3.5 shrink-0" /> {enrichResult.error}</>
                ) : (
                  <><CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    Found: <strong>{enrichResult.email}</strong>
                    {enrichResult.status && enrichResult.status !== 'unknown' && (
                      <span className="ml-1 text-xs opacity-70">({enrichResult.status})</span>
                    )}
                    {journalist.email ? ' — already saved to profile.' : ' — saved to profile.'}
                  </>
                )}
              </div>
            )}

            {/* Relationship summary strip — inside flex-1 */}
            {outreach.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-4 pt-4 border-t border-slate-100 text-sm">
                {pitchesSent > 0 && (
                  <span className="flex items-center gap-1 text-slate-600">
                    <Send className="w-3.5 h-3.5 text-slate-400" />
                    <strong>{pitchesSent}</strong> pitch{pitchesSent !== 1 ? 'es' : ''} sent
                  </span>
                )}
                {daysSinceContact !== null && (
                  <span className="flex items-center gap-1 text-slate-600">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    last contact{' '}
                    <strong>{daysSinceContact === 0 ? 'today' : `${daysSinceContact}d ago`}</strong>
                  </span>
                )}
                {hasCovered && (
                  <span className="flex items-center gap-1 text-emerald-600 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> has covered us
                  </span>
                )}
                {!hasCovered && hasResponded && (
                  <span className="flex items-center gap-1 text-blue-600 font-medium">
                    <TrendingUp className="w-3.5 h-3.5" /> has responded
                  </span>
                )}
                {hasDeclined && (
                  <span className="flex items-center gap-1 text-rose-500 font-medium">
                    <XCircle className="w-3.5 h-3.5" /> declined
                  </span>
                )}
                {!hasResponded && !hasDeclined && pitchesSent > 0 && (
                  <span className="flex items-center gap-1 text-amber-600">
                    <AlertCircle className="w-3.5 h-3.5" /> no reply yet
                  </span>
                )}
                {lastLog && (
                  <span className="text-slate-400 text-xs">
                    · last: {lastLog.status}{lastLog.channel ? ` via ${lastLog.channel}` : ''}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 ml-4">
            <div className="text-center mr-4">
              <div className="text-3xl font-bold text-northstar-600">{journalist.totalScore}</div>
              <div className="text-xs text-slate-400">/ 100</div>
            </div>
            <Link to={`/journalists/${id}/edit`} className="btn-secondary"><Edit2 className="w-4 h-4" /> Edit</Link>
            <button onClick={handleDelete} className="btn-danger"><Trash2 className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-5 gap-0">
        {(['overview', 'articles', 'outreach', 'briefing'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
              tab === t ? 'border-northstar-600 text-northstar-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'articles' ? `Articles (${articles.length})` : t === 'outreach' ? `Outreach (${outreach.length})` : t}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card p-5">
            <h3 className="font-semibold text-slate-900 mb-4">Score Breakdown</h3>
            <div className="space-y-3">
              {scoreItems.map(s => (
                <div key={s.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">{s.label}</span>
                    <span className="font-medium text-slate-900">{s.value} / {s.max}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div
                      className="bg-northstar-500 h-2 rounded-full transition-all"
                      style={{ width: `${(s.value / s.max) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center">
              <span className="text-sm font-medium text-slate-700">Total Score</span>
              <span className="text-xl font-bold text-northstar-600">{journalist.totalScore} / 100</span>
            </div>
          </div>

          <div className="space-y-4">
            {journalist.bestPitchAngle && (
              <div className="card p-5">
                <h3 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
                  <Target className="w-4 h-4 text-northstar-500" /> Best Pitch Angle
                </h3>
                <p className="text-sm text-slate-600">{journalist.bestPitchAngle}</p>
              </div>
            )}
            {journalist.notes && (
              <div className="card p-5">
                <h3 className="font-semibold text-slate-900 mb-2">Notes</h3>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{journalist.notes}</p>
              </div>
            )}
            <div className="card p-5">
              <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-northstar-500" /> Relationship
              </h3>
              {outreach.length === 0 ? (
                <p className="text-sm text-slate-400">No outreach logged yet.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Total interactions</span>
                    <span className="font-semibold text-slate-800">{outreach.length}</span>
                  </div>
                  {pitchesSent > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Pitches sent</span>
                      <span className="font-semibold text-slate-800">{pitchesSent}</span>
                    </div>
                  )}
                  {journalist.lastContactedDate && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Last contacted</span>
                      <span className={`font-medium ${daysSinceContact !== null && daysSinceContact > 60 ? 'text-rose-500' : daysSinceContact !== null && daysSinceContact > 30 ? 'text-amber-600' : 'text-slate-700'}`}>
                        {journalist.lastContactedDate}
                        {daysSinceContact !== null && (
                          <span className="text-slate-400 font-normal ml-1">({daysSinceContact}d ago)</span>
                        )}
                      </span>
                    </div>
                  )}
                  {journalist.nextFollowUpDate && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Follow-up due</span>
                      <span className="text-amber-600 font-medium">{journalist.nextFollowUpDate}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2 mt-1">
                    {hasCovered && <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium">✅ Has covered us</span>}
                    {!hasCovered && hasResponded && <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">💬 Has responded</span>}
                    {hasDeclined && <span className="text-xs bg-rose-50 text-rose-600 px-2 py-0.5 rounded-full font-medium">❌ Declined</span>}
                    {!hasResponded && !hasDeclined && pitchesSent > 0 && <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium">⏳ No reply yet</span>}
                    {outreach.length === 0 && <span className="text-xs bg-slate-50 text-slate-500 px-2 py-0.5 rounded-full">🆕 Never contacted</span>}
                  </div>
                </div>
              )}
              {journalist.publicationType && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between text-sm">
                  <span className="text-slate-500">Publication type</span>
                  <span className="text-slate-700">{journalist.publicationType}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Articles tab */}
      {tab === 'articles' && (
        <div>
          <div className="flex justify-end mb-4">
            <button className="btn-primary" onClick={() => { setEditingArticle(null); setShowArticleForm(true); }}>
              <Plus className="w-4 h-4" /> Add Article
            </button>
          </div>
          {showArticleForm && (
            <ArticleForm
              journalistId={Number(id)}
              article={editingArticle}
              onSave={() => { setShowArticleForm(false); setEditingArticle(null); loadData(); }}
              onCancel={() => { setShowArticleForm(false); setEditingArticle(null); }}
            />
          )}
          {articles.length === 0 ? (
            <div className="card p-8 text-center text-slate-400">
              <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              No articles added yet.
            </div>
          ) : (
            <div className="space-y-3">
              {articles.map(a => (
                <div key={a.id} className="card p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-start gap-2">
                        <a href={a.url} target="_blank" rel="noreferrer" className="font-medium text-slate-900 hover:text-northstar-600 flex items-center gap-1">
                          {a.title} {a.url && <ExternalLink className="w-3 h-3 shrink-0" />}
                        </a>
                      </div>
                      <div className="flex gap-3 text-xs text-slate-500 mt-1">
                        {a.publishDate && <span>{a.publishDate}</span>}
                        {a.topic && <span>· {a.topic}</span>}
                        {a.storyType && <span>· {a.storyType}</span>}
                      </div>
                      {a.summary && <p className="text-sm text-slate-600 mt-2">{a.summary}</p>}
                      {a.relevanceToNorthStar && (
                        <p className="text-xs text-northstar-600 mt-1 bg-northstar-50 rounded px-2 py-1">
                          <strong>Relevance:</strong> {a.relevanceToNorthStar}
                        </p>
                      )}
                      {a.usefulAngle && (
                        <p className="text-xs text-green-700 mt-1 bg-green-50 rounded px-2 py-1">
                          <strong>Angle:</strong> {a.usefulAngle}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button className="btn-secondary text-xs px-2 py-1" onClick={() => { setEditingArticle(a); setShowArticleForm(true); }}>
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button className="btn-danger text-xs px-2 py-1" onClick={async () => {
                        if (confirm('Delete article?')) { await aApi.delete(a.id); loadData(); }
                      }}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Outreach tab */}
      {tab === 'outreach' && (
        <div>
          <div className="flex justify-end mb-4">
            <button className="btn-primary" onClick={() => { setEditingOutreach(null); setShowOutreachForm(true); }}>
              <Plus className="w-4 h-4" /> Log Outreach
            </button>
          </div>
          {showOutreachForm && (
            <OutreachForm
              journalistId={Number(id)}
              log={editingOutreach}
              onSave={() => { setShowOutreachForm(false); setEditingOutreach(null); loadData(); }}
              onCancel={() => { setShowOutreachForm(false); setEditingOutreach(null); }}
            />
          )}
          {outreach.length === 0 ? (
            <div className="card p-8 text-center text-slate-400">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              No outreach logged yet.
            </div>
          ) : (
            <div className="space-y-3">
              {outreach.map(o => (
                <div key={o.id} className="card p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-900">{o.subjectLine || o.messageType}</span>
                        <StatusBadge status={o.status} />
                        {o.channel && <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{o.channel}</span>}
                        {o.date && <span className="text-xs text-slate-400">{o.date}</span>}
                      </div>
                      {o.messageBody && (
                        <p className="text-sm text-slate-600 mt-2 bg-slate-50 rounded p-2 whitespace-pre-wrap">{o.messageBody}</p>
                      )}
                      {o.response && (
                        <p className="text-sm text-green-700 mt-2 bg-green-50 rounded p-2">
                          <strong>Response:</strong> {o.response}
                        </p>
                      )}
                      {o.nextStep && (
                        <p className="text-xs text-amber-700 mt-1">
                          <strong>Next step:</strong> {o.nextStep}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button className="btn-secondary text-xs px-2 py-1" onClick={() => { setEditingOutreach(o); setShowOutreachForm(true); }}>
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button className="btn-danger text-xs px-2 py-1" onClick={async () => {
                        if (confirm('Delete log?')) { await oApi.delete(o.id); loadData(); }
                      }}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Briefing tab */}
      {tab === 'briefing' && (
        <BriefingView journalist={journalist} articles={articles} outreach={outreach} />
      )}
    </div>
  );
}

function BriefingView({ journalist, articles, outreach }: { journalist: Journalist; articles: Article[]; outreach: OutreachLog[] }) {
  const recentArticles = articles.slice(0, 6);
  const themes = [...new Set(articles.map(a => a.topic).filter(Boolean))].slice(0, 8);

  const nextAction = journalist.outreachStatus === 'Not Started'
    ? { label: 'Never contacted', action: 'Start with a brief intro email referencing their recent work.', color: 'bg-slate-50 border-slate-200 text-slate-700' }
    : journalist.outreachStatus === 'Ready to Pitch'
    ? { label: 'Ready to pitch', action: 'Prepare a personalised pitch. Use Campaigns to generate a Claude draft.', color: 'bg-northstar-50 border-northstar-200 text-northstar-800' }
    : journalist.outreachStatus === 'Pitched'
    ? { label: 'Awaiting reply', action: 'Follow up if no response after 5–7 business days.', color: 'bg-amber-50 border-amber-200 text-amber-800' }
    : journalist.outreachStatus === 'Responded'
    ? { label: 'In conversation', action: 'Respond promptly and offer a briefing or exclusive angle.', color: 'bg-blue-50 border-blue-200 text-blue-800' }
    : journalist.outreachStatus === 'Covered'
    ? { label: 'Has covered us ✓', action: 'Send a thank-you and stay in touch for future stories.', color: 'bg-emerald-50 border-emerald-200 text-emerald-800' }
    : { label: journalist.outreachStatus, action: 'Continue relationship building.', color: 'bg-slate-50 border-slate-200 text-slate-700' };

  return (
    <div className="space-y-5">
      {/* Next recommended action */}
      <div className={`rounded-xl border p-4 ${nextAction.color}`}>
        <div className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">Recommended next action · {nextAction.label}</div>
        <p className="text-sm font-medium">{nextAction.action}</p>
        <Link to="/campaigns" className="inline-block mt-2 text-xs font-medium underline underline-offset-2 opacity-70 hover:opacity-100">
          Open Campaigns →
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Profile snapshot */}
        <div className="card p-5">
          <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-northstar-500" /> Quick Profile
          </h3>
          <dl className="space-y-2 text-sm">
            {[
              ['Beat', journalist.beat],
              ['Role', journalist.roleTitle],
              ['Publication', journalist.publication],
              ['Location', journalist.location],
            ].map(([label, value]) => value ? (
              <div key={label} className="flex gap-3">
                <dt className="text-slate-400 w-24 shrink-0">{label}</dt>
                <dd className="text-slate-800 font-medium">{value}</dd>
              </div>
            ) : null)}
            <div className="flex gap-3">
              <dt className="text-slate-400 w-24 shrink-0">Score</dt>
              <dd className="font-bold text-northstar-600">{journalist.totalScore} / 100</dd>
            </div>
            {journalist.outreachStatus !== 'Not Started' && (
              <div className="flex gap-3">
                <dt className="text-slate-400 w-24 shrink-0">Status</dt>
                <dd><StatusBadge status={journalist.outreachStatus} /></dd>
              </div>
            )}
          </dl>
          {journalist.bestPitchAngle && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Best pitch angle</div>
              <p className="text-sm text-slate-700 leading-relaxed">{journalist.bestPitchAngle}</p>
            </div>
          )}
        </div>

        {/* Writing themes */}
        <div className="card p-5">
          <h3 className="font-semibold text-slate-900 mb-3">Writing Themes</h3>
          {themes.length > 0 ? (
            <div className="flex flex-wrap gap-2 mb-4">
              {themes.map(t => (
                <span key={t} className="bg-northstar-50 text-northstar-700 text-xs px-2.5 py-1 rounded-full border border-northstar-100">{t}</span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 mb-4">No article topics tagged yet. Add articles in the Articles tab.</p>
          )}

          {journalist.notes && (
            <div className="pt-3 border-t border-slate-100">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Notes</div>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{journalist.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Recent articles */}
      {recentArticles.length > 0 && (
        <div className="card p-5">
          <h3 className="font-semibold text-slate-900 mb-3">Recent Articles ({articles.length} total)</h3>
          <div className="space-y-2">
            {recentArticles.map(a => (
              <div key={a.id} className="flex items-start gap-3 py-2 border-b border-slate-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <a href={a.url} target="_blank" rel="noreferrer"
                    className="text-sm font-medium text-slate-800 hover:text-northstar-600 flex items-center gap-1">
                    {a.title} {a.url && <ExternalLink className="w-3 h-3 shrink-0 opacity-40" />}
                  </a>
                  <div className="flex gap-3 text-xs text-slate-400 mt-0.5">
                    {a.publishDate && <span>{a.publishDate}</span>}
                    {a.topic && <span>· {a.topic}</span>}
                  </div>
                </div>
                {a.relevanceToNorthStar && (
                  <span className="text-xs bg-northstar-50 text-northstar-600 px-2 py-0.5 rounded shrink-0 max-w-[160px] truncate" title={a.relevanceToNorthStar}>
                    {a.relevanceToNorthStar}
                  </span>
                )}
              </div>
            ))}
          </div>
          {articles.length > 6 && (
            <button onClick={() => {}} className="mt-3 text-xs text-northstar-600 hover:underline">
              + {articles.length - 6} more in Articles tab
            </button>
          )}
        </div>
      )}
    </div>
  );
}
