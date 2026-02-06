'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api, UserListItem, MemberSummary, MemberContext } from '@/lib/api';
import { cn } from '@/lib/utils';
import { MemberDetail } from '@/components/member-detail';

// ── Types ────────────────────────────────────────────────

type SortKey = 'name' | 'email' | 'status' | 'membership' | 'hotels' | 'flights' | 'emails' | 'created_at';
type SortDir = 'asc' | 'desc';

// ── Helpers ──────────────────────────────────────────────

function timeAgo(dateString: string): string {
  if (!dateString) return '—';
  const now = new Date();
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '—';
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 0) return 'just now'; // future dates (timezone edge case)
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

function formatDate(dateString: string): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString; // fallback to raw string
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

const PAGE_SIZES = [25, 50, 100];

// ── Bridge: UserListItem → MemberSummary ─────────────────

function toMemberSummary(user: UserListItem): MemberSummary {
  return {
    id: user.id,
    email: user.email,
    phone_number: user.phone_number,
    name: user.name,
    status: user.status,
    membership_status: user.membership_status,
    membership_plan: user.membership_plan,
    created_at: user.created_at,
    has_active_escalation: false,
    pending_opportunities: 0,
  };
}

function MembershipBadge({ status, plan }: { status: string | null; plan: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;

  // Detect free vs paid plan
  const planLower = (plan || '').toLowerCase();
  const isFree = planLower === 'free' || planLower.includes('free');

  // Color by plan type + status
  let colorClass: string;
  if (isFree) {
    colorClass = 'bg-zinc-500/20 text-zinc-400'; // muted for free
  } else if (status === 'active') {
    colorClass = 'bg-green-500/20 text-green-400'; // green for paid active
  } else if (status === 'cancelled') {
    colorClass = 'bg-red-500/20 text-red-400';
  } else if (status === 'trialing') {
    colorClass = 'bg-blue-500/20 text-blue-400';
  } else {
    colorClass = 'bg-zinc-500/20 text-zinc-400';
  }

  const label = isFree ? 'Free' : (plan || status);

  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium', colorClass)}>
      {label}
    </span>
  );
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
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Sorting — default to newest first
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // MemberDetail integration
  const [selectedMember, setSelectedMember] = useState<MemberSummary | null>(null);
  const [memberContext, setMemberContext] = useState<MemberContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

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

  // Fetch users
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await api.listUsers({
        offset: page * pageSize,
        limit: pageSize,
        q: debouncedSearch || undefined,
      });
      // Backend doesn't support status filter — filter client-side
      const members = statusFilter
        ? result.members.filter(m => m.status === statusFilter)
        : result.members;
      setUsers(members);
      setTotalCount(result.total_count);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load users';
      setError(msg);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedSearch, statusFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Reset page when filters change
  function handleStatusChange(status: string | null) {
    setStatusFilter(status);
    setPage(0);
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size);
    setPage(0);
  }

  // MemberDetail handlers
  async function handleSelectUser(user: UserListItem) {
    const member = toMemberSummary(user);
    setSelectedMember(member);
    setMemberContext(null);
    setContextLoading(true);
    setContextError(null);

    try {
      const context = await api.getMember(user.id);
      setMemberContext(context);
    } catch (err) {
      setContextError(err instanceof Error ? err.message : 'Failed to load member context');
    } finally {
      setContextLoading(false);
    }
  }

  async function handleRefreshContext() {
    if (!selectedMember) return;
    setContextLoading(true);
    setContextError(null);

    try {
      const context = await api.getMember(selectedMember.id);
      setMemberContext(context);
    } catch (err) {
      setContextError(err instanceof Error ? err.message : 'Failed to refresh member context');
    } finally {
      setContextLoading(false);
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

  // Sort handler
  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'created_at' ? 'desc' : 'asc');
    }
  }

  // Sorted users (client-side)
  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'name': {
          const aVal = (a.name || '').toLowerCase();
          const bVal = (b.name || '').toLowerCase();
          return aVal.localeCompare(bVal) * dir;
        }
        case 'email': {
          const aVal = (a.email || '').toLowerCase();
          const bVal = (b.email || '').toLowerCase();
          return aVal.localeCompare(bVal) * dir;
        }
        case 'status': {
          return a.status.localeCompare(b.status) * dir;
        }
        case 'membership': {
          const aVal = (a.membership_status || '').toLowerCase();
          const bVal = (b.membership_status || '').toLowerCase();
          return aVal.localeCompare(bVal) * dir;
        }
        case 'hotels': {
          return ((a.hotel_count ?? 0) - (b.hotel_count ?? 0)) * dir;
        }
        case 'flights': {
          return ((a.flight_count ?? 0) - (b.flight_count ?? 0)) * dir;
        }
        case 'emails': {
          return ((a.email_count ?? 0) - (b.email_count ?? 0)) * dir;
        }
        case 'created_at': {
          const aTime = new Date(a.created_at).getTime();
          const bTime = new Date(b.created_at).getTime();
          return (aTime - bTime) * dir;
        }
        default:
          return 0;
      }
    });
  }, [users, sortKey, sortDir]);

  // Full-page MemberDetail view
  if (selectedMember) {
    return (
      <MemberDetail
        member={selectedMember}
        context={memberContext}
        onClose={() => { setSelectedMember(null); setMemberContext(null); }}
        onRefresh={handleRefreshContext}
        loading={contextLoading}
        error={contextError}
      />
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Users List</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse all users with pagination, filtering, and search
        </p>
      </div>

      {/* Search + Status Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
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
            Loading users...
          </div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            {debouncedSearch || statusFilter
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
                {sortedUsers.map((user) => (
                  <tr
                    key={user.id}
                    onClick={() => handleSelectUser(user)}
                    className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer"
                  >
                    <td style={{ width: colWidths[0] }} className="px-4 py-3 text-sm font-medium truncate">
                      {user.name || '—'}
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
                      <span>{formatDate(user.created_at)}</span>
                      <span className="text-xs text-muted-foreground/60 ml-1.5">({timeAgo(user.created_at)})</span>
                    </td>
                  </tr>
                ))}
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
              Page {page + 1}{totalCount > 0 ? ` of ${Math.ceil(totalCount / pageSize)}` : ''}{totalCount > 0 ? ` · ${totalCount} total` : ''}
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
