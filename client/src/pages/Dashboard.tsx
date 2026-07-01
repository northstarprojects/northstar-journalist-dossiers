import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, TrendingUp, Clock, MessageSquare, Star,
  Megaphone, Send, Sparkles, AlertTriangle,
} from 'lucide-react';
import { dashboard } from '../api';
import type { DashboardData, CampaignType } from '../types';
import StatusBadge from '../components/StatusBadge';

const CAMPAIGN_TYPE_LABELS: Record<CampaignType | string, string> = {
  cold_intro: 'Cold Intro', event: 'Event', hackathon: 'Hackathon', founder_promo: 'Founder',
};
const CAMPAIGN_TYPE_COLORS: Record<string, string> = {
  cold_intro: 'bg-slate-100 text-slate-600',
  event:      'bg-blue-50 text-blue-600',
  hackathon:  'bg-violet-50 text-violet-600',
  founder_promo: 'bg-amber-50 text-amber-700',
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    dashboard.get().then(r => setData(r.data));
  }, []);

  if (!data) return <div className="p-8 text-slate-500">Loading...</div>;

  const hasAlerts = data.staleJournalists > 0 || data.unreachablePubs > 0;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">Media outreach overview for North Star AI Labs</p>
      </div>

      {/* ── Top stats row ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={Users}        label="Total Journalists"  value={data.total}        color="northstar" link="/journalists" />
        <StatCard icon={TrendingUp}   label="Avg Score"          value={data.avgScore}      suffix="/100" color="green" />
        <StatCard icon={Clock}        label="Follow-ups Due"     value={data.followUps.length} color="amber" />
        <StatCard icon={MessageSquare} label="Recent Outreach"   value={data.recentOutreach.length} color="blue" />
      </div>

      {/* ── Campaign pipeline ─────────────────────────────────────────────── */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-northstar-500" /> Campaign Pipeline
          </h2>
          <Link to="/campaigns" className="text-xs text-northstar-600 hover:underline font-medium">
            View all →
          </Link>
        </div>

        {/* Pipeline stat pills */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <PipelineStat
            icon={Megaphone}
            value={data.activeCampaigns}
            label="Active campaigns"
            color="indigo"
            link="/campaigns"
          />
          <PipelineStat
            icon={Sparkles}
            value={data.draftsReady}
            label="Drafts to review"
            color={data.draftsReady > 0 ? 'amber' : 'slate'}
            link="/campaigns"
          />
          <PipelineStat
            icon={Send}
            value={data.sentThisWeek}
            label="Sent this week"
            color="emerald"
          />
        </div>

        {/* Recent campaigns table */}
        {data.recentCampaigns.length === 0 ? (
          <div className="text-center py-5">
            <p className="text-sm text-slate-400">No campaigns yet.</p>
            <Link to="/campaigns" className="text-sm text-northstar-600 hover:underline mt-1 inline-block">
              Create your first campaign →
            </Link>
          </div>
        ) : (
          <div className="space-y-1">
            {data.recentCampaigns.map(c => (
              <Link
                key={c.id}
                to={`/campaigns/${c.id}`}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${CAMPAIGN_TYPE_COLORS[c.type]}`}>
                  {CAMPAIGN_TYPE_LABELS[c.type] || c.type}
                </span>
                <span className="text-sm font-medium text-slate-800 flex-1 truncate">{c.name}</span>
                <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
                  {c.readyCount > 0 && (
                    <span className="flex items-center gap-1 text-amber-600 font-medium">
                      <Sparkles className="w-3 h-3" /> {c.readyCount} to review
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" /> {c.journalistCount}
                  </span>
                  <span className="flex items-center gap-1 text-emerald-600">
                    <Send className="w-3 h-3" /> {c.sentCount} sent
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>


      {/* ── Follow-ups + Recent outreach ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" /> Upcoming Follow-ups
          </h2>
          {data.followUps.length === 0 ? (
            <p className="text-slate-400 text-sm">No follow-ups scheduled.</p>
          ) : (
            <div className="space-y-1">
              {data.followUps.map(j => (
                <Link key={j.id} to={`/journalists/${j.id}`} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
                  <div>
                    <div className="font-medium text-sm text-slate-900">{j.name}</div>
                    <div className="text-xs text-slate-500">{j.publication}</div>
                  </div>
                  <div className="text-xs text-amber-600 font-medium">{j.nextFollowUpDate}</div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-blue-500" /> Recent Outreach
          </h2>
          {data.recentOutreach.length === 0 ? (
            <p className="text-slate-400 text-sm">No outreach logged yet.</p>
          ) : (
            <div className="space-y-1">
              {data.recentOutreach.map(o => (
                <Link key={o.id} to={`/journalists/${o.journalistId}`} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50">
                  <div>
                    <div className="font-medium text-sm text-slate-900">{o.journalistName}</div>
                    <div className="text-xs text-slate-500">{o.subjectLine || o.messageType}</div>
                  </div>
                  <StatusBadge status={o.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── System health alerts ──────────────────────────────────────────── */}
      {hasAlerts && (
        <div className="card p-5 border-amber-200 bg-amber-50/50 mb-6">
          <h2 className="font-semibold text-amber-900 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> System Alerts
          </h2>
          <div className="space-y-2">
            {data.staleJournalists > 0 && (
              <Link to="/journalists?stale=1" className="flex items-center gap-2 text-sm text-amber-800 hover:underline">
                <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-800 text-xs font-bold flex items-center justify-center shrink-0">
                  {data.staleJournalists}
                </span>
                journalist{data.staleJournalists !== 1 ? 's' : ''} flagged as stale — no articles in 30+ days
              </Link>
            )}
            {data.unreachablePubs > 0 && (
              <Link to="/admin/publications" className="flex items-center gap-2 text-sm text-amber-800 hover:underline">
                <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-800 text-xs font-bold flex items-center justify-center shrink-0">
                  {data.unreachablePubs}
                </span>
                publication{data.unreachablePubs !== 1 ? 's' : ''} unreachable — check RSS feeds
              </Link>
            )}
          </div>
        </div>
      )}

      {/* ── Onboarding checklist (shown when system has no data yet) ─────── */}
      {data.total === 0 && <OnboardingChecklist />}
    </div>
  );
}

function OnboardingChecklist() {
  const steps = [
    {
      n: 1, done: false,
      label: 'Add target publications',
      detail: 'Go to Publications admin and add the outlets you want to track, or use "Discover blogs" to search Feedly & Substack.',
      link: '/admin/publications', cta: 'Go to Publications →',
    },
    {
      n: 2, done: false,
      label: 'Discover RSS feeds per publication',
      detail: 'On each publication row, click the Scan icon to find journalists from their RSS feeds.',
      link: '/admin/publications', cta: 'Open Publications →',
    },
    {
      n: 3, done: false,
      label: 'Review journalist suggestions',
      detail: 'Accept or reject each journalist Claude found. Accepted journalists get auto-scored.',
      link: '/admin/journalist-suggestions', cta: 'Review suggestions →',
    },
    {
      n: 4, done: false,
      label: 'Add contact info (emails)',
      detail: 'Use "Find profiles via SerpAPI" to discover LinkedIn and MuckRack profiles, then add contact info manually.',
      link: '/journalists', cta: 'Open Journalists →',
    },
    {
      n: 5, done: false,
      label: 'Set your House Style',
      detail: 'Write standing instructions Claude will follow when drafting every outreach email.',
      link: '/campaigns/styles', cta: 'Set House Style →',
    },
    {
      n: 6, done: false,
      label: 'Create your first campaign',
      detail: 'Pick a campaign type, select journalists, generate AI drafts, review and send.',
      link: '/campaigns', cta: 'New Campaign →',
    },
  ];

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-5">
        <Star className="w-6 h-6 text-yellow-400" fill="currentColor" />
        <div>
          <h2 className="font-bold text-slate-900">Welcome — let's get set up</h2>
          <p className="text-sm text-slate-500">Follow these steps to start building your journalist database.</p>
        </div>
      </div>
      <div className="space-y-3">
        {steps.map(s => (
          <div key={s.n} className="flex items-start gap-4 p-4 rounded-xl border border-slate-100 hover:border-northstar-200 hover:bg-northstar-50/30 transition-colors group">
            <div className="w-7 h-7 rounded-full border-2 border-slate-200 flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold text-slate-400">
              {s.n}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-900 text-sm">{s.label}</div>
              <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">{s.detail}</div>
            </div>
            <Link to={s.link}
              className="shrink-0 text-xs font-medium text-northstar-600 hover:text-northstar-800 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              {s.cta}
            </Link>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400 mt-4 text-center">
        This checklist disappears once you have journalists in the system.
      </p>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, suffix = '', color, link }: any) {
  const colors: Record<string, string> = {
    northstar: 'bg-northstar-50 text-northstar-600',
    green:     'bg-green-50 text-green-600',
    amber:     'bg-amber-50 text-amber-600',
    blue:      'bg-blue-50 text-blue-600',
  };
  const inner = (
    <div className="card p-5 hover:shadow-md transition-shadow">
      <div className={`w-9 h-9 rounded-lg ${colors[color]} flex items-center justify-center mb-3`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}{suffix}</div>
      <div className="text-sm text-slate-500 mt-0.5">{label}</div>
    </div>
  );
  return link ? <Link to={link}>{inner}</Link> : inner;
}

function PipelineStat({ icon: Icon, value, label, color, link }: any) {
  const colors: Record<string, string> = {
    indigo:  'bg-indigo-50 text-indigo-700 border-indigo-100',
    amber:   'bg-amber-50 text-amber-700 border-amber-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    slate:   'bg-slate-50 text-slate-500 border-slate-100',
  };
  const inner = (
    <div className={`rounded-lg border px-4 py-3 flex items-center gap-3 ${colors[color]}`}>
      <Icon className="w-4 h-4 shrink-0" />
      <div>
        <div className="text-xl font-bold leading-tight">{value}</div>
        <div className="text-xs opacity-80">{label}</div>
      </div>
    </div>
  );
  return link ? <Link to={link}>{inner}</Link> : inner;
}
