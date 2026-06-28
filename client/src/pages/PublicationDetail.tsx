import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Users, ExternalLink, TrendingUp, Mail } from 'lucide-react';
import { publications as pubApi } from '../api';
import type { Publication } from '../types';
import StatusBadge from '../components/StatusBadge';
import TierBadge from '../components/TierBadge';

interface PubJournalist {
  id: number;
  name: string;
  roleTitle: string;
  beat: string;
  email: string;
  totalScore: number;
  priorityTier: number;
  outreachStatus: string;
  lastContactedDate: string;
  isFavorite: number;
  logCount: number;
  latestContact: string;
}

const STATUS_ORDER: Record<string, number> = {
  'Covered': 0, 'In Conversation': 1, 'Responded': 2,
  'Pitched': 3, 'Ready to Pitch': 4, 'Researching': 5,
  'Not Started': 6, 'On Hold': 7, 'Not a Fit': 8,
};

export default function PublicationDetail() {
  const { id } = useParams<{ id: string }>();
  const [pub, setPub] = useState<Publication | null>(null);
  const [journalists, setJournalists] = useState<PubJournalist[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<'score' | 'status' | 'recent'>('score');

  useEffect(() => {
    if (!id) return;
    Promise.all([
      pubApi.get(Number(id)),
      pubApi.getJournalists(Number(id)),
    ]).then(([p, j]) => {
      setPub(p.data);
      setJournalists(j.data);
    }).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (!pub) return <div className="p-8 text-slate-400">Publication not found.</div>;

  // Sort
  const sorted = [...journalists].sort((a, b) => {
    if (sort === 'score')  return b.totalScore - a.totalScore;
    if (sort === 'status') return (STATUS_ORDER[a.outreachStatus] ?? 9) - (STATUS_ORDER[b.outreachStatus] ?? 9);
    if (sort === 'recent') {
      if (!a.latestContact && !b.latestContact) return 0;
      if (!a.latestContact) return 1;
      if (!b.latestContact) return -1;
      return b.latestContact.localeCompare(a.latestContact);
    }
    return 0;
  });

  // Stats
  const contacted  = journalists.filter(j => j.logCount > 0).length;
  const responded  = journalists.filter(j => ['Responded','In Conversation','Covered'].includes(j.outreachStatus)).length;
  const covered    = journalists.filter(j => j.outreachStatus === 'Covered').length;
  const withEmail  = journalists.filter(j => j.email).length;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link to="/admin/publications" className="text-sm text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-5">
        <ArrowLeft className="w-3.5 h-3.5" /> All publications
      </Link>

      {/* Header */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TierBadge tier={pub.tier === 'A' ? 1 : pub.tier === 'B' ? 2 : 3} />
              <span className="text-xs text-slate-400">{pub.tier === 'A' ? 'Tier A — Major' : pub.tier === 'B' ? 'Tier B — Business' : 'Tier C — Regional/Niche'}</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{pub.name}</h1>
            {pub.focus && <p className="text-slate-500 text-sm mt-1">{pub.focus}</p>}
            {pub.url && (
              <a href={pub.url} target="_blank" rel="noreferrer"
                className="text-sm text-northstar-600 hover:underline flex items-center gap-1 mt-2">
                <ExternalLink className="w-3.5 h-3.5" /> {pub.url}
              </a>
            )}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-northstar-600">{journalists.length}</div>
            <div className="text-xs text-slate-400">journalists tracked</div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3 mt-5 pt-5 border-t border-slate-100">
          {[
            { label: 'Contacted',  value: contacted,  color: 'text-blue-700' },
            { label: 'Responded',  value: responded,  color: 'text-emerald-700' },
            { label: 'Covered us', value: covered,    color: 'text-indigo-700' },
            { label: 'Have email', value: withEmail,  color: 'text-slate-700' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Journalist table */}
      {journalists.length === 0 ? (
        <div className="card p-10 text-center">
          <Users className="w-8 h-8 text-slate-200 mx-auto mb-3" />
          <div className="text-slate-500 font-medium">No journalists tracked for {pub.name} yet.</div>
          <Link to="/journalists/new" className="text-sm text-northstar-600 hover:underline mt-2 inline-block">
            Add one →
          </Link>
        </div>
      ) : (
        <>
          {/* Sort controls */}
          <div className="flex items-center gap-2 mb-3 text-sm">
            <span className="text-slate-400">Sort by</span>
            {(['score', 'status', 'recent'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`px-2.5 py-1 rounded-lg transition-colors ${
                  sort === s
                    ? 'bg-northstar-100 text-northstar-700 font-medium'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {s === 'score' ? 'Score' : s === 'status' ? 'Relationship' : 'Last contact'}
              </button>
            ))}
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Journalist</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Last contact</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Interactions</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map(j => (
                  <tr key={j.id} className="hover:bg-slate-50 group">
                    <td className="px-4 py-3">
                      <Link to={`/journalists/${j.id}`} className="group-hover:text-northstar-700">
                        <div className="font-medium text-slate-900 flex items-center gap-1.5">
                          {j.isFavorite ? <span className="text-amber-400 text-xs">★</span> : null}
                          {j.name}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {j.roleTitle || '—'}
                          {j.beat && <span className="ml-1">· {j.beat}</span>}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={j.outreachStatus} />
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {j.latestContact || <span className="text-slate-300">Never</span>}
                    </td>
                    <td className="px-4 py-3">
                      {j.logCount > 0 ? (
                        <span className="text-xs font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full">
                          {j.logCount} log{j.logCount !== 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {j.email && (
                          <a href={`mailto:${j.email}`} onClick={e => e.stopPropagation()}
                            className="text-slate-300 hover:text-northstar-500 transition-colors" title={j.email}>
                            <Mail className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <span className={`font-bold tabular-nums ${
                          j.totalScore >= 80 ? 'text-northstar-600' :
                          j.totalScore >= 60 ? 'text-emerald-600' :
                          j.totalScore >= 40 ? 'text-amber-600' : 'text-slate-400'
                        }`}>
                          {j.totalScore}
                        </span>
                        <TrendingUp className="w-3 h-3 text-slate-200" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
