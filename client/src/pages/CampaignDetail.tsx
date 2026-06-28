import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Users, Sparkles, Download, Check, X,
  ChevronDown, ChevronUp, Copy, Send, RefreshCw, Search, Mail,
} from 'lucide-react';
import { campaigns as cApi, journalists as jApi } from '../api';
import type { Campaign, CampaignJournalist, Journalist, CampaignType } from '../types';

const TYPE_LABELS: Record<CampaignType, string> = {
  cold_intro: 'Cold Introduction', event: 'Event Coverage',
  hackathon: 'Hackathon', founder_promo: 'Founder Spotlight',
};

const DRAFT_STATUS_STYLE: Record<string, string> = {
  pending:  'bg-slate-100 text-slate-500',
  ready:    'bg-blue-50 text-blue-700',
  approved: 'bg-emerald-50 text-emerald-700',
  sent:     'bg-indigo-50 text-indigo-700',
  skipped:  'bg-slate-100 text-slate-400',
  failed:   'bg-rose-50 text-rose-700',
};

const RELATIONSHIP_LABEL: Record<string, string> = {
  'Not Started': '🆕 Never contacted',
  'Researching':  '🆕 Never contacted',
  'Ready to Pitch': '🆕 Never contacted',
  'Pitched':      '📤 Pitched — no reply yet',
  'Responded':    '💬 Has responded before',
  'In Conversation': '🤝 In conversation',
  'Covered':      '✅ Has covered us',
  'Not a Fit':    '❌ Declined',
  'On Hold':      '⏸ On hold',
};

type Tab = 'journalists' | 'drafts' | 'pack';

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [campaignJournalists, setCampaignJournalists] = useState<CampaignJournalist[]>([]);
  const [allJournalists, setAllJournalists] = useState<Journalist[]>([]);
  const [tab, setTab] = useState<Tab>('journalists');
  const [search, setSearch] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState('');
  const [expandedDraft, setExpandedDraft] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState<Record<number, { subject: string; body: string }>>({});
  const [copying, setCopying] = useState<number | null>(null);
  const [sending, setSending] = useState<number | null>(null);
  const [polling, setPolling] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const loadCampaign = useCallback(async () => {
    const [c, cj] = await Promise.all([
      cApi.get(Number(id)),
      cApi.getJournalists(Number(id)),
    ]);
    setCampaign(c.data);
    setCampaignJournalists(cj.data);
  }, [id]);

  useEffect(() => {
    loadCampaign();
    jApi.list({ sortBy: 'totalScore' }).then(r => setAllJournalists(r.data));
  }, [loadCampaign]);

  // Poll while drafts are generating
  useEffect(() => {
    const hasPending = campaignJournalists.some(cj => cj.draftStatus === 'pending');
    const hasGenerating = generating;
    if (!hasPending && !hasGenerating) return;
    if (polling) return;
    setPolling(true);
    const interval = setInterval(() => {
      cApi.getJournalists(Number(id)).then(r => {
        setCampaignJournalists(r.data);
        const stillPending = r.data.some((cj: CampaignJournalist) => cj.draftStatus === 'pending');
        if (!stillPending) { clearInterval(interval); setPolling(false); }
      });
    }, 4000);
    return () => clearInterval(interval);
  }, [generating, campaignJournalists, id, polling]);

  if (!campaign) return <div className="p-8 text-slate-400">Loading…</div>;

  const addedIds = new Set(campaignJournalists.map(cj => cj.journalistId));

  const filteredAll = allJournalists.filter(j => {
    if (addedIds.has(j.id)) return false;
    if (j.outreachStatus === 'Not a Fit') return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return j.name.toLowerCase().includes(s) ||
           j.publication.toLowerCase().includes(s) ||
           (j.beat || '').toLowerCase().includes(s);
  });

  const pendingCount = campaignJournalists.filter(cj => cj.draftStatus === 'pending').length;
  const readyCount   = campaignJournalists.filter(cj => cj.draftStatus === 'ready' || cj.draftStatus === 'approved').length;
  const sentCount    = campaignJournalists.filter(cj => cj.draftStatus === 'sent').length;
  const draftsToReview = campaignJournalists.filter(cj => cj.draftStatus === 'ready' || cj.draftStatus === 'approved' || cj.draftStatus === 'failed');

  const handleAdd = async (journalistId: number) => {
    await cApi.addJournalists(Number(id), [journalistId]);
    loadCampaign();
  };

  const handleRemove = async (journalistId: number) => {
    await cApi.removeJournalist(Number(id), journalistId);
    loadCampaign();
  };

  const handleGenerateDrafts = async () => {
    setGenerating(true);
    setGenerateMsg('');
    try {
      const res = await cApi.generateDrafts(Number(id));
      setGenerateMsg(res.data.message);
      if (res.data.count > 0) setTab('drafts');
    } catch (err: any) {
      setGenerateMsg(err.response?.data?.error || 'Generation failed. Check server logs.');
    } finally {
      setGenerating(false);
    }
  };

  const getDraftEdit = (cj: CampaignJournalist) =>
    editingDraft[cj.journalistId] ?? { subject: cj.draftSubject, body: cj.draftBody };

  const setDraftEdit = (journalistId: number, field: 'subject' | 'body', value: string) => {
    setEditingDraft(prev => ({
      ...prev,
      [journalistId]: { ...(prev[journalistId] ?? { subject: '', body: '' }), [field]: value },
    }));
  };

  const handleSaveDraft = async (cj: CampaignJournalist, status?: string) => {
    const edit = getDraftEdit(cj);
    await cApi.updateDraft(Number(id), cj.journalistId, {
      draftSubject: edit.subject,
      draftBody: edit.body,
      draftStatus: status ?? (cj.draftStatus === 'ready' ? 'approved' : cj.draftStatus),
    });
    loadCampaign();
  };

  const handleSkip = async (cj: CampaignJournalist) => {
    await cApi.updateDraft(Number(id), cj.journalistId, { draftStatus: 'skipped' });
    loadCampaign();
  };

  const handleMarkSent = async (cj: CampaignJournalist) => {
    setSending(cj.journalistId);
    await handleSaveDraft(cj, 'approved'); // save any edits first
    await cApi.markSent(Number(id), cj.journalistId, campaign.type);
    setSending(null);
    loadCampaign();
  };

  const handleCopy = async (text: string, id: number) => {
    await navigator.clipboard.writeText(text);
    setCopying(id);
    setTimeout(() => setCopying(null), 1500);
  };

  const handleExportCSV = () => {
    const approved = campaignJournalists.filter(
      cj => cj.draftStatus === 'approved' || cj.draftStatus === 'ready'
    );
    const rows = [
      ['Name', 'Email', 'Publication', 'Subject', 'Body'],
      ...approved.map(cj => [
        cj.name, cj.email || '', cj.publication,
        `"${(cj.draftSubject || '').replace(/"/g, '""')}"`,
        `"${(cj.draftBody || '').replace(/"/g, '""').replace(/\n/g, '\\n')}"`,
      ]),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${campaign.name.replace(/\s+/g, '-')}-emails.csv`;
    a.click();
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link to="/campaigns" className="text-sm text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-3">
          <ArrowLeft className="w-3.5 h-3.5" /> All campaigns
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-northstar-100 text-northstar-700">
                {TYPE_LABELS[campaign.type]}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{campaign.name}</h1>
            {campaign.brief && (
              <p className="text-slate-500 mt-1 text-sm max-w-2xl">{campaign.brief}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {readyCount > 0 && (
              <button onClick={handleExportCSV} className="flex items-center gap-1.5 btn-secondary text-sm">
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            )}
            {pendingCount > 0 && (
              <button
                onClick={handleGenerateDrafts}
                disabled={generating}
                className="flex items-center gap-1.5 btn-primary text-sm"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {generating ? 'Generating…' : `Generate ${pendingCount} draft${pendingCount !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-6 mt-4 text-sm">
          <span className="text-slate-500"><strong className="text-slate-800">{campaignJournalists.length}</strong> journalists</span>
          <span className="text-slate-500"><strong className="text-blue-700">{readyCount}</strong> ready to review</span>
          <span className="text-slate-500"><strong className="text-emerald-700">{sentCount}</strong> sent</span>
          {polling && <span className="text-indigo-500 flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> Generating drafts…</span>}
        </div>

        {generateMsg && (
          <div className="mt-3 px-4 py-2.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 text-sm">
            ✨ {generateMsg}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {(['journalists', 'drafts', 'pack'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-northstar-500 text-northstar-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'journalists' ? (
              <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Journalists ({campaignJournalists.length})</span>
            ) : t === 'drafts' ? (
              <span className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Review Drafts ({draftsToReview.length})</span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /> Email Pack
                {readyCount > 0 && (
                  <span className="ml-1 bg-emerald-100 text-emerald-700 text-xs font-bold px-1.5 py-0.5 rounded-full">{readyCount}</span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── TAB: Journalist picker ────────────────────────────────────────── */}
      {tab === 'journalists' && (
        <div className="space-y-5">
          {/* Already added */}
          {campaignJournalists.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                In this campaign
              </div>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {campaignJournalists.map(cj => (
                      <tr key={cj.journalistId} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{cj.name}</div>
                          <div className="text-xs text-slate-400">{cj.publication} · {cj.beat}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {RELATIONSHIP_LABEL[cj.outreachStatus] || cj.outreachStatus}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${DRAFT_STATUS_STYLE[cj.draftStatus]}`}>
                            {cj.draftStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {cj.draftStatus !== 'sent' && (
                            <button
                              onClick={() => handleRemove(cj.journalistId)}
                              className="text-slate-300 hover:text-rose-500 transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Add from list */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Add journalists
            </div>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                className="form-input pl-9"
                placeholder="Search by name, publication or beat…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {filteredAll.length === 0 ? (
              <div className="card p-6 text-center text-slate-400 text-sm">
                {search ? 'No matching journalists.' : 'All journalists are already in this campaign.'}
              </div>
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {filteredAll.slice(0, 50).map(j => (
                      <tr key={j.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900 flex items-center gap-1.5">
                            {j.name}
                            {j.isFavorite ? <span className="text-amber-400 text-xs">★</span> : null}
                          </div>
                          <div className="text-xs text-slate-400">{j.publication} · {j.beat}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {RELATIONSHIP_LABEL[j.outreachStatus] || j.outreachStatus}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono text-slate-500">{j.totalScore}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleAdd(j.id)}
                            className="text-xs px-2.5 py-1 rounded bg-northstar-50 text-northstar-700 border border-northstar-200 hover:bg-northstar-100 font-medium transition-colors"
                          >
                            + Add
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB: Draft review ─────────────────────────────────────────────── */}
      {tab === 'drafts' && (
        <div>
          {draftsToReview.length === 0 ? (
            <div className="card p-10 text-center">
              <Sparkles className="w-8 h-8 text-slate-200 mx-auto mb-3" />
              <div className="text-slate-500 font-medium">No drafts yet</div>
              <div className="text-slate-400 text-sm mt-1">
                Add journalists, then click <strong>"Generate drafts"</strong> to have Claude write personalised emails.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {draftsToReview.map(cj => {
                const edit = getDraftEdit(cj);
                const isExpanded = expandedDraft === cj.journalistId;
                const isSent = cj.draftStatus === 'sent';

                return (
                  <div
                    key={cj.journalistId}
                    className={`card border ${
                      cj.draftStatus === 'approved' ? 'border-emerald-200 bg-emerald-50/30' :
                      cj.draftStatus === 'sent'     ? 'border-indigo-200 bg-indigo-50/20 opacity-70' :
                      cj.draftStatus === 'failed'   ? 'border-rose-200 bg-rose-50/30' :
                      'border-slate-200'
                    }`}
                  >
                    {/* Collapsed header */}
                    <div
                      className="flex items-center gap-3 p-4 cursor-pointer"
                      onClick={() => setExpandedDraft(isExpanded ? null : cj.journalistId)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900">{cj.name}</span>
                          <span className="text-xs text-slate-400">{cj.publication}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${DRAFT_STATUS_STYLE[cj.draftStatus]}`}>
                            {cj.draftStatus}
                          </span>
                        </div>
                        {!isExpanded && cj.draftSubject && (
                          <div className="text-sm text-slate-500 mt-0.5 truncate">{cj.draftSubject}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!isSent && cj.draftStatus !== 'failed' && (
                          <>
                            <button
                              onClick={e => { e.stopPropagation(); handleSkip(cj); }}
                              className="text-xs px-2 py-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                              title="Skip this journalist"
                            >
                              Skip
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); handleMarkSent(cj); }}
                              disabled={sending === cj.journalistId}
                              className="text-xs px-2.5 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 font-medium flex items-center gap-1 transition-colors disabled:opacity-50"
                            >
                              <Send className="w-3 h-3" />
                              {sending === cj.journalistId ? 'Logging…' : 'Mark sent'}
                            </button>
                          </>
                        )}
                        {isExpanded
                          ? <ChevronUp className="w-4 h-4 text-slate-400" />
                          : <ChevronDown className="w-4 h-4 text-slate-400" />
                        }
                      </div>
                    </div>

                    {/* Expanded draft editor */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 p-4 space-y-3">
                        {cj.draftStatus === 'failed' ? (
                          <div className="text-sm text-rose-600 bg-rose-50 rounded p-3">
                            Draft generation failed for this journalist. Check the server logs, or write the email manually below.
                          </div>
                        ) : null}

                        {/* Relationship context */}
                        <div className="text-xs text-slate-500 bg-slate-50 rounded px-3 py-2 border border-slate-100">
                          {RELATIONSHIP_LABEL[cj.outreachStatus] || cj.outreachStatus}
                          {cj.email && <span className="ml-3 text-slate-400">📧 {cj.email}</span>}
                        </div>

                        {/* Subject */}
                        <div>
                          <label className="form-label flex items-center justify-between">
                            Subject line
                            <button
                              onClick={() => handleCopy(edit.subject, cj.journalistId * 10)}
                              className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                            >
                              {copying === cj.journalistId * 10 ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                              copy
                            </button>
                          </label>
                          <input
                            className="form-input"
                            value={edit.subject}
                            onChange={e => setDraftEdit(cj.journalistId, 'subject', e.target.value)}
                            disabled={isSent}
                          />
                        </div>

                        {/* Body */}
                        <div>
                          <label className="form-label flex items-center justify-between">
                            Email body
                            <button
                              onClick={() => handleCopy(edit.body, cj.journalistId * 10 + 1)}
                              className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                            >
                              {copying === cj.journalistId * 10 + 1 ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                              copy
                            </button>
                          </label>
                          <textarea
                            className="form-textarea font-mono text-sm"
                            rows={10}
                            value={edit.body}
                            onChange={e => setDraftEdit(cj.journalistId, 'body', e.target.value)}
                            disabled={isSent}
                          />
                        </div>

                        {!isSent && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleSaveDraft(cj, 'approved')}
                              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium transition-colors"
                            >
                              <Check className="w-3.5 h-3.5" /> Approve draft
                            </button>
                            <button
                              onClick={() => handleMarkSent(cj)}
                              disabled={sending === cj.journalistId}
                              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-medium transition-colors disabled:opacity-50"
                            >
                              <Send className="w-3.5 h-3.5" />
                              {sending === cj.journalistId ? 'Logging…' : 'Save edits & mark sent'}
                            </button>
                            <button
                              onClick={() => handleSkip(cj)}
                              className="text-sm text-slate-400 hover:text-rose-500 transition-colors"
                            >
                              Skip
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Email Pack ───────────────────────────────────────────────── */}
      {tab === 'pack' && (() => {
        const approved = campaignJournalists.filter(
          cj => cj.draftStatus === 'approved' || cj.draftStatus === 'ready'
        );

        const buildPackText = () =>
          approved.map((cj, i) =>
            [
              `── Email ${i + 1} of ${approved.length} ──────────────────────`,
              `To:      ${cj.name}${cj.email ? ` <${cj.email}>` : ' (no email on file)'}`,
              `Pub:     ${cj.publication}`,
              `Subject: ${cj.draftSubject || '(no subject)'}`,
              ``,
              cj.draftBody || '(no body)',
              ``,
            ].join('\n')
          ).join('\n');

        const handleCopyAll = async () => {
          await navigator.clipboard.writeText(buildPackText());
          setCopiedAll(true);
          setTimeout(() => setCopiedAll(false), 2000);
        };

        return (
          <div>
            {approved.length === 0 ? (
              <div className="card p-10 text-center">
                <Mail className="w-8 h-8 text-slate-200 mx-auto mb-3" />
                <div className="text-slate-500 font-medium">No approved drafts yet</div>
                <div className="text-slate-400 text-sm mt-1">
                  Approve drafts in the <strong>Review Drafts</strong> tab to see them here.
                </div>
              </div>
            ) : (
              <>
                {/* Pack header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm text-slate-500">
                    <strong className="text-slate-800">{approved.length}</strong> approved draft{approved.length !== 1 ? 's' : ''} ready to send
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExportCSV}
                      className="flex items-center gap-1.5 btn-secondary text-sm"
                    >
                      <Download className="w-3.5 h-3.5" /> CSV
                    </button>
                    <button
                      onClick={handleCopyAll}
                      className="flex items-center gap-1.5 btn-primary text-sm"
                    >
                      {copiedAll
                        ? <><Check className="w-3.5 h-3.5" /> Copied!</>
                        : <><Copy className="w-3.5 h-3.5" /> Copy all {approved.length} emails</>
                      }
                    </button>
                  </div>
                </div>

                {/* Usage tip */}
                <div className="mb-4 px-4 py-3 rounded-lg bg-blue-50 border border-blue-100 text-blue-800 text-sm">
                  <strong>How to use:</strong> Copy all → paste into a doc or notes app. Each block has the recipient, subject, and body ready to copy individually into Gmail. Or use the CSV export with Gmail's multi-send / mail merge tool.
                </div>

                {/* Individual draft cards */}
                <div className="space-y-4">
                  {approved.map((cj, i) => {
                    const copyId = cj.journalistId * 100;
                    return (
                      <div key={cj.journalistId} className="card border border-slate-200 overflow-hidden">
                        {/* Card header */}
                        <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-bold text-slate-400 w-5">{i + 1}</span>
                            <div>
                              <span className="font-semibold text-slate-900 text-sm">{cj.name}</span>
                              <span className="text-slate-400 text-xs ml-2">{cj.publication}</span>
                            </div>
                            {cj.email
                              ? <span className="text-xs text-slate-500 bg-white border border-slate-200 rounded px-2 py-0.5">{cj.email}</span>
                              : <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">⚠ no email on file</span>
                            }
                          </div>
                          <button
                            onClick={() => handleCopy(
                              `To: ${cj.name}${cj.email ? ` <${cj.email}>` : ''}\nSubject: ${cj.draftSubject}\n\n${cj.draftBody}`,
                              copyId
                            )}
                            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 transition-colors"
                          >
                            {copying === copyId
                              ? <><Check className="w-3 h-3 text-emerald-500" /> Copied</>
                              : <><Copy className="w-3 h-3" /> Copy</>
                            }
                          </button>
                        </div>

                        {/* Subject */}
                        <div className="px-4 pt-3 pb-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-14 shrink-0">Subject</span>
                            <span className="text-sm font-medium text-slate-900">{cj.draftSubject || <span className="text-slate-400 italic">no subject</span>}</span>
                          </div>
                        </div>

                        {/* Body */}
                        <div className="px-4 pb-4 pt-2">
                          <div className="flex gap-2">
                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-14 shrink-0 pt-0.5">Body</span>
                            <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans flex-1 bg-slate-50 rounded p-3 border border-slate-100 leading-relaxed">
                              {cj.draftBody || <span className="text-slate-400 italic">no body</span>}
                            </pre>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}
