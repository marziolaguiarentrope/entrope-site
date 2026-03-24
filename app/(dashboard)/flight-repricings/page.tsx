'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { api, Task, UserBasicInfo } from '@/lib/api';
import { TaskDetail } from '@/components/task-detail';

// ── Helpers ──────────────────────────────────────────────

function timeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount / 100);
}

// ── Types ────────────────────────────────────────────────

type Mode = 'queue' | 'history';
type SortKey = 'priority' | 'created' | 'airline' | 'passenger' | 'status' | 'credit';
type SortDir = 'asc' | 'desc';

interface Counts {
  pending: number;
  claimed: number;
  completed: number;
  failed: number;
  blocked: number;
}

const QUEUE_STATUSES = ['pending', 'claimed'] as const;
const HISTORY_STATUSES = ['completed', 'failed', 'blocked'] as const;

const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

// ── Sort Logic ───────────────────────────────────────────

function getRequestData(task: Task) {
  return task.request_data as {
    pnr?: string;
    airline_code?: string;
    airline_name?: string;
    passenger_name?: string;
    original_price?: { amount: number; currency: string };
    target_price?: { amount: number; currency: string };
    expected_credit?: { amount: number; currency: string };
    booking_id?: string;
  } | null;
}

function sortTasks(tasks: Task[], key: SortKey, dir: SortDir): Task[] {
  return [...tasks].sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;

    switch (key) {
      case 'priority':
        aVal = priorityOrder[a.priority] ?? 99;
        bVal = priorityOrder[b.priority] ?? 99;
        break;
      case 'created':
        aVal = new Date(a.created_at).getTime();
        bVal = new Date(b.created_at).getTime();
        break;
      case 'airline':
        aVal = (getRequestData(a)?.airline_code || '').toLowerCase();
        bVal = (getRequestData(b)?.airline_code || '').toLowerCase();
        break;
      case 'passenger':
        aVal = (getRequestData(a)?.passenger_name || '').toLowerCase();
        bVal = (getRequestData(b)?.passenger_name || '').toLowerCase();
        break;
      case 'status':
        aVal = a.status;
        bVal = b.status;
        break;
      case 'credit':
        aVal = getRequestData(a)?.expected_credit?.amount ?? 0;
        bVal = getRequestData(b)?.expected_credit?.amount ?? 0;
        break;
      default: return 0;
    }

    if (aVal < bVal) return dir === 'asc' ? -1 : 1;
    if (aVal > bVal) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ── Search Logic ─────────────────────────────────────────

function matchesSearch(task: Task, query: string, userInfoMap?: Map<string, UserBasicInfo>): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const d = getRequestData(task);
  const u = userInfoMap?.get(task.user_id);
  return !!(
    d?.pnr?.toLowerCase().includes(q) ||
    d?.airline_code?.toLowerCase().includes(q) ||
    d?.airline_name?.toLowerCase().includes(q) ||
    d?.passenger_name?.toLowerCase().includes(q) ||
    u?.email?.toLowerCase().includes(q) ||
    u?.phone?.toLowerCase().includes(q)
  );
}

// ── Status Badge ─────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    claimed: 'bg-blue-500/20 text-blue-400',
    completed: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
    blocked: 'bg-orange-500/20 text-orange-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium', colors[status] || 'bg-zinc-500/20 text-zinc-400')}>
      {status}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return null;
  if (outcome === 'success') {
    return <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded font-medium">✓ Success</span>;
  }
  return <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded font-medium">✗ {outcome}</span>;
}

// ── Sort Header ──────────────────────────────────────────

function SortHeader({ label, sortKey, currentKey, dir, onSort }: {
  label: string; sortKey: SortKey; currentKey: SortKey; dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = currentKey === sortKey;
  return (
    <th
      className="px-4 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none whitespace-nowrap"
      onClick={() => onSort(sortKey)}
    >
      {label}
      {isActive && <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );
}

// ── Queue Task Row ───────────────────────────────────────

function QueueRow({ task, onClick, userInfo }: { task: Task; onClick: () => void; userInfo?: UserBasicInfo }) {
  const data = getRequestData(task);
  const priorityColors: Record<string, string> = {
    urgent: 'text-red-400', high: 'text-orange-400', normal: 'text-foreground', low: 'text-muted-foreground',
  };

  return (
    <tr onClick={onClick} className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer">
      <td className="px-4 py-3">
        <span className={cn('text-xs font-medium uppercase', priorityColors[task.priority] || 'text-foreground')}>
          {task.priority}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm font-medium font-mono">{data?.airline_code || '—'}</span>
        <span className="text-muted-foreground mx-1">·</span>
        <span className="text-sm font-mono">{data?.pnr || '—'}</span>
      </td>
      <td className="px-4 py-3 text-sm">{data?.passenger_name || '—'}</td>
      <td className="px-4 py-3">
        {userInfo ? (
          <div className="space-y-0.5">
            {userInfo.email && <div className="text-xs text-muted-foreground truncate max-w-[200px]">{userInfo.email}</div>}
            {userInfo.phone && <div className="text-xs text-muted-foreground">{userInfo.phone}</div>}
            {!userInfo.email && !userInfo.phone && <span className="text-xs text-muted-foreground">—</span>}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <Link
          href={`/users-list/${task.user_id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-primary hover:underline whitespace-nowrap"
        >
          View Profile →
        </Link>
      </td>
      <td className="px-4 py-3 text-sm text-right font-mono">
        {data?.expected_credit
          ? formatMoney(data.expected_credit.amount, data.expected_credit.currency)
          : '—'}
      </td>
      <td className="px-4 py-3"><StatusBadge status={task.status} /></td>
      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(task.created_at)}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {task.claimed_by || '—'}
      </td>
    </tr>
  );
}

// ── History Task Row ─────────────────────────────────────

function HistoryRow({ task, onClick, userInfo }: { task: Task; onClick: () => void; userInfo?: UserBasicInfo }) {
  const data = getRequestData(task);
  const response = task.response_data as { credit_amount?: number; credit_currency?: string; failure_reason?: string } | null;

  return (
    <tr onClick={onClick} className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer">
      <td className="px-4 py-3">
        <span className="text-sm font-medium font-mono">{data?.airline_code || '—'}</span>
        <span className="text-muted-foreground mx-1">·</span>
        <span className="text-sm font-mono">{data?.pnr || '—'}</span>
      </td>
      <td className="px-4 py-3 text-sm">{data?.passenger_name || '—'}</td>
      <td className="px-4 py-3">
        {userInfo ? (
          <div className="space-y-0.5">
            {userInfo.email && <div className="text-xs text-muted-foreground truncate max-w-[200px]">{userInfo.email}</div>}
            {userInfo.phone && <div className="text-xs text-muted-foreground">{userInfo.phone}</div>}
            {!userInfo.email && !userInfo.phone && <span className="text-xs text-muted-foreground">—</span>}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <Link
          href={`/users-list/${task.user_id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-primary hover:underline whitespace-nowrap"
        >
          View Profile →
        </Link>
      </td>
      <td className="px-4 py-3"><OutcomeBadge outcome={task.outcome} /></td>
      <td className="px-4 py-3 text-sm">
        {task.outcome === 'success' && response?.credit_amount != null ? (
          <span className="font-mono text-green-400">
            {formatMoney(response.credit_amount * 100, response.credit_currency || 'USD')}
          </span>
        ) : task.outcome === 'denied' && response?.failure_reason ? (
          <span className="text-red-400 text-xs truncate max-w-[200px] inline-block">{response.failure_reason}</span>
        ) : task.blocked_reason ? (
          <span className="text-orange-400 text-xs truncate max-w-[200px] inline-block">{task.blocked_reason}</span>
        ) : '—'}
      </td>
      <td className="px-4 py-3"><StatusBadge status={task.status} /></td>
      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {task.completed_at ? timeAgo(task.completed_at) : timeAgo(task.created_at)}
      </td>
    </tr>
  );
}

// ── Main Page ────────────────────────────────────────────

export default function CompleteRepricingsPage() {
  // Core state
  const [mode, setMode] = useState<Mode>('queue');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('priority');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Data
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts>({ pending: 0, claimed: 0, completed: 0, failed: 0, blocked: 0 });

  // Detail panel
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // User info lookup
  const [userInfoMap, setUserInfoMap] = useState<Map<string, UserBasicInfo>>(new Map());

  // Auto-refresh
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);

  // Reset sort defaults when switching modes
  useEffect(() => {
    if (mode === 'queue') {
      setSortKey('priority');
      setSortDir('asc');
    } else {
      setSortKey('created');
      setSortDir('desc');
    }
    setStatusFilter(null);
    setSearch('');
  }, [mode]);

  // Fetch tasks
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const statuses = mode === 'queue' ? QUEUE_STATUSES : HISTORY_STATUSES;
      const targetStatuses = statusFilter ? [statusFilter] : [...statuses];

      // Fetch all needed statuses in parallel
      const results = await Promise.all(
        targetStatuses.map(status =>
          api.listTasks({ capability: 'flight_reprice', status, limit: 100 })
        )
      );

      // Merge tasks from all status results
      const allTasks = results.flatMap(r => r.tasks);
      setTasks(allTasks);

      // Fetch user info for all unique user_ids (non-blocking)
      const userIds = allTasks.map(t => t.user_id);
      api.batchGetUserBasicInfo(userIds).then(setUserInfoMap).catch(() => {});

      // Update counts from results
      const newCounts = { ...counts };
      targetStatuses.forEach((status, i) => {
        newCounts[status as keyof Counts] = results[i].total;
      });
      setCounts(newCounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch repricings');
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [mode, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh for queue mode (every 30s)
  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (mode === 'queue') {
      refreshTimer.current = setInterval(fetchData, 30_000);
    }
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [mode, fetchData]);

  // Fetch background counts for the other mode (so the summary bar shows totals)
  useEffect(() => {
    async function fetchOtherCounts() {
      try {
        const otherStatuses = mode === 'queue' ? HISTORY_STATUSES : QUEUE_STATUSES;
        const results = await Promise.all(
          otherStatuses.map(status =>
            api.listTasks({ capability: 'flight_reprice', status, limit: 1 })
          )
        );
        setCounts(prev => {
          const updated = { ...prev };
          otherStatuses.forEach((status, i) => {
            updated[status as keyof Counts] = results[i].total;
          });
          return updated;
        });
      } catch {
        // Silent fail — counts are nice-to-have
      }
    }
    fetchOtherCounts();
  }, [mode]);

  // Search + sort
  const filtered = useMemo(() => tasks.filter(t => matchesSearch(t, search, userInfoMap)), [tasks, search, userInfoMap]);
  const sorted = useMemo(() => sortTasks(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);

  // Sort handler
  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'priority' ? 'asc' : 'desc');
    }
  }

  // Select task — fetch full details
  async function handleSelectTask(task: Task) {
    try {
      const fullTask = await api.getTask(task.id);
      setSelectedTask(fullTask);
    } catch {
      setSelectedTask(task);
    }
  }

  // Handle task update from detail panel
  function handleTaskUpdate(updated: Task) {
    // If task moved to a terminal status while in queue, remove from list
    if (mode === 'queue' && (updated.status === 'completed' || updated.status === 'failed' || updated.status === 'blocked')) {
      setTasks(prev => prev.filter(t => t.id !== updated.id));
      setSelectedTask(null);
    } else {
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
      setSelectedTask(updated);
    }
  }

  const queueCount = counts.pending + counts.claimed;
  const historyCount = counts.completed + counts.failed + counts.blocked;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Flight Repricings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Flight repricing tasks — work queue and history
        </p>
      </div>

      {/* Summary Stats */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
        <span>
          <span className="font-medium text-yellow-400">{counts.pending}</span> pending
          <span className="mx-1">·</span>
          <span className="font-medium text-blue-400">{counts.claimed}</span> claimed
        </span>
        <span className="text-border">|</span>
        <span>
          <span className="font-medium text-green-400">{counts.completed}</span> completed
          <span className="mx-1">·</span>
          <span className="font-medium text-red-400">{counts.failed}</span> failed
          <span className="mx-1">·</span>
          <span className="font-medium text-orange-400">{counts.blocked}</span> blocked
        </span>
      </div>

      {/* Mode Tabs + Sub-filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        {/* Mode toggle */}
        <div className="flex gap-1 bg-accent/30 rounded-lg p-1">
          <button
            onClick={() => setMode('queue')}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              mode === 'queue' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Queue {queueCount > 0 && <span className="ml-1 text-xs opacity-70">({queueCount})</span>}
          </button>
          <button
            onClick={() => setMode('history')}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              mode === 'history' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            History {historyCount > 0 && <span className="ml-1 text-xs opacity-70">({historyCount})</span>}
          </button>
        </div>

        {/* Status sub-filters */}
        <div className="flex gap-1">
          <button
            onClick={() => setStatusFilter(null)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
              statusFilter === null ? 'bg-primary text-primary-foreground' : 'bg-accent/50 text-muted-foreground hover:bg-accent'
            )}
          >
            All
          </button>
          {(mode === 'queue' ? QUEUE_STATUSES : HISTORY_STATUSES).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors capitalize',
                statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-accent/50 text-muted-foreground hover:bg-accent'
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex-1 max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search PNR, airline, passenger, email, phone..."
            className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Refresh button */}
        <button
          onClick={fetchData}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-muted-foreground rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
          title="Refresh"
        >
          {loading ? 'Loading...' : '↻ Refresh'}
        </button>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {error ? (
          <div className="p-6 text-center">
            <p className="text-red-400 mb-2">{error}</p>
            <button onClick={fetchData} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              Retry
            </button>
          </div>
        ) : loading && tasks.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">Loading repricings...</div>
        ) : sorted.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            {search ? 'No repricings match your search' :
             mode === 'queue' ? 'No active repricings in queue' :
             'No repricing history found'}
          </div>
        ) : mode === 'queue' ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-accent/30">
                <tr>
                  <SortHeader label="Priority" sortKey="priority" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Airline · PNR" sortKey="airline" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Passenger" sortKey="passenger" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Customer Contact</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Profile</th>
                  <SortHeader label="Expected Credit" sortKey="credit" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Status" sortKey="status" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Created" sortKey="created" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Claimed By</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(task => (
                  <QueueRow key={task.id} task={task} onClick={() => handleSelectTask(task)} userInfo={userInfoMap.get(task.user_id)} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-accent/30">
                <tr>
                  <SortHeader label="Airline · PNR" sortKey="airline" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Passenger" sortKey="passenger" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Customer Contact</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Profile</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Outcome</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Details</th>
                  <SortHeader label="Status" sortKey="status" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Resolved" sortKey="created" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {sorted.map(task => (
                  <HistoryRow key={task.id} task={task} onClick={() => handleSelectTask(task)} userInfo={userInfoMap.get(task.user_id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Count info */}
      {!loading && sorted.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <span>
            Showing {sorted.length}{search ? ` of ${tasks.length}` : ''} {mode === 'queue' ? 'queued' : 'historical'} tasks
          </span>
          {tasks.length >= 100 && (
            <span className="text-yellow-400">
              Results may be truncated — showing first 100 per status. Backend pagination coming soon.
            </span>
          )}
        </div>
      )}

      {/* Task Detail Panel */}
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={handleTaskUpdate}
        />
      )}
    </div>
  );
}
