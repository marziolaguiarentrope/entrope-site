'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { api, UserListItem } from '@/lib/api';
import { cn, exportCSV, exportJSON } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────

type SortKey = 'name' | 'email' | 'status' | 'membership' | 'hotels' | 'flights' | 'emails' | 'created_at';
type SortDir = 'asc' | 'desc';
type Timezone = 'UTC' | 'America/New_York' | 'America/Chicago' | 'America/Los_Angeles';

const TIMEZONE_OPTIONS: { value: Timezone; label: string }[] = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
];

// ── Helpers ──────────────────────────────────────────────

function timeAgo(dateString: string): string {
  if (!dateString) return '—';
  const now = new Date();
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '—';
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

function formatDate(dateString: string, tz: Timezone): string {
  if (!dateString) return '—';
  // API returns UTC timestamps without 'Z' suffix — ensure they parse as UTC
  const normalized = dateString.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateString)
    ? dateString
    : dateString + 'Z';
  const date = new Date(normalized);
  if (isNaN(date.getTime())) return dateString;

  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-500/20 text-green-400',
    suspended: 'bg-yellow-500/20 text-yellow-400',
    banned: 'bg-red-500/20 text-red-400',
    deactivated: 'bg-zinc-500/20 text-zinc-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium', colors[status] || 'bg-zinc-500/20 text-zinc-400')}>
      {status}
    </span>
  );
}

// ── Status Filter Tabs ───────────────────────────────────

const STATUS_TABS = [
  { value: null, label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'banned', label: 'Banned' },
  { value: 'deactivated', label: 'Deactivated' },
] as const;

// ── Membership Filter Options ────────────────────────────

type MembershipFilter = 'all' | 'member' | 'non-member';

const MEMBERSHIP_TABS: { value: MembershipFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'member', label: 'Axel One' },
  { value: 'non-member', label: 'No Membership' },
];

const PAGE_SIZES = [25, 50, 100];

function MembershipBadge({ status, plan }: { status: string | null; plan: string | null }) {
  // No membership data at all
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;

  let label: string;
  let colorClass: string;

  if (status === 'cancelled') {
    label = plan || 'Cancelled';
    colorClass = 'bg-red-500/20 text-red-400 border border-red-500/30';
  } else if (status === 'trialing') {
    label = plan || 'Trial';
    colorClass = 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
  } else if (plan) {
    // Has a plan name — check if free or paid
    const isFree = plan.toLowerCase().includes('free');
    label = plan;
    colorClass = isFree
      ? 'bg-zinc-500/10 text-zinc-500 border border-zinc-500/20'
      : 'bg-green-500/20 text-green-400 border border-green-500/30';
  } else {
    // plan is null — backend bug (ENG-16187), show status as-is
    label = status;
    colorClass = status === 'active'
      ? 'bg-zinc-500/10 text-zinc-500 border border-zinc-500/20'
      : 'bg-zinc-500/10 text-zinc-500 border border-zinc-500/20';
  }

  return (
    <span className={cn('inline-block px-2 py-0.5 text-xs rounded font-medium', colorClass)}>
      {label}
    </span>
  );
}

// Sort helper — used for both full-dataset and page-level sorting
function sortItems(items: UserListItem[], key: SortKey, dir: SortDir): UserListItem[] {
  return [...items].sort((a, b) => {
    const d = dir === 'asc' ? 1 : -1;
    switch (key) {
      case 'name':
        return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()) * d;
      case 'email':
        return (a.email || '').toLowerCase().localeCompare((b.email || '').toLowerCase()) * d;
      case 'status':
        return a.status.localeCompare(b.status) * d;
      case 'membership':
        return (a.membership_status || '').toLowerCase().localeCompare((b.membership_status || '').toLowerCase()) * d;
      case 'hotels':
        return ((a.hotel_count ?? 0) - (b.hotel_count ?? 0)) * d;
      case 'flights':
        return ((a.flight_count ?? 0) - (b.flight_count ?? 0)) * d;
      case 'emails':
        return ((a.email_count ?? 0) - (b.email_count ?? 0)) * d;
      case 'created_at':
        return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * d;
      default:
        return 0;
    }
  });
}

// ── Column Definitions ───────────────────────────────────

const COLUMNS = [
  { key: 'name' as SortKey, label: 'Name', defaultWidth: 160, minWidth: 100, sortable: true },
  { key: 'email' as SortKey, label: 'Email', defaultWidth: 200, minWidth: 120, sortable: true },
  { key: 'phone' as SortKey | 'phone', label: 'Phone', defaultWidth: 130, minWidth: 100, sortable: false },
  { key: 'status' as SortKey, label: 'Status', defaultWidth: 90, minWidth: 70, sortable: true },
  { key: 'membership' as SortKey, label: 'Membership', defaultWidth: 110, minWidth: 70, sortable: true },
  { key: 'hotels' as SortKey, label: 'Hotels', defaultWidth: 70, minWidth: 55, sortable: true },
  { key: 'flights' as SortKey, label: 'Flights', defaultWidth: 70, minWidth: 55, sortable: true },
  { key: 'emails' as SortKey, label: 'Emails', defaultWidth: 70, minWidth: 55, sortable: true },
  { key: 'created_at' as SortKey, label: 'Created', defaultWidth: 190, minWidth: 120, sortable: true },
] as const;

// ── Main Page ────────────────────────────────────────────

export default function UsersListPage() {
  // Data
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Column widths for resizing
  const [colWidths, setColWidths] = useState<number[]>(COLUMNS.map(c => c.defaultWidth));
  const resizing = useRef<{ colIndex: number; startX: number; startWidth: number } | null>(null);

  // Pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [membershipFilter, setMembershipFilter] = useState<MembershipFilter>('all');
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Progressive scan cache for client-side filtering
  const fullDatasetRef = useRef<{
    key: string;
    items: UserListItem[];
    scannedOffset: number;
    serverTotal: number;
    done: boolean;
  } | null>(null);
  const fetchVersionRef = useRef(0);
  const [fetchProgress, setFetchProgress] = useState<{ scanned: number; total: number; found: number } | null>(null);
  const [scanComplete, setScanComplete] = useState(true);

  // Expanded row preview
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  // Sorting — default to newest first
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Timezone
  const [timezone, setTimezone] = useState<Timezone>('America/Los_Angeles');

  // Debounce search input
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0); // Reset to first page on search
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [search]);

  // Apply membership/status filters to an array of users
  function applyClientFilters(members: UserListItem[], status: string | null, membership: MembershipFilter): UserListItem[] {
    let filtered = members;
    if (status) {
      filtered = filtered.filter(m => m.status === status);
    }
    if (membership === 'member') {
      filtered = filtered.filter(m =>
        m.membership_plan != null &&
        !m.membership_plan.toLowerCase().includes('free')
      );
    } else if (membership === 'non-member') {
      filtered = filtered.filter(m =>
        m.membership_plan == null ||
        m.membership_plan.toLowerCase().includes('free')
      );
    }
    return filtered;
  }

  // Estimate total matching users based on the ratio found so far
  function estimateFilteredTotal(found: number, scanned: number, serverTotal: number): number {
    if (scanned === 0) return 0;
    return Math.round((found / scanned) * serverTotal);
  }

  // Fetch users — progressively scans server pages when client-side filters
  // are active OR when a non-default sort is applied (need full dataset to
  // sort correctly across all pages). Cached per filter combo.
  const fetchUsers = useCallback(async () => {
    const hasClientFilter = statusFilter != null || membershipFilter !== 'all';
    const isDefaultSort = sortKey === 'created_at' && sortDir === 'desc';
    const needsFullScan = !isDefaultSort;

    if (!hasClientFilter && !needsFullScan) {
      // Fast path: default sort, no filters — single page from API
      fullDatasetRef.current = null;
      const version = ++fetchVersionRef.current;
      setLoading(true);
      setError(null);
      setFetchProgress(null);
      setScanComplete(true);
      try {
        const result = await api.listUsers({
          offset: page * pageSize,
          limit: pageSize,
          q: debouncedSearch || undefined,
        });
        if (fetchVersionRef.current !== version) return;
        setUsers(result.members);
        setTotalCount(result.total_count);
      } catch (err) {
        if (fetchVersionRef.current !== version) return;
        setError(err instanceof Error ? err.message : 'Failed to load users');
        setUsers([]);
      } finally {
        if (fetchVersionRef.current === version) setLoading(false);
      }
      return;
    }

    // Need progressive scan — either for client filters, non-default sort, or both
    const cacheKey = `${debouncedSearch}|${statusFilter}|${membershipFilter}`;
    const targetEnd = (page + 1) * pageSize;

    // Check if cache can satisfy this request without fetching
    const cache = fullDatasetRef.current;
    if (cache?.key === cacheKey) {
      if (needsFullScan && cache.done) {
        // Non-default sort with complete cache — sort and paginate instantly
        const sorted = sortItems(cache.items, sortKey, sortDir);
        const start = page * pageSize;
        setUsers(sorted.slice(start, start + pageSize));
        setTotalCount(cache.items.length);
        setScanComplete(true);
        setLoading(false);
        return;
      }
      if (!needsFullScan && (cache.items.length >= targetEnd || cache.done)) {
        // Default sort with enough cached items — paginate directly
        const start = page * pageSize;
        setUsers(cache.items.slice(start, targetEnd));
        setTotalCount(cache.done
          ? cache.items.length
          : estimateFilteredTotal(cache.items.length, cache.scannedOffset, cache.serverTotal)
        );
        setScanComplete(cache.done);
        return;
      }
    }

    // Need to scan — start fresh or continue from where cache left off
    const version = ++fetchVersionRef.current;
    setLoading(true);
    setError(null);
    setScanComplete(false);

    let items = cache?.key === cacheKey ? [...cache.items] : [];
    let offset = cache?.key === cacheKey ? cache.scannedOffset : 0;
    let serverTotal = cache?.key === cacheKey ? cache.serverTotal : 0;

    try {
      const batchSize = 100;
      const parallelism = 10;

      // First batch to learn serverTotal (if starting fresh)
      if (offset === 0) {
        const first = await api.listUsers({ offset: 0, limit: batchSize, q: debouncedSearch || undefined });
        if (fetchVersionRef.current !== version) return;
        serverTotal = first.total_count;
        const matches = hasClientFilter
          ? applyClientFilters(first.members, statusFilter, membershipFilter)
          : first.members;
        items.push(...matches);
        offset = batchSize;
        setFetchProgress({ scanned: Math.min(offset, serverTotal), total: serverTotal, found: items.length });
      }

      // For non-default sort: scan ALL pages (need complete data to sort)
      // For filter-only (default sort): scan until enough matches found
      while (offset < serverTotal && (needsFullScan || items.length < targetEnd)) {
        const batchOffsets: number[] = [];
        for (let o = offset; o < serverTotal && batchOffsets.length < parallelism; o += batchSize) {
          batchOffsets.push(o);
        }

        const results = await Promise.all(
          batchOffsets.map(o => api.listUsers({ offset: o, limit: batchSize, q: debouncedSearch || undefined }))
        );
        if (fetchVersionRef.current !== version) return;

        for (const r of results) {
          const matches = hasClientFilter
            ? applyClientFilters(r.members, statusFilter, membershipFilter)
            : r.members;
          items.push(...matches);
        }
        offset = batchOffsets[batchOffsets.length - 1] + batchSize;
        setFetchProgress({ scanned: Math.min(offset, serverTotal), total: serverTotal, found: items.length });
      }

      const done = offset >= serverTotal;
      fullDatasetRef.current = { key: cacheKey, items, scannedOffset: offset, serverTotal, done };

      if (needsFullScan) {
        // Sort the full dataset, then paginate
        const sorted = sortItems(items, sortKey, sortDir);
        const start = page * pageSize;
        setUsers(sorted.slice(start, start + pageSize));
        setTotalCount(items.length);
      } else {
        // Default sort — paginate directly from scanned items
        const start = page * pageSize;
        setUsers(items.slice(start, targetEnd));
        setTotalCount(done
          ? items.length
          : estimateFilteredTotal(items.length, offset, serverTotal)
        );
      }
      setScanComplete(done);
      setFetchProgress(null);
    } catch (err) {
      if (fetchVersionRef.current !== version) return;
      setError(err instanceof Error ? err.message : 'Failed to load users');
      setUsers([]);
    } finally {
      if (fetchVersionRef.current === version) {
        setLoading(false);
        setFetchProgress(null);
      }
    }
  }, [page, pageSize, debouncedSearch, statusFilter, membershipFilter, sortKey, sortDir]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Reset page when filters change
  function handleStatusChange(status: string | null) {
    setStatusFilter(status);
    setPage(0);
  }

  function handleMembershipChange(filter: MembershipFilter) {
    setMembershipFilter(filter);
    setPage(0);
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size);
    setPage(0);
  }

  // Collapse expanded row when context changes
  useEffect(() => {
    setExpandedUserId(null);
  }, [page, pageSize, statusFilter, membershipFilter, debouncedSearch, sortKey, sortDir]);

  // Export visible or cached data
  function handleExport(format: 'csv' | 'json') {
    // If we have a complete cached dataset (from filter scan or sort scan),
    // export all items sorted by current column. Otherwise export current page.
    const cache = fullDatasetRef.current;
    const dataToExport = cache?.done && cache.items.length
      ? sortItems(cache.items, sortKey, sortDir)
      : sortedUsers;

    const rows = dataToExport.map(u => ({
      id: u.id,
      name: u.name || '',
      email: u.email || '',
      phone: u.phone_number || '',
      status: u.status,
      membership_status: u.membership_status || '',
      membership_plan: u.membership_plan || '',
      hotel_count: u.hotel_count ?? 0,
      flight_count: u.flight_count ?? 0,
      email_count: u.email_count ?? 0,
      created_at: u.created_at,
    }));

    const timestamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      exportCSV(rows, `users-${timestamp}.csv`);
    } else {
      exportJSON(rows, `users-${timestamp}.json`);
    }
  }

  // Column resize handlers
  const handleResizeStart = useCallback((colIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { colIndex, startX: e.clientX, startWidth: colWidths[colIndex] };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const delta = ev.clientX - resizing.current.startX;
      const newWidth = Math.max(COLUMNS[resizing.current.colIndex].minWidth, resizing.current.startWidth + delta);
      setColWidths(prev => {
        const next = [...prev];
        next[resizing.current!.colIndex] = newWidth;
        return next;
      });
    };

    const handleMouseUp = () => {
      resizing.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [colWidths]);

  // Sort handler — resets to page 0 since sort order changes everything
  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'created_at' ? 'desc' : 'asc');
    }
    setPage(0);
  }

  // Sorted users — when full dataset is cached, users are already globally
  // sorted by fetchUsers; this memo is a stable no-op in that case.
  // For the fast-path (default sort, no filters), it sorts the single page.
  const sortedUsers = useMemo(() => sortItems(users, sortKey, sortDir), [users, sortKey, sortDir]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Users List</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse all users with pagination, filtering, and search
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleExport('csv')}
            disabled={loading || users.length === 0}
            className="px-3 py-2 text-sm font-medium bg-accent/50 rounded-lg hover:bg-accent disabled:opacity-30 transition-colors flex items-center gap-1.5"
            title={fullDatasetRef.current?.items.length ? `Export all ${fullDatasetRef.current.items.length} matching` : `Export current page (${sortedUsers.length})`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" />
            </svg>
            CSV
          </button>
          <button
            onClick={() => handleExport('json')}
            disabled={loading || users.length === 0}
            className="px-3 py-2 text-sm font-medium bg-accent/50 rounded-lg hover:bg-accent disabled:opacity-30 transition-colors flex items-center gap-1.5"
            title={fullDatasetRef.current?.items.length ? `Export all ${fullDatasetRef.current.items.length} matching` : `Export current page (${sortedUsers.length})`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" />
            </svg>
            JSON
          </button>
          <div className="w-px h-6 bg-border" />
          <button
            onClick={() => { fullDatasetRef.current = null; fetchUsers(); }}
            disabled={loading}
            className="px-3 py-2 text-sm font-medium bg-accent/50 rounded-lg hover:bg-accent disabled:opacity-30 transition-colors flex items-center gap-1.5"
          >
            <svg className={cn("w-4 h-4", loading && "animate-spin")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-9-9" strokeLinecap="round" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="flex-1 max-w-md px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          />

          <div className="flex gap-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.label}
                onClick={() => handleStatusChange(tab.value)}
                className={cn(
                  'px-3 py-2 text-xs font-medium rounded-lg transition-colors',
                  statusFilter === tab.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-accent/50 text-muted-foreground hover:bg-accent'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            {MEMBERSHIP_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => handleMembershipChange(tab.value)}
                className={cn(
                  'px-3 py-2 text-xs font-medium rounded-lg transition-colors',
                  membershipFilter === tab.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-accent/50 text-muted-foreground hover:bg-accent'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value as Timezone)}
            className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {TIMEZONE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Scanning progress shown when progressively loading filtered results */}
        {fetchProgress && !loading && (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-400">
            <div className="w-3.5 h-3.5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin flex-shrink-0" />
            <span>Scanning... found {fetchProgress.found.toLocaleString()} matching ({fetchProgress.scanned.toLocaleString()}/{fetchProgress.total.toLocaleString()} scanned)</span>
            <div className="flex-1 max-w-[120px] bg-blue-500/20 rounded-full h-1 overflow-hidden">
              <div className="bg-blue-400 h-full rounded-full transition-all duration-300" style={{ width: `${(fetchProgress.scanned / Math.max(1, fetchProgress.total)) * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {error ? (
          <div className="p-8 text-center">
            <p className="text-red-400 mb-2">{error}</p>
            <button
              onClick={fetchUsers}
              className="mt-3 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-muted-foreground">
            {fetchProgress ? (
              <div className="space-y-2">
                <span>Scanning users... found {fetchProgress.found.toLocaleString()} matching ({fetchProgress.scanned.toLocaleString()}/{fetchProgress.total.toLocaleString()} scanned)</span>
                <div className="w-48 mx-auto bg-accent/30 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-primary h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, (fetchProgress.scanned / Math.max(1, fetchProgress.total)) * 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              'Loading users...'
            )}
          </div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            {debouncedSearch || statusFilter || membershipFilter !== 'all'
              ? 'No users match the current filters'
              : 'No users found'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table style={{ tableLayout: 'fixed', width: colWidths.reduce((a, b) => a + b, 0) }}>
              <thead className="border-b border-border bg-accent/30">
                <tr>
                  {COLUMNS.map((col, i) => (
                    <th
                      key={col.key}
                      style={{ width: colWidths[i] }}
                      className={cn(
                        "relative px-4 py-2 text-left text-xs font-medium text-muted-foreground select-none transition-colors group",
                        col.sortable && "cursor-pointer hover:text-foreground"
                      )}
                      onClick={() => col.sortable && handleSort(col.key as SortKey)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {col.sortable && sortKey === col.key ? (
                          <span className="text-primary font-bold">{sortDir === 'asc' ? '↑' : '↓'}</span>
                        ) : col.sortable ? (
                          <span className="opacity-0 group-hover:opacity-50 text-muted-foreground">↕</span>
                        ) : null}
                      </span>
                      {/* Resize handle */}
                      {i < COLUMNS.length - 1 && (
                        <div
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
                          onMouseDown={(e) => handleResizeStart(i, e)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map((user) => {
                  const isExpanded = expandedUserId === user.id;
                  return (
                    <Fragment key={user.id}>
                      <tr
                        onClick={() => setExpandedUserId(isExpanded ? null : user.id)}
                        className={cn(
                          "border-b border-border hover:bg-accent/50 transition-colors cursor-pointer",
                          isExpanded && "bg-accent/40 border-b-0"
                        )}
                      >
                        <td style={{ width: colWidths[0] }} className="px-4 py-3 text-sm font-medium truncate">
                          <span className="inline-flex items-center gap-1.5">
                            <svg
                              className={cn("w-3 h-3 text-muted-foreground/60 transition-transform flex-shrink-0", isExpanded && "rotate-90")}
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <polyline points="9 18 15 12 9 6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {user.name || '—'}
                          </span>
                        </td>
                        <td style={{ width: colWidths[1] }} className="px-4 py-3 text-sm text-muted-foreground truncate">
                          {user.email || '—'}
                        </td>
                        <td style={{ width: colWidths[2] }} className="px-4 py-3 text-sm text-muted-foreground truncate">
                          {user.phone_number || '—'}
                        </td>
                        <td style={{ width: colWidths[3] }} className="px-4 py-3">
                          <StatusBadge status={user.status} />
                        </td>
                        <td style={{ width: colWidths[4] }} className="px-4 py-3">
                          <MembershipBadge status={user.membership_status} plan={user.membership_plan} />
                        </td>
                        <td style={{ width: colWidths[5] }} className="px-4 py-3 text-sm text-center tabular-nums">
                          {user.hotel_count != null ? (
                            <span className={user.hotel_count > 0 ? 'text-foreground' : 'text-muted-foreground'}>{user.hotel_count}</span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td style={{ width: colWidths[6] }} className="px-4 py-3 text-sm text-center tabular-nums">
                          {user.flight_count != null ? (
                            <span className={user.flight_count > 0 ? 'text-foreground' : 'text-muted-foreground'}>{user.flight_count}</span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td style={{ width: colWidths[7] }} className="px-4 py-3 text-sm text-center tabular-nums">
                          {user.email_count != null ? (
                            <span className={user.email_count > 0 ? 'text-foreground' : 'text-muted-foreground'}>{user.email_count}</span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td style={{ width: colWidths[8] }} className="px-4 py-3 text-sm text-muted-foreground truncate">
                          <span>{formatDate(user.created_at, timezone)}</span>
                          <span className="text-xs text-muted-foreground/60 ml-1.5">({timeAgo(user.created_at)})</span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-border bg-accent/20">
                          <td colSpan={COLUMNS.length} className="p-0">
                            <div className="px-6 py-4">
                              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-3 text-sm">
                                <div>
                                  <div className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-0.5">User ID</div>
                                  <div className="font-mono text-xs text-muted-foreground select-all">{user.id}</div>
                                </div>
                                <div>
                                  <div className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-0.5">Name</div>
                                  <div className="font-medium">{user.name || '—'}</div>
                                </div>
                                <div>
                                  <div className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-0.5">Email</div>
                                  <div className="text-muted-foreground break-all">{user.email || '—'}</div>
                                </div>
                                <div>
                                  <div className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-0.5">Phone</div>
                                  <div className="text-muted-foreground">{user.phone_number || '—'}</div>
                                </div>
                                <div>
                                  <div className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-0.5">Status</div>
                                  <div><StatusBadge status={user.status} /></div>
                                </div>
                                <div>
                                  <div className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-0.5">Membership</div>
                                  <div className="flex flex-col gap-0.5">
                                    <MembershipBadge status={user.membership_status} plan={user.membership_plan} />
                                    {user.membership_status && (
                                      <span className="text-[11px] text-muted-foreground/60">Status: {user.membership_status}</span>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-0.5">Activity</div>
                                  <div className="flex items-center gap-3 text-muted-foreground text-xs">
                                    <span className={user.hotel_count ? 'text-foreground' : ''}>{user.hotel_count ?? 0} hotels</span>
                                    <span className="text-muted-foreground/30">·</span>
                                    <span className={user.flight_count ? 'text-foreground' : ''}>{user.flight_count ?? 0} flights</span>
                                    <span className="text-muted-foreground/30">·</span>
                                    <span className={user.email_count ? 'text-foreground' : ''}>{user.email_count ?? 0} emails</span>
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-0.5">Created</div>
                                  <div className="text-muted-foreground">
                                    {formatDate(user.created_at, timezone)}
                                    <span className="text-xs text-muted-foreground/60 ml-1">({timeAgo(user.created_at)})</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border/50">
                                <button
                                  onClick={(e) => { e.stopPropagation(); window.open(`/users-list/${user.id}`, '_blank'); }}
                                  className="px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors inline-flex items-center gap-1.5"
                                >
                                  Open Full Profile
                                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" strokeLinecap="round" strokeLinejoin="round" />
                                    <polyline points="15 3 21 3 21 9" strokeLinecap="round" strokeLinejoin="round" />
                                    <line x1="10" y1="14" x2="21" y2="3" strokeLinecap="round" />
                                  </svg>
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setExpandedUserId(null); }}
                                  className="px-4 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  Collapse
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {!error && !loading && users.length > 0 && (
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Page size:</span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="bg-background border border-border rounded px-2 py-1 text-sm"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Page {page + 1}
              {totalCount > 0 ? ` of ${!scanComplete ? '~' : ''}${Math.ceil(totalCount / pageSize)}` : ''}
              {totalCount > 0 ? ` · ${!scanComplete ? '~' : ''}${totalCount.toLocaleString()} ${(statusFilter || membershipFilter !== 'all') ? 'matching' : 'total'}` : ''}
            </span>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 text-sm bg-accent/50 rounded-lg font-medium hover:bg-accent disabled:opacity-30 transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * pageSize >= totalCount}
              className="px-3 py-1 text-sm bg-accent/50 rounded-lg font-medium hover:bg-accent disabled:opacity-30 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
