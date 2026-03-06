'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AgentFlightBookingDetail,
  AgentFlightBookingListItem,
  AgentFlightBookingTaskStatus,
  api,
  Task,
} from '@/lib/api';
import { AgentFlightBookingDetailPanel } from '@/components/agent-flight-booking-detail';
import { cn } from '@/lib/utils';

type TabFilter = AgentFlightBookingTaskStatus | 'all';
type SortKey = 'created' | 'route' | 'carrier' | 'paid' | 'status';
type SortDir = 'asc' | 'desc';
type StatusTotals = Record<AgentFlightBookingTaskStatus, number>;

const STATUS_PAGE_LIMIT = 100;
const API_FILTERABLE_STATUSES: AgentFlightBookingTaskStatus[] = ['pending', 'claimed', 'completed', 'blocked', 'failed'];
const PLACEHOLDER_CONFIRMATION_CODES = new Set(['PENDING']);
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMoneyCents(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(0)}`;
  }
}

function routeLabel(item: AgentFlightBookingListItem): string {
  const { origin, destination } = item.summary;
  if (origin && destination) return `${origin} → ${destination}`;
  if (origin) return origin;
  if (destination) return destination;
  return 'Route unavailable';
}

function tripLabel(item: AgentFlightBookingListItem): string {
  const { outbound_departure, return_departure, trip_type, cabin } = item.summary;
  const dates = outbound_departure
    ? `${formatDate(outbound_departure)}${return_departure ? ` → ${formatDate(return_departure)}` : ''}`
    : 'Dates unavailable';
  return [dates, trip_type?.replace(/_/g, ' '), cabin].filter(Boolean).join(' · ');
}

function carrierLabel(item: AgentFlightBookingListItem): string {
  return item.summary.carrier_name || item.summary.carrier_code || item.summary.flight_numbers.join(', ') || 'Carrier unavailable';
}

function bookingLabel(item: AgentFlightBookingListItem): string {
  const locator = item.summary.record_locator?.trim() || '';
  if (locator && !PLACEHOLDER_CONFIRMATION_CODES.has(locator.toUpperCase())) return locator;
  if (item.summary.booking_id) return item.summary.booking_id;
  return 'Pending';
}

function matchesSearch(item: AgentFlightBookingListItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const fields = [
    routeLabel(item),
    tripLabel(item),
    carrierLabel(item),
    bookingLabel(item),
    item.summary.booking_id || '',
    item.task.user_id,
    item.task.claimed_by || '',
    item.task.status,
  ];
  return fields.some((field) => field.toLowerCase().includes(q));
}

function sortItems(items: AgentFlightBookingListItem[], sortKey: SortKey, sortDir: SortDir): AgentFlightBookingListItem[] {
  return [...items].sort((a, b) => {
    let aVal: string | number = '';
    let bVal: string | number = '';

    switch (sortKey) {
      case 'created':
        aVal = new Date(a.task.created_at).getTime();
        bVal = new Date(b.task.created_at).getTime();
        break;
      case 'route':
        aVal = routeLabel(a).toLowerCase();
        bVal = routeLabel(b).toLowerCase();
        break;
      case 'carrier':
        aVal = carrierLabel(a).toLowerCase();
        bVal = carrierLabel(b).toLowerCase();
        break;
      case 'paid':
        aVal = a.summary.price_paid_cents ?? -1;
        bVal = b.summary.price_paid_cents ?? -1;
        break;
      case 'status':
        aVal = `${a.task.status}:${a.task.claimed_by || ''}`;
        bVal = `${b.task.status}:${b.task.claimed_by || ''}`;
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
    <span className={cn('rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap', colors[status] || 'bg-zinc-500/20 text-zinc-300')}>
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
      className="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      onClick={() => onSort(sortKey)}
    >
      {label}
      {isActive && <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );
}

function AgentFlightBookingRow({
  item,
  selected,
  onClick,
}: {
  item: AgentFlightBookingListItem;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-accent/50',
        selected && 'bg-accent/40',
      )}
    >
      <td className="px-3 py-3"><StatusBadge status={item.task.status} /></td>
      <td className="px-3 py-3 text-sm">
        <div className="font-medium">{routeLabel(item)}</div>
        <div className="max-w-[320px] truncate text-xs text-muted-foreground">{tripLabel(item)}</div>
      </td>
      <td className="px-3 py-3 text-sm">
        <div className="font-medium">{carrierLabel(item)}</div>
        <div className="truncate text-xs text-muted-foreground">{item.summary.flight_numbers.join(' · ') || '—'}</div>
      </td>
      <td className="px-3 py-3 text-sm">
        <div className="font-medium">{bookingLabel(item)}</div>
        <div className="truncate text-xs text-muted-foreground">{item.summary.booking_status || 'booking pending'}</div>
      </td>
      <td className="px-3 py-3 text-sm whitespace-nowrap">{formatMoneyCents(item.summary.price_paid_cents, item.summary.currency || 'USD')}</td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
        <div>{timeAgo(item.task.created_at)}</div>
        <div>{new Date(item.task.created_at).toLocaleDateString()}</div>
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{item.task.claimed_by || '—'}</td>
      <td className="px-3 py-3">
        <Link
          href={`/users-list/${item.task.user_id}`}
          onClick={(e) => e.stopPropagation()}
          className="whitespace-nowrap text-xs text-primary hover:underline"
        >
          Profile →
        </Link>
      </td>
    </tr>
  );
}

export default function AgentFlightBookingsPage() {
  const [tab, setTab] = useState<TabFilter>('pending');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [items, setItems] = useState<AgentFlightBookingListItem[]>([]);
  const [statusTotals, setStatusTotals] = useState<StatusTotals>(EMPTY_STATUS_TOTALS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<AgentFlightBookingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    try {
      const [pending, claimed, completed, blocked, failed] = await Promise.all([
        api.listAgentFlightBookings({ status: 'pending', limit: STATUS_PAGE_LIMIT, offset: 0 }),
        api.listAgentFlightBookings({ status: 'claimed', limit: STATUS_PAGE_LIMIT, offset: 0 }),
        api.listAgentFlightBookings({ status: 'completed', limit: STATUS_PAGE_LIMIT, offset: 0 }),
        api.listAgentFlightBookings({ status: 'blocked', limit: STATUS_PAGE_LIMIT, offset: 0 }),
        api.listAgentFlightBookings({ status: 'failed', limit: STATUS_PAGE_LIMIT, offset: 0 }),
      ]);

      setStatusTotals({
        pending: pending.total,
        claimed: claimed.total,
        completed: completed.total,
        blocked: blocked.total,
        failed: failed.total,
      });

      const byId = new Map<string, AgentFlightBookingListItem>();
      [...pending.items, ...claimed.items, ...completed.items, ...blocked.items, ...failed.items].forEach((item) => {
        byId.set(item.task.id, item);
      });
      setItems(Array.from(byId.values()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agent flight bookings');
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
      const detail = await api.getAgentFlightBookingDetail(taskId);
      setSelectedDetail(detail);
      setDetailError(null);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load booking detail');
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
    failed: items.filter((item) => item.task.status === 'failed').length,
  }), [items]);

  const hasTruncatedStatus = API_FILTERABLE_STATUSES.some((status) => statusTotals[status] > loadedStatusCounts[status]);

  const tabFiltered = useMemo(() => {
    if (tab === 'all') return items;
    return items.filter((item) => item.task.status === tab);
  }, [items, tab]);

  const searched = useMemo(() => tabFiltered.filter((item) => matchesSearch(item, search)), [tabFiltered, search]);
  const sorted = useMemo(() => sortItems(searched, sortKey, sortDir), [searched, sortKey, sortDir]);

  const totalAcrossStatuses =
    statusTotals.pending +
    statusTotals.claimed +
    statusTotals.completed +
    statusTotals.blocked +
    statusTotals.failed;

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'route' || key === 'carrier' || key === 'status' ? 'asc' : 'desc');
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
    await Promise.all([fetchData(true), fetchDetail(selectedTaskId, true)]);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Agent Flight Bookings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operator fulfillment queue for the new agent-backed flight booking flow.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
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
        <p className="mb-4 text-xs text-muted-foreground">
          Loaded up to {STATUS_PAGE_LIMIT} tasks per status. Counts may be truncated if a queue is larger.
        </p>
      )}

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex flex-wrap gap-1 rounded-lg bg-accent/30 p-1">
            {(['pending', 'claimed', 'completed', 'blocked', 'failed', 'all'] as TabFilter[]).map((nextTab) => (
              <button
                key={nextTab}
                onClick={() => setTab(nextTab)}
                className={cn(
                  'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                  tab === nextTab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {nextTab === 'all' ? 'All' : nextTab.charAt(0).toUpperCase() + nextTab.slice(1)}
                {nextTab !== 'all' && statusTotals[nextTab] > 0 && (
                  <span className="ml-1 text-xs opacity-70">({statusTotals[nextTab]})</span>
                )}
                {nextTab === 'all' && totalAcrossStatuses > 0 && (
                  <span className="ml-1 text-xs opacity-70">({totalAcrossStatuses})</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={sortKey}
              onChange={(e) => {
                const key = e.target.value as SortKey;
                setSortKey(key);
                setSortDir(key === 'route' || key === 'carrier' || key === 'status' ? 'asc' : 'desc');
              }}
              className="rounded-lg border border-border bg-accent/50 px-3 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="created">Sort: Task Created</option>
              <option value="route">Sort: Route</option>
              <option value="carrier">Sort: Carrier</option>
              <option value="paid">Sort: Paid</option>
              <option value="status">Sort: Status</option>
            </select>
            <button
              onClick={() => setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
              className="rounded-lg border border-border bg-accent/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
            >
              {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
            </button>
          </div>

          <div className="flex-1 max-w-lg">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search route, booking, user, carrier..."
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <button
            onClick={() => {
              void fetchData();
              if (selectedTaskId) void fetchDetail(selectedTaskId, true);
            }}
            disabled={loading}
            className="rounded-lg bg-accent/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            {loading ? 'Loading...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {error ? (
          <div className="p-6 text-center">
            <p className="mb-2 text-red-400">{error}</p>
            <button
              onClick={() => void fetchData()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Retry
            </button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">Loading agent flight bookings...</div>
        ) : sorted.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            {search
              ? 'No agent flight bookings match your search'
              : tab === 'all'
                ? 'No agent flight booking tasks'
                : `No ${tab} agent flight booking tasks`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-accent/30">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Status</th>
                  <SortHeader label="Route" sortKey="route" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Carrier" sortKey="carrier" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Booking</th>
                  <SortHeader label="Paid" sortKey="paid" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Created" sortKey="created" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Claimed By" sortKey="status" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Profile</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((item) => (
                  <AgentFlightBookingRow
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
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {sorted.length}
            {search ? ` of ${tabFiltered.length}` : ''} tasks
          </span>
        </div>
      )}

      {selectedTaskId && detailLoading && !selectedDetail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
          <div className="h-full w-full max-w-4xl overflow-y-auto border-l border-border bg-card">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card p-4">
              <h2 className="text-lg font-semibold">Agent Flight Booking</h2>
              <button onClick={closeDetail} className="rounded-md p-2 transition-colors hover:bg-accent">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 text-sm text-muted-foreground">Loading booking detail...</div>
          </div>
        </div>
      )}

      {selectedTaskId && !detailLoading && detailError && !selectedDetail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
          <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-card">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card p-4">
              <h2 className="text-lg font-semibold">Agent Flight Booking</h2>
              <button onClick={closeDetail} className="rounded-md p-2 transition-colors hover:bg-accent">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 text-sm text-red-400">{detailError}</div>
          </div>
        </div>
      )}

      {selectedDetail && (
        <AgentFlightBookingDetailPanel
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
