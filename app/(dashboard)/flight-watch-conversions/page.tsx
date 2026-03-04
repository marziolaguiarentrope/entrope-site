'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  api,
  FlightConversionDetail,
  FlightConversionListItem,
  FlightConversionTaskStatus,
  Task,
} from '@/lib/api';
import { FlightWatchConversionDetail } from '@/components/flight-watch-conversion-detail';
import { cn } from '@/lib/utils';

type TabFilter = FlightConversionTaskStatus | 'failed' | 'all';
type SortKey = 'converted' | 'route' | 'savings' | 'status' | 'created';
type SortDir = 'asc' | 'desc';

type StatusTotals = Record<FlightConversionTaskStatus | 'failed', number>;

const STATUS_PAGE_LIMIT = 100;
/** Statuses the backend accepts as a filter param */
const API_FILTERABLE_STATUSES: FlightConversionTaskStatus[] = ['pending', 'claimed', 'completed', 'blocked'];
const EMPTY_STATUS_TOTALS: StatusTotals = {
  pending: 0,
  claimed: 0,
  completed: 0,
  blocked: 0,
  failed: 0,
};

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

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMoneyCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function routeLabel(item: FlightConversionListItem): string {
  const origin = item.summary.origin || (typeof item.task.request_data?.origin === 'string' ? item.task.request_data.origin : null);
  const destination = item.summary.destination || (typeof item.task.request_data?.destination === 'string' ? item.task.request_data.destination : null);
  if (origin && destination) return `${origin} → ${destination}`;
  if (origin) return origin;
  if (destination) return destination;
  return 'Route unavailable';
}

function tripLabel(item: FlightConversionListItem): string {
  const departure = item.summary.departure_date || (typeof item.task.request_data?.departure_date === 'string' ? item.task.request_data.departure_date : null);
  const ret = item.summary.return_date || (typeof item.task.request_data?.return_date === 'string' ? item.task.request_data.return_date : null);
  const cabin = item.summary.cabin || (typeof item.task.request_data?.cabin === 'string' ? item.task.request_data.cabin : null);
  const pax = typeof item.summary.passengers === 'number'
    ? item.summary.passengers
    : typeof item.task.request_data?.passengers === 'number'
      ? item.task.request_data.passengers
      : null;

  const dates = departure ? `${formatDate(departure)}${ret ? ` → ${formatDate(ret)}` : ''}` : 'Dates unavailable';
  const paxLabel = pax ? `${pax} pax` : null;
  const cabinLabel = cabin ? cabin.replace(/_/g, ' ') : null;
  return [dates, paxLabel, cabinLabel].filter(Boolean).join(' · ');
}

function convertedAt(item: FlightConversionListItem): string | null {
  const summaryVal = item.summary.converted_at;
  if (summaryVal) return summaryVal;
  const taskVal = item.task.request_data?.converted_at;
  return typeof taskVal === 'string' ? taskVal : null;
}

function savingsCents(item: FlightConversionListItem): number | null {
  if (typeof item.summary.best_axel_savings_cents === 'number') return item.summary.best_axel_savings_cents;
  const taskVal = item.task.request_data?.best_axel_savings_cents;
  if (typeof taskVal === 'number') return taskVal;
  if (typeof taskVal === 'string' && taskVal.trim() !== '' && !Number.isNaN(Number(taskVal))) return Number(taskVal);
  return null;
}

function matchesSearch(item: FlightConversionListItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const fields = [
    routeLabel(item),
    tripLabel(item),
    item.task.id,
    item.task.user_id,
    item.task.status,
    item.task.claimed_by || '',
    item.summary.quote_request_id || '',
  ];
  return fields.some((field) => field.toLowerCase().includes(q));
}

function sortItems(items: FlightConversionListItem[], sortKey: SortKey, sortDir: SortDir): FlightConversionListItem[] {
  return [...items].sort((a, b) => {
    let aVal: string | number = '';
    let bVal: string | number = '';

    switch (sortKey) {
      case 'converted':
        aVal = convertedAt(a) ? new Date(convertedAt(a) as string).getTime() : 0;
        bVal = convertedAt(b) ? new Date(convertedAt(b) as string).getTime() : 0;
        break;
      case 'route':
        aVal = routeLabel(a).toLowerCase();
        bVal = routeLabel(b).toLowerCase();
        break;
      case 'savings':
        aVal = savingsCents(a) ?? -1;
        bVal = savingsCents(b) ?? -1;
        break;
      case 'status':
        aVal = `${a.task.status}:${a.task.claimed_by || ''}`;
        bVal = `${b.task.status}:${b.task.claimed_by || ''}`;
        break;
      case 'created':
        aVal = new Date(a.task.created_at).getTime();
        bVal = new Date(b.task.created_at).getTime();
        break;
    }

    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    claimed: 'bg-blue-500/20 text-blue-400',
    completed: 'bg-green-500/20 text-green-400',
    blocked: 'bg-red-500/20 text-red-400',
    failed: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap', colors[status] || 'bg-zinc-500/20 text-zinc-300')}>
      {status}
    </span>
  );
}

function SortHeader({
  label,
  sortKey,
  currentKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = currentKey === sortKey;
  return (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none whitespace-nowrap"
      onClick={() => onSort(sortKey)}
    >
      {label}
      {isActive && <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );
}

function FlightConversionRow({
  item,
  selected,
  onClick,
}: {
  item: FlightConversionListItem;
  selected: boolean;
  onClick: () => void;
}) {
  const route = routeLabel(item);
  const trip = tripLabel(item);
  const converted = convertedAt(item);
  const savings = savingsCents(item);

  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer',
        selected && 'bg-accent/40',
      )}
    >
      <td className="px-3 py-3"><StatusBadge status={item.task.status} /></td>
      <td className="px-3 py-3 text-sm">
        <div className="font-medium">{route}</div>
        <div className="text-xs text-muted-foreground truncate max-w-[320px]">{trip}</div>
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground font-mono whitespace-nowrap">
        {item.summary.quote_request_id ? `${item.summary.quote_request_id.slice(0, 8)}…` : '—'}
      </td>
      <td className="px-3 py-3 text-sm whitespace-nowrap">
        <div className="font-medium text-green-400">{formatMoneyCents(savings)}</div>
        <div className="text-xs text-muted-foreground">best shown savings</div>
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
        <div>{converted ? timeAgo(converted) : '—'}</div>
        <div>{converted ? new Date(converted).toLocaleDateString() : ''}</div>
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{item.task.claimed_by || '—'}</td>
      <td className="px-3 py-3">
        <Link
          href={`/users-list/${item.task.user_id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-primary hover:underline whitespace-nowrap"
        >
          Profile →
        </Link>
      </td>
    </tr>
  );
}

export default function FlightWatchConversionsPage() {
  const [tab, setTab] = useState<TabFilter>('pending');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('converted');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [items, setItems] = useState<FlightConversionListItem[]>([]);
  const [statusTotals, setStatusTotals] = useState<StatusTotals>(EMPTY_STATUS_TOTALS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<FlightConversionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    try {
      // Fetch by each API-supported status + one unfiltered call to discover 'failed' items
      const [pending, claimed, completed, blocked, unfiltered] = await Promise.all([
        api.listFlightConversions({ status: 'pending', limit: STATUS_PAGE_LIMIT, offset: 0 }),
        api.listFlightConversions({ status: 'claimed', limit: STATUS_PAGE_LIMIT, offset: 0 }),
        api.listFlightConversions({ status: 'completed', limit: STATUS_PAGE_LIMIT, offset: 0 }),
        api.listFlightConversions({ status: 'blocked', limit: STATUS_PAGE_LIMIT, offset: 0 }),
        api.listFlightConversions({ limit: STATUS_PAGE_LIMIT, offset: 0 }),
      ]);

      // 'failed' isn't a supported backend filter — derive count from totals
      const knownTotal = pending.total + claimed.total + completed.total + blocked.total;
      const failedTotal = Math.max(0, unfiltered.total - knownTotal);
      // Extract failed items from the unfiltered response
      const knownStatuses = new Set<string>(['pending', 'claimed', 'completed', 'blocked']);
      const failedItems = unfiltered.items.filter((item) => !knownStatuses.has(item.task.status));

      setStatusTotals({
        pending: pending.total,
        claimed: claimed.total,
        completed: completed.total,
        blocked: blocked.total,
        failed: failedTotal,
      });

      const byId = new Map<string, FlightConversionListItem>();
      [...pending.items, ...claimed.items, ...completed.items, ...blocked.items, ...failedItems].forEach((item) => {
        byId.set(item.task.id, item);
      });
      const merged = Array.from(byId.values());
      setItems(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch flight conversion tasks');
      setStatusTotals(EMPTY_STATUS_TOTALS);
      setItems([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const fetchDetail = useCallback(async (taskId: string, silent = false) => {
    if (!silent) {
      setDetailLoading(true);
      setDetailError(null);
    }
    try {
      const detail = await api.getFlightConversionDetail(taskId);
      setSelectedDetail(detail);
      setDetailError(null);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load conversion detail');
      if (!silent) setSelectedDetail(null);
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(() => {
      void fetchData(true);
      if (selectedTaskId) {
        void fetchDetail(selectedTaskId, true);
      }
    }, 30_000);

    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [fetchData, fetchDetail, selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId) return;
    const latest = items.find((item) => item.task.id === selectedTaskId);
    if (!latest) return;
    setSelectedDetail((prev) => {
      if (!prev || prev.task.id !== selectedTaskId) return prev;
      if (
        prev.task.status === latest.task.status &&
        prev.task.claimed_by === latest.task.claimed_by &&
        prev.task.claimed_at === latest.task.claimed_at &&
        prev.task.completed_at === latest.task.completed_at &&
        prev.task.blocked_reason === latest.task.blocked_reason &&
        prev.task.outcome === latest.task.outcome
      ) {
        return prev;
      }
      return { ...prev, task: { ...prev.task, ...latest.task } };
    });
  }, [items, selectedTaskId]);

  const loadedStatusCounts = useMemo<StatusTotals>(() => ({
    pending: items.filter((item) => item.task.status === 'pending').length,
    claimed: items.filter((item) => item.task.status === 'claimed').length,
    completed: items.filter((item) => item.task.status === 'completed').length,
    blocked: items.filter((item) => item.task.status === 'blocked').length,
    failed: items.filter((item) => !['pending', 'claimed', 'completed', 'blocked'].includes(item.task.status)).length,
  }), [items]);

  const hasTruncatedStatus = API_FILTERABLE_STATUSES.some((status) => statusTotals[status] > loadedStatusCounts[status])
    || statusTotals.failed > loadedStatusCounts.failed;

  const tabFiltered = useMemo(() => {
    if (tab === 'all') return items;
    if (tab === 'failed') {
      const knownStatuses = new Set(['pending', 'claimed', 'completed', 'blocked']);
      return items.filter((item) => !knownStatuses.has(item.task.status));
    }
    return items.filter((item) => item.task.status === tab);
  }, [items, tab]);

  const searched = useMemo(() => tabFiltered.filter((item) => matchesSearch(item, search)), [tabFiltered, search]);
  const sorted = useMemo(() => sortItems(searched, sortKey, sortDir), [searched, sortKey, sortDir]);

  const totalAcrossStatuses = statusTotals.pending + statusTotals.claimed + statusTotals.completed + statusTotals.blocked + statusTotals.failed;

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'route' || key === 'status' ? 'asc' : 'desc');
  }

  async function openDetail(taskId: string) {
    setSelectedTaskId(taskId);
    setSelectedDetail(null);
    setDetailError(null);
    await fetchDetail(taskId);
  }

  function closeDetail() {
    setSelectedTaskId(null);
    setSelectedDetail(null);
    setDetailLoading(false);
    setDetailError(null);
  }

  function handleTaskUpdate(updatedTask: Task) {
    setItems((prev) => prev.map((item) => (
      item.task.id === updatedTask.id ? { ...item, task: { ...item.task, ...updatedTask } } : item
    )));
    setSelectedDetail((prev) => (prev ? { ...prev, task: { ...prev.task, ...updatedTask } } : prev));
  }

  async function refreshSelectedDetail() {
    if (!selectedTaskId) return;
    await fetchDetail(selectedTaskId, true);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Flight Watch Conversions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Membership conversions from the flight watch results page, with the exact prices shown and operator follow-up actions.
        </p>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4 flex-wrap">
        <span>
          <span className="font-medium text-yellow-400">{statusTotals.pending}</span> pending
          <span className="mx-1">·</span>
          <span className="font-medium text-blue-400">{statusTotals.claimed}</span> claimed
          <span className="mx-1">·</span>
          <span className="font-medium text-green-400">{statusTotals.completed}</span> completed
          <span className="mx-1">·</span>
          <span className="font-medium text-red-400">{statusTotals.blocked}</span> blocked
          <span className="mx-1">·</span>
          <span className="font-medium text-red-400">{statusTotals.failed}</span> failed
        </span>
      </div>

      {hasTruncatedStatus && (
        <p className="text-xs text-muted-foreground mb-4">
          Loaded up to {STATUS_PAGE_LIMIT} tasks per status. Counts may be truncated if a queue is larger.
        </p>
      )}

      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
          <div className="flex gap-1 bg-accent/30 rounded-lg p-1 flex-wrap">
            <button
              onClick={() => setTab('pending')}
              className={cn('px-4 py-1.5 text-sm font-medium rounded-md transition-colors', tab === 'pending' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              Pending {statusTotals.pending > 0 && <span className="ml-1 text-xs opacity-70">({statusTotals.pending})</span>}
            </button>
            <button
              onClick={() => setTab('claimed')}
              className={cn('px-4 py-1.5 text-sm font-medium rounded-md transition-colors', tab === 'claimed' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              Claimed {statusTotals.claimed > 0 && <span className="ml-1 text-xs opacity-70">({statusTotals.claimed})</span>}
            </button>
            <button
              onClick={() => setTab('completed')}
              className={cn('px-4 py-1.5 text-sm font-medium rounded-md transition-colors', tab === 'completed' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              Completed {statusTotals.completed > 0 && <span className="ml-1 text-xs opacity-70">({statusTotals.completed})</span>}
            </button>
            <button
              onClick={() => setTab('blocked')}
              className={cn('px-4 py-1.5 text-sm font-medium rounded-md transition-colors', tab === 'blocked' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              Blocked {statusTotals.blocked > 0 && <span className="ml-1 text-xs opacity-70">({statusTotals.blocked})</span>}
            </button>
            <button
              onClick={() => setTab('failed')}
              className={cn('px-4 py-1.5 text-sm font-medium rounded-md transition-colors', tab === 'failed' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              Failed {statusTotals.failed > 0 && <span className="ml-1 text-xs opacity-70">({statusTotals.failed})</span>}
            </button>
            <button
              onClick={() => setTab('all')}
              className={cn('px-4 py-1.5 text-sm font-medium rounded-md transition-colors', tab === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              All {totalAcrossStatuses > 0 && <span className="ml-1 text-xs opacity-70">({totalAcrossStatuses})</span>}
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={sortKey}
              onChange={(e) => {
                const key = e.target.value as SortKey;
                setSortKey(key);
                setSortDir(key === 'route' || key === 'status' ? 'asc' : 'desc');
              }}
              className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="converted">Sort: Converted</option>
              <option value="route">Sort: Route</option>
              <option value="savings">Sort: Savings</option>
              <option value="status">Sort: Status</option>
              <option value="created">Sort: Task Created</option>
            </select>
            <button
              onClick={() => setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
              className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-muted-foreground rounded-lg border border-border hover:bg-accent transition-colors"
            >
              {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
            </button>
          </div>

          <div className="flex-1 max-w-lg">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search route, quote request, user, claimer..."
              className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <button
            onClick={() => {
              void fetchData();
              if (selectedTaskId) void fetchDetail(selectedTaskId, true);
            }}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-muted-foreground rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
            title="Refresh"
          >
            {loading ? 'Loading...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {error ? (
          <div className="p-6 text-center">
            <p className="text-red-400 mb-2">{error}</p>
            <button
              onClick={() => void fetchData()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">Loading flight conversion tasks...</div>
        ) : sorted.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            {search
              ? 'No flight conversion tasks match your search'
              : tab === 'all'
                ? 'No flight conversion tasks'
                : `No ${tab} flight conversion tasks`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-accent/30">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Status</th>
                  <SortHeader label="Route" sortKey="route" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Quote</th>
                  <SortHeader label="Savings" sortKey="savings" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Converted" sortKey="converted" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Claimed By" sortKey="status" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Profile</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((item) => (
                  <FlightConversionRow
                    key={item.task.id}
                    item={item}
                    selected={selectedTaskId === item.task.id}
                    onClick={() => void openDetail(item.task.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && sorted.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <span>
            Showing {sorted.length}
            {search ? ` of ${tabFiltered.length}` : ''} tasks
          </span>
        </div>
      )}

      {selectedTaskId && detailLoading && !selectedDetail && (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
          <div className="w-full max-w-4xl bg-card border-l border-border h-full overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-semibold">Flight Watch Conversion</h2>
              <button onClick={closeDetail} className="p-2 hover:bg-accent rounded-md transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 text-sm text-muted-foreground">Loading conversion detail...</div>
          </div>
        </div>
      )}

      {selectedTaskId && !detailLoading && detailError && !selectedDetail && (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
          <div className="w-full max-w-2xl bg-card border-l border-border h-full overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-semibold">Flight Watch Conversion</h2>
              <button onClick={closeDetail} className="p-2 hover:bg-accent rounded-md transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 text-sm text-red-400">{detailError}</div>
          </div>
        </div>
      )}

      {selectedDetail && (
        <FlightWatchConversionDetail
          key={selectedDetail.task.id}
          detail={selectedDetail}
          onClose={closeDetail}
          onTaskUpdate={handleTaskUpdate}
          onRefreshDetail={refreshSelectedDetail}
        />
      )}
    </div>
  );
}
