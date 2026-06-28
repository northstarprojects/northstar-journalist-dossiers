import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Filter, X } from 'lucide-react';
import { outreach as oApi } from '../api';
import StatusBadge from '../components/StatusBadge';

interface ActivityLog {
  id: number;
  journalistId: number;
  journalistName: string;
  publication: string;
  journalistStatus: string;
  date: string;
  channel: string;
  messageType: string;
  subjectLine: string;
  status: string;
  response: string;
  createdAt: string;
}

const STATUSES = [
  'Draft', 'Sent', 'No Response', 'Responded',
  'Meeting Scheduled', 'Covered', 'Declined', 'Not a Fit',
];

function groupByDate(logs: ActivityLog[]): { label: string; logs: ActivityLog[] }[] {
  const groups: Record<string, ActivityLog[]> = {};
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().split('T')[0];

  for (const log of logs) {
    const d = log.date || log.createdAt?.split('T')[0] || 'Unknown';
    let label: string;
    if (d === today) label = 'Today';
    else if (d === yesterday) label = 'Yesterday';
    else if (d >= weekAgo) label = 'This week';
    else {
      // Month + year bucket
      const [year, month] = d.split('-');
      label = new Date(Number(year), Number(month) - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
    }
    if (!groups[label]) groups[label] = [];
    groups[label].push(log);
  }

  // Preserve insertion order (logs are already sorted desc)
  return Object.entries(groups).map(([label, logs]) => ({ label, logs }));
}

export default function ActivityFeed() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [publications, setPublications] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [pubFilter, setPubFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params: any = {};
    if (pubFilter)    params.publication = pubFilter;
    if (statusFilter) params.status      = statusFilter;
    if (fromFilter)   params.from        = fromFilter;
    if (toFilter)     params.to          = toFilter;

    oApi.activity(params).then(r => {
      setLogs(r.data.logs);
      setPublications(r.data.publications);
    }).finally(() => setLoading(false));
  }, [pubFilter, statusFilter, fromFilter, toFilter]);

  useEffect(() => { load(); }, [load]);

  const hasFilters = pubFilter || statusFilter || fromFilter || toFilter;
  const clearFilters = () => { setPubFilter(''); setStatusFilter(''); setFromFilter(''); setToFilter(''); };

  const grouped = groupByDate(logs);

  // Summary stats
  const sentCount     = logs.filter(l => ['Sent', 'No Response'].includes(l.status)).length;
  const respondedCount = logs.filter(l => l.status === 'Responded').length;
  const coveredCount  = logs.filter(l => l.status === 'Covered').length;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Activity className="w-5 h-5 text-northstar-600" /> Activity Feed
        </h1>
        <p className="text-slate-500 mt-1 text-sm">All outreach across every journalist, newest first.</p>
      </div>

      {/* Summary pills */}
      {logs.length > 0 && (
        <div className="flex items-center gap-4 mb-5 text-sm">
          <span className="text-slate-500"><strong className="text-slate-800">{logs.length}</strong> interactions</span>
          {sentCount > 0 && <span className="text-slate-500"><strong className="text-blue-700">{sentCount}</strong> pitches sent</span>}
          {respondedCount > 0 && <span className="text-slate-500"><strong className="text-emerald-700">{respondedCount}</strong> responses</span>}
          {coveredCount > 0 && <span className="text-slate-500"><strong className="text-indigo-700">{coveredCount}</strong> covered</span>}
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 mb-5 flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-slate-400 shrink-0" />

        <select
          className="form-select text-sm flex-1 min-w-36"
          value={pubFilter}
          onChange={e => setPubFilter(e.target.value)}
        >
          <option value="">All publications</option>
          {publications.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <select
          className="form-select text-sm flex-1 min-w-36"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div className="flex items-center gap-2">
          <input
            type="date"
            className="form-input text-sm"
            value={fromFilter}
            onChange={e => setFromFilter(e.target.value)}
            title="From date"
          />
          <span className="text-slate-400 text-sm">→</span>
          <input
            type="date"
            className="form-input text-sm"
            value={toFilter}
            onChange={e => setToFilter(e.target.value)}
            title="To date"
          />
        </div>

        {hasFilters && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Feed */}
      {loading ? (
        <div className="card p-8 text-center text-slate-400">Loading…</div>
      ) : logs.length === 0 ? (
        <div className="card p-10 text-center">
          <Activity className="w-8 h-8 text-slate-200 mx-auto mb-3" />
          <div className="text-slate-500 font-medium">
            {hasFilters ? 'No activity matches your filters.' : 'No outreach logged yet.'}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ label, logs: group }) => (
            <div key={label}>
              {/* Date group header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
                <div className="flex-1 h-px bg-slate-100" />
                <div className="text-xs text-slate-400">{group.length}</div>
              </div>

              <div className="space-y-2">
                {group.map(log => (
                  <Link
                    key={log.id}
                    to={`/journalists/${log.journalistId}`}
                    className="card p-4 flex items-start gap-4 hover:border-northstar-300 hover:shadow-sm transition-all group"
                  >
                    {/* Date column */}
                    <div className="w-20 shrink-0 text-xs text-slate-400 pt-0.5 tabular-nums">
                      {log.date || '—'}
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 group-hover:text-northstar-700 text-sm">
                          {log.journalistName}
                        </span>
                        <span className="text-xs text-slate-400">{log.publication}</span>
                        {log.channel && (
                          <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                            {log.channel}
                          </span>
                        )}
                      </div>
                      {log.subjectLine && (
                        <div className="text-sm text-slate-500 mt-0.5 truncate">{log.subjectLine}</div>
                      )}
                      {log.response && (
                        <div className="text-xs text-emerald-700 mt-1 bg-emerald-50 rounded px-2 py-1 truncate">
                          ↩ {log.response}
                        </div>
                      )}
                    </div>

                    {/* Status */}
                    <div className="shrink-0">
                      <StatusBadge status={log.status} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
