'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { cn, formatDate } from '@/lib/utils';
import { api, HotelOpportunity, HotelBookingDetail, UserBasicInfo } from '@/lib/api';
import { HotelOpportunityDetail } from '@/components/hotel-opportunity-detail';

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

function formatMoney(amount: number | null, currency: string | null): string {
  if (amount === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(amount / 100);
}

// ── Types ────────────────────────────────────────────────

type TabFilter = 'all' | 'current' | 'past';
type OpportunityType = 'pending_payment' | 'pending_cancel' | 'completed';
type SortKey = 'payment_due' | 'hotel' | 'check_in' | 'created' | 'payment_amount' | 'account_name' | 'payment_status' | 'status';
type SortDir = 'asc' | 'desc';

type EnrichedOpportunity = HotelOpportunity & { opp_type: OpportunityType };

// ── Sort Logic ───────────────────────────────────────────

function sortOpportunities(
  opps: EnrichedOpportunity[],
  key: SortKey,
  dir: SortDir,
  userInfoMap: Map<string, UserBasicInfo>,
): EnrichedOpportunity[] {
  return [...opps].sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;

    switch (key) {
      case 'payment_due':
        aVal = a.payment_due_at ? new Date(a.payment_due_at).getTime() : Infinity;
        bVal = b.payment_due_at ? new Date(b.payment_due_at).getTime() : Infinity;
        break;
      case 'hotel':
        aVal = (a.hotel_name || '').toLowerCase();
        bVal = (b.hotel_name || '').toLowerCase();
        break;
      case 'check_in':
        aVal = a.check_in ? new Date(a.check_in + 'T00:00:00').getTime() : Infinity;
        bVal = b.check_in ? new Date(b.check_in + 'T00:00:00').getTime() : Infinity;
        break;
      case 'created':
        aVal = new Date(a.created_at).getTime();
        bVal = new Date(b.created_at).getTime();
        break;
      case 'payment_amount':
        aVal = a.payment_amount ?? 0;
        bVal = b.payment_amount ?? 0;
        break;
      case 'account_name':
        aVal = (userInfoMap.get(a.user_id)?.name || '').toLowerCase();
        bVal = (userInfoMap.get(b.user_id)?.name || '').toLowerCase();
        break;
      case 'payment_status':
        aVal = a.payment_status || '';
        bVal = b.payment_status || '';
        break;
      case 'status':
        aVal = a.status;
        bVal = b.status;
        break;
      default:
        return 0;
    }

    if (aVal < bVal) return dir === 'asc' ? -1 : 1;
    if (aVal > bVal) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ── Search Logic ─────────────────────────────────────────

function matchesSearch(
  opp: EnrichedOpportunity,
  query: string,
  userInfoMap: Map<string, UserBasicInfo>,
  bookingDetailMap: Map<string, HotelBookingDetail>,
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const u = userInfoMap.get(opp.user_id);
  const bd = opp.old_booking_id ? bookingDetailMap.get(opp.old_booking_id) : undefined;
  const guestName = bd?.guests?.find(g => g.is_primary)?.name || bd?.guests?.[0]?.name || '';

  return !!(
    opp.hotel_name?.toLowerCase().includes(q) ||
    opp.old_booking_confirmation_code?.toLowerCase().includes(q) ||
    opp.status?.toLowerCase().includes(q) ||
    opp.payment_status?.toLowerCase().includes(q) ||
    u?.email?.toLowerCase().includes(q) ||
    u?.phone?.toLowerCase().includes(q) ||
    u?.name?.toLowerCase().includes(q) ||
    guestName.toLowerCase().includes(q) ||
    bd?.room_type?.toLowerCase().includes(q)
  );
}

// ── StatusBadge ──────────────────────────────────────────

function PaymentStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const colors: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    awaiting_card: 'bg-yellow-500/20 text-yellow-400',
    overdue: 'bg-red-500/20 text-red-400',
    paid: 'bg-green-500/20 text-green-400',
    refunded: 'bg-blue-500/20 text-blue-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap', colors[status] || 'bg-zinc-500/20 text-zinc-400')}>
      {status}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-blue-500/20 text-blue-400',
    accepted: 'bg-indigo-500/20 text-indigo-400',
    executing: 'bg-purple-500/20 text-purple-400',
    awaiting_customer: 'bg-yellow-500/20 text-yellow-400',
    completed: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
    needs_intervention: 'bg-orange-500/20 text-orange-400',
    declined: 'bg-zinc-500/20 text-zinc-400',
    expired: 'bg-zinc-500/20 text-zinc-400',
    withdrawn: 'bg-zinc-500/20 text-zinc-400',
    cancelled: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap', colors[status] || 'bg-zinc-500/20 text-zinc-400')}>
      {status}
    </span>
  );
}

function TypeBadge({ type }: { type: OpportunityType }) {
  if (type === 'pending_payment') return <span className="px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded font-medium whitespace-nowrap">Payment</span>;
  if (type === 'pending_cancel') return <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded font-medium whitespace-nowrap">Cancel</span>;
  return <span className="px-2 py-0.5 text-xs bg-zinc-500/20 text-zinc-400 rounded font-medium whitespace-nowrap">Completed</span>;
}

// ── Sort Header ──────────────────────────────────────────

function SortHeader({ label, sortKey, currentKey, dir, onSort }: {
  label: string; sortKey: SortKey; currentKey: SortKey; dir: SortDir;
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

// ── Table Row ────────────────────────────────────────────

function OpportunityRow({
  opp,
  onClick,
  userInfo,
  bookingDetail,
}: {
  opp: EnrichedOpportunity;
  onClick: () => void;
  userInfo?: UserBasicInfo;
  bookingDetail?: HotelBookingDetail;
}) {
  const primaryGuest = bookingDetail?.guests?.find(g => g.is_primary) || bookingDetail?.guests?.[0];

  return (
    <tr onClick={onClick} className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer">
      <td className="px-3 py-3 text-xs whitespace-nowrap">
        {opp.payment_due_at ? formatDate(opp.payment_due_at) : '—'}
      </td>
      <td className="px-3 py-3 text-sm whitespace-nowrap">
        {userInfo?.name || '—'}
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {primaryGuest?.name || '—'}
      </td>
      <td className="px-3 py-3 text-sm max-w-[200px] truncate">
        {opp.hotel_name || '—'}
      </td>
      <td className="px-3 py-3 text-xs whitespace-nowrap">
        {formatDate(opp.check_in)} – {formatDate(opp.check_out)}
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground max-w-[150px] truncate">
        {bookingDetail?.room_type || '—'}
      </td>
      <td className="px-3 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
        {opp.old_booking_confirmation_code || '—'}
      </td>
      <td className="px-3 py-3">
        {userInfo?.email ? (
          <span className="text-xs text-muted-foreground truncate max-w-[180px] inline-block">{userInfo.email}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-3"><PaymentStatusBadge status={opp.payment_status} /></td>
      <td className="px-3 py-3 text-xs font-mono whitespace-nowrap text-right">
        {formatMoney(opp.payment_amount, opp.payment_currency)}
      </td>
      <td className="px-3 py-3"><StatusBadge status={opp.status} /></td>
      <td className="px-3 py-3"><TypeBadge type={opp.opp_type} /></td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {timeAgo(opp.created_at)}
      </td>
      <td className="px-3 py-3">
        <Link
          href={`/users-list/${opp.user_id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-primary hover:underline whitespace-nowrap"
        >
          Profile →
        </Link>
      </td>
    </tr>
  );
}

// ── Main Page ────────────────────────────────────────────

export default function HotelRepricingTrackingPage() {
  // Filters & sorting
  const [tab, setTab] = useState<TabFilter>('current');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('payment_due');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('all');

  // Data
  const [opportunities, setOpportunities] = useState<EnrichedOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState({ payment: 0, cancel: 0, completed: 0 });

  // Enrichment
  const [userInfoMap, setUserInfoMap] = useState<Map<string, UserBasicInfo>>(new Map());
  const [bookingDetailMap, setBookingDetailMap] = useState<Map<string, HotelBookingDetail>>(new Map());

  // Detail panel
  const [selectedOpportunity, setSelectedOpportunity] = useState<EnrichedOpportunity | null>(null);

  // Track locally-cancelled IDs so they stay hidden across auto-refreshes
  const cancelledIdsRef = useRef<Set<string>>(new Set());

  // Auto-refresh
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);

  // Reset sort when switching tabs
  useEffect(() => {
    if (tab === 'current') {
      setSortKey('payment_due');
      setSortDir('asc');
    } else {
      setSortKey('created');
      setSortDir('desc');
    }
    setPaymentStatusFilter('all');
    setSearch('');
    // Clear locally-cancelled tracking on tab switch (fresh data from server)
    cancelledIdsRef.current = new Set();
  }, [tab]);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let opps: EnrichedOpportunity[] = [];

      if (tab === 'current' || tab === 'all') {
        const [paymentRes, cancelRes] = await Promise.all([
          api.listHotelOpportunitiesPendingPayment({ limit: 100 }),
          api.listHotelOpportunitiesPendingCancel({ limit: 100 }),
        ]);
        opps = [
          ...paymentRes.opportunities.map(o => ({ ...o, opp_type: 'pending_payment' as OpportunityType })),
          ...cancelRes.opportunities.map(o => ({ ...o, opp_type: 'pending_cancel' as OpportunityType })),
        ];
        setCounts(prev => ({
          ...prev,
          payment: paymentRes.total,
          cancel: cancelRes.total,
        }));
      }

      if (tab === 'past' || tab === 'all') {
        try {
          const completedRes = await api.listHotelOpportunitiesCompleted({ limit: 100 });
          const completedOpps = completedRes.opportunities.map(o => ({ ...o, opp_type: 'completed' as OpportunityType }));
          opps = tab === 'all' ? [...opps, ...completedOpps] : completedOpps;
          setCounts(prev => ({ ...prev, completed: completedRes.total }));
        } catch {
          // Endpoint may not exist yet (ENG-16263) — silently ignore for past tab
          if (tab === 'past') {
            setOpportunities([]);
            setLoading(false);
            return;
          }
        }
      }

      // Filter out locally-cancelled items so they don't reappear on auto-refresh
      const filtered = cancelledIdsRef.current.size > 0 ? opps.filter(o => !cancelledIdsRef.current.has(o.id)) : opps;
      setOpportunities(filtered);

      // Non-blocking enrichment
      const userIds = filtered.map(o => o.user_id);
      const bookingIds = filtered.map(o => o.old_booking_id).filter(Boolean) as string[];

      api.batchGetUserBasicInfo(userIds).then(setUserInfoMap).catch(() => {});
      api.batchGetHotelBookingDetails(bookingIds).then(setBookingDetailMap).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      setOpportunities([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh for current tab (every 30s)
  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (tab === 'current') {
      refreshTimer.current = setInterval(fetchData, 30_000);
    }
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [tab, fetchData]);

  // Background counts for tabs we're not viewing
  useEffect(() => {
    async function fetchOtherCounts() {
      try {
        if (tab !== 'current') {
          const [paymentRes, cancelRes] = await Promise.all([
            api.listHotelOpportunitiesPendingPayment({ limit: 1 }),
            api.listHotelOpportunitiesPendingCancel({ limit: 1 }),
          ]);
          setCounts(prev => ({ ...prev, payment: paymentRes.total, cancel: cancelRes.total }));
        }
        if (tab !== 'past') {
          try {
            const completedRes = await api.listHotelOpportunitiesCompleted({ limit: 1 });
            setCounts(prev => ({ ...prev, completed: completedRes.total }));
          } catch {
            // Endpoint may not exist yet
          }
        }
      } catch {
        // Silent fail
      }
    }
    fetchOtherCounts();
  }, [tab]);

  // Filter by payment status
  const paymentFiltered = useMemo(() => {
    if (paymentStatusFilter === 'all') return opportunities;
    return opportunities.filter(o => o.payment_status === paymentStatusFilter);
  }, [opportunities, paymentStatusFilter]);

  // Search + sort
  const searched = useMemo(
    () => paymentFiltered.filter(o => matchesSearch(o, search, userInfoMap, bookingDetailMap)),
    [paymentFiltered, search, userInfoMap, bookingDetailMap]
  );
  const sorted = useMemo(
    () => sortOpportunities(searched, sortKey, sortDir, userInfoMap),
    [searched, sortKey, sortDir, userInfoMap]
  );

  // Sort handler
  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'payment_due' || key === 'check_in' ? 'asc' : 'desc');
    }
  }

  // Get unique payment statuses for filter dropdown
  const paymentStatuses = useMemo(() => {
    const set = new Set<string>();
    opportunities.forEach(o => {
      if (o.payment_status) set.add(o.payment_status);
    });
    return [...set].sort();
  }, [opportunities]);

  const currentCount = counts.payment + counts.cancel;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Hotel Repricing Tracking</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track payment status and cancellations for hotel repricings
        </p>
      </div>

      {/* Summary Stats */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
        <span>
          <span className="font-medium text-yellow-400">{counts.payment}</span> pending payment
          <span className="mx-1">·</span>
          <span className="font-medium text-red-400">{counts.cancel}</span> pending cancel
        </span>
        {counts.completed > 0 && (
          <>
            <span className="text-border">|</span>
            <span>
              <span className="font-medium text-green-400">{counts.completed}</span> completed
            </span>
          </>
        )}
      </div>

      {/* Tab Toggle + Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        {/* Tab toggle */}
        <div className="flex gap-1 bg-accent/30 rounded-lg p-1">
          <button
            onClick={() => setTab('current')}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === 'current' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Current {currentCount > 0 && <span className="ml-1 text-xs opacity-70">({currentCount})</span>}
          </button>
          <button
            onClick={() => setTab('past')}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === 'past' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Past {counts.completed > 0 && <span className="ml-1 text-xs opacity-70">({counts.completed})</span>}
          </button>
          <button
            onClick={() => setTab('all')}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            All
          </button>
        </div>

        {/* Payment Status filter */}
        <select
          value={paymentStatusFilter}
          onChange={(e) => setPaymentStatusFilter(e.target.value)}
          className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">All Payment Status</option>
          {paymentStatuses.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Sort controls */}
        <div className="flex items-center gap-1">
          <select
            value={sortKey}
            onChange={(e) => {
              const key = e.target.value as SortKey;
              setSortKey(key);
              setSortDir(key === 'payment_due' || key === 'check_in' ? 'asc' : 'desc');
            }}
            className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="payment_due">Sort: Payment Due</option>
            <option value="hotel">Sort: Hotel</option>
            <option value="check_in">Sort: Check-In</option>
            <option value="created">Sort: Created</option>
            <option value="payment_amount">Sort: Amount</option>
            <option value="account_name">Sort: Account</option>
          </select>
          <button
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-muted-foreground rounded-lg border border-border hover:bg-accent transition-colors"
          >
            {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
          </button>
        </div>

        {/* Search */}
        <div className="flex-1 max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search hotel, name, email, conf code..."
            className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Refresh */}
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
        ) : loading && opportunities.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">Loading hotel repricings...</div>
        ) : tab === 'past' && sorted.length === 0 && !search ? (
          <div className="p-6 text-center text-muted-foreground">
            <p>No historical data available yet.</p>
            <p className="text-xs mt-1 opacity-70">Backend endpoint pending (ENG-16263)</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            {search ? 'No repricings match your search' : 'No hotel repricings found'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-accent/30">
                <tr>
                  <SortHeader label="Payment Due" sortKey="payment_due" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Account Name" sortKey="account_name" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Reservation Name</th>
                  <SortHeader label="Hotel" sortKey="hotel" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Check-In / Out" sortKey="check_in" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Room Type</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Conf Code</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Email</th>
                  <SortHeader label="Pmt Status" sortKey="payment_status" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Amount" sortKey="payment_amount" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Status" sortKey="status" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Type</th>
                  <SortHeader label="Created" sortKey="created" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Profile</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(opp => (
                  <OpportunityRow
                    key={opp.id}
                    opp={opp}
                    onClick={() => setSelectedOpportunity(opp)}
                    userInfo={userInfoMap.get(opp.user_id)}
                    bookingDetail={opp.old_booking_id ? bookingDetailMap.get(opp.old_booking_id) : undefined}
                  />
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
            Showing {sorted.length}{search || paymentStatusFilter !== 'all' ? ` of ${opportunities.length}` : ''} repricings
          </span>
          {opportunities.length >= 100 && (
            <span className="text-yellow-400">
              Results may be truncated — showing first 100 per category.
            </span>
          )}
        </div>
      )}

      {/* Detail Panel */}
      {selectedOpportunity && (
        <HotelOpportunityDetail
          opportunity={selectedOpportunity}
          variant={selectedOpportunity.opp_type === 'pending_payment' ? 'payment' : 'cancel'}
          onClose={() => setSelectedOpportunity(null)}
          onUpdate={(updated) => {
            if (updated.old_booking_status === 'cancelled') {
              // Track this ID so auto-refresh doesn't bring it back
              cancelledIdsRef.current.add(updated.id);
              setOpportunities(prev => prev.filter(o => o.id !== updated.id));
              setSelectedOpportunity(null);
            } else {
              setOpportunities(prev => prev.map(o => o.id === updated.id ? { ...updated, opp_type: o.opp_type } : o));
              setSelectedOpportunity({ ...updated, opp_type: selectedOpportunity.opp_type });
            }
          }}
        />
      )}
    </div>
  );
}
