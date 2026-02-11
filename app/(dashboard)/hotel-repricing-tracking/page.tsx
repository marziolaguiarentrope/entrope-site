'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { cn, formatDate } from '@/lib/utils';
import { api, HotelOpportunity, BookingEnrichment, UserBasicInfo } from '@/lib/api';
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

function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(amount / 100);
}

// ── Types ────────────────────────────────────────────────

type TabFilter = 'all' | 'current' | 'past';
type OpportunityType = 'pending_payment' | 'pending_cancel' | 'completed';
type SortKey = 'payment_due' | 'hotel' | 'check_in' | 'created' | 'original_price' | 'new_price' | 'savings' | 'account_name' | 'status';
type SortDir = 'asc' | 'desc';

type EnrichedOpportunity = HotelOpportunity & { opp_type: OpportunityType };

// ── Column definitions ───────────────────────────────────

interface ColumnDef {
  id: string;
  label: string;
  sortKey?: SortKey;
  minWidth: number;
  defaultWidth: number;
}

const COLUMNS: ColumnDef[] = [
  { id: 'status', label: 'Status', sortKey: 'status', minWidth: 80, defaultWidth: 110 },
  { id: 'payment_due', label: 'Payment Due', sortKey: 'payment_due', minWidth: 90, defaultWidth: 110 },
  { id: 'account_name', label: 'Account', sortKey: 'account_name', minWidth: 100, defaultWidth: 150 },
  { id: 'guest_name', label: 'Reservation Name', minWidth: 100, defaultWidth: 140 },
  { id: 'hotel', label: 'Hotel', sortKey: 'hotel', minWidth: 120, defaultWidth: 200 },
  { id: 'check_in_out', label: 'Check-In / Out', sortKey: 'check_in', minWidth: 140, defaultWidth: 170 },
  { id: 'conf_code', label: 'Conf Code', minWidth: 100, defaultWidth: 130 },
  { id: 'original_price', label: 'Original Price', sortKey: 'original_price', minWidth: 90, defaultWidth: 110 },
  { id: 'new_price', label: 'New Price', sortKey: 'new_price', minWidth: 90, defaultWidth: 110 },
  { id: 'savings', label: 'Savings', sortKey: 'savings', minWidth: 80, defaultWidth: 100 },
  { id: 'type', label: 'Type', minWidth: 70, defaultWidth: 90 },
  { id: 'created', label: 'Created', sortKey: 'created', minWidth: 70, defaultWidth: 90 },
];

// ── Sort Logic ───────────────────────────────────────────

function sortOpportunities(
  opps: EnrichedOpportunity[],
  key: SortKey,
  dir: SortDir,
  userInfoMap: Map<string, UserBasicInfo>,
  bookingEnrichmentMap: Map<string, BookingEnrichment>,
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
      case 'original_price': {
        const aBe = a.old_booking_id ? bookingEnrichmentMap.get(a.old_booking_id) : undefined;
        const bBe = b.old_booking_id ? bookingEnrichmentMap.get(b.old_booking_id) : undefined;
        aVal = aBe?.total_price?.amount ?? 0;
        bVal = bBe?.total_price?.amount ?? 0;
        break;
      }
      case 'new_price':
        aVal = a.payment_amount ?? 0;
        bVal = b.payment_amount ?? 0;
        break;
      case 'savings': {
        const aBe2 = a.old_booking_id ? bookingEnrichmentMap.get(a.old_booking_id) : undefined;
        const bBe2 = b.old_booking_id ? bookingEnrichmentMap.get(b.old_booking_id) : undefined;
        const aOrig = aBe2?.total_price?.amount ?? 0;
        const bOrig = bBe2?.total_price?.amount ?? 0;
        aVal = aOrig && a.payment_amount ? aOrig - a.payment_amount : 0;
        bVal = bOrig && b.payment_amount ? bOrig - b.payment_amount : 0;
        break;
      }
      case 'account_name':
        aVal = (userInfoMap.get(a.user_id)?.name || '').toLowerCase();
        bVal = (userInfoMap.get(b.user_id)?.name || '').toLowerCase();
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
  bookingEnrichmentMap: Map<string, BookingEnrichment>,
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const u = userInfoMap.get(opp.user_id);
  const be = opp.old_booking_id ? bookingEnrichmentMap.get(opp.old_booking_id) : undefined;
  const guestName = be?.guests?.[0] || '';

  return !!(
    opp.hotel_name?.toLowerCase().includes(q) ||
    opp.old_booking_confirmation_code?.toLowerCase().includes(q) ||
    opp.status?.toLowerCase().includes(q) ||
    u?.email?.toLowerCase().includes(q) ||
    u?.phone?.toLowerCase().includes(q) ||
    u?.name?.toLowerCase().includes(q) ||
    guestName.toLowerCase().includes(q) ||
    be?.confirmation_code?.toLowerCase().includes(q)
  );
}

// ── StatusBadge ──────────────────────────────────────────

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
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function TypeBadge({ type }: { type: OpportunityType }) {
  if (type === 'pending_payment') return <span className="px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded font-medium whitespace-nowrap">Payment</span>;
  if (type === 'pending_cancel') return <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded font-medium whitespace-nowrap">Cancel</span>;
  return <span className="px-2 py-0.5 text-xs bg-zinc-500/20 text-zinc-400 rounded font-medium whitespace-nowrap">Completed</span>;
}

// ── Resizable Header ─────────────────────────────────────

function ResizableHeader({
  column,
  width,
  onResize,
  sortKey: currentSortKey,
  sortDir,
  onSort,
}: {
  column: ColumnDef;
  width: number;
  onResize: (id: string, width: number) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = column.sortKey === currentSortKey;
  const startX = useRef(0);
  const startW = useRef(0);

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    startW.current = width;

    function handleMouseMove(ev: MouseEvent) {
      const delta = ev.clientX - startX.current;
      const newWidth = Math.max(column.minWidth, startW.current + delta);
      onResize(column.id, newWidth);
    }

    function handleMouseUp() {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }

  return (
    <th
      className="relative text-left text-xs font-medium text-muted-foreground select-none whitespace-nowrap group"
      style={{ width, minWidth: column.minWidth }}
    >
      <div
        className={cn(
          'px-3 py-2',
          column.sortKey && 'cursor-pointer hover:text-foreground',
        )}
        onClick={() => column.sortKey && onSort(column.sortKey)}
      >
        {column.label}
        {isActive && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </div>
      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 group-hover:bg-border/50 transition-colors"
      />
    </th>
  );
}

// ── Loading Shimmer ──────────────────────────────────────

function Shimmer({ className }: { className?: string }) {
  return (
    <span className={cn('inline-block bg-muted-foreground/15 rounded animate-pulse', className || 'h-3.5 w-16')} />
  );
}

// ── Table Row ────────────────────────────────────────────

function OpportunityRow({
  opp,
  onClick,
  userInfo,
  bookingEnrichment,
  columnWidths,
  enriching,
}: {
  opp: EnrichedOpportunity;
  onClick: () => void;
  userInfo?: UserBasicInfo;
  bookingEnrichment?: BookingEnrichment;
  columnWidths: Record<string, number>;
  enriching: boolean;
}) {
  const guestName = bookingEnrichment?.guests?.[0] || null;
  const originalPrice = bookingEnrichment?.total_price || null;
  const newPrice = opp.payment_amount;
  const newCurrency = opp.payment_currency;

  // Calculate savings (only when same currency)
  let savingsAmount: number | null = null;
  let savingsCurrency: string | null = null;
  if (originalPrice && newPrice && originalPrice.currency === (newCurrency || 'USD')) {
    const diff = originalPrice.amount - newPrice;
    if (diff > 0) {
      savingsAmount = diff;
      savingsCurrency = originalPrice.currency;
    }
  }

  // Axel conf code: the old_booking_confirmation_code is the hotel's code
  const confCode = opp.old_booking_confirmation_code;

  return (
    <tr onClick={onClick} className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer">
      {/* Status */}
      <td className="px-3 py-3" style={{ width: columnWidths.status }}>
        <StatusBadge status={opp.status} />
      </td>
      {/* Payment Due */}
      <td className="px-3 py-3 text-xs whitespace-nowrap" style={{ width: columnWidths.payment_due }}>
        {opp.payment_due_at ? (
          <span className={cn(
            new Date(opp.payment_due_at) < new Date() && opp.status !== 'completed' && 'text-red-400 font-medium',
          )}>
            {formatDate(opp.payment_due_at)}
          </span>
        ) : '—'}
      </td>
      {/* Account Name (linked) */}
      <td className="px-3 py-3 text-sm" style={{ width: columnWidths.account_name }}>
        {enriching && !userInfo ? <Shimmer className="h-3.5 w-20" /> : userInfo?.name ? (
          <Link
            href={`/users-list/${opp.user_id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-primary hover:underline truncate block max-w-full"
          >
            {userInfo.name}
          </Link>
        ) : (
          <span className="text-muted-foreground truncate block">—</span>
        )}
      </td>
      {/* Reservation Name (guest name) */}
      <td className="px-3 py-3 text-xs text-muted-foreground truncate" style={{ width: columnWidths.guest_name }}>
        {enriching && !bookingEnrichment ? <Shimmer className="h-3 w-24" /> : guestName || '—'}
      </td>
      {/* Hotel */}
      <td className="px-3 py-3 text-sm truncate" style={{ width: columnWidths.hotel }}>
        {opp.hotel_name || '—'}
      </td>
      {/* Check-In / Out */}
      <td className="px-3 py-3 text-xs whitespace-nowrap" style={{ width: columnWidths.check_in_out }}>
        {formatDate(opp.check_in)} – {formatDate(opp.check_out)}
      </td>
      {/* Conf Code */}
      <td className="px-3 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap" style={{ width: columnWidths.conf_code }}>
        {confCode || '—'}
      </td>
      {/* Original Price */}
      <td className="px-3 py-3 text-xs whitespace-nowrap text-right" style={{ width: columnWidths.original_price }}>
        {enriching && !bookingEnrichment ? <Shimmer className="h-3 w-14" /> : originalPrice ? (
          <span className={cn(newPrice ? 'line-through text-muted-foreground' : 'font-mono')}>
            {formatMoney(originalPrice.amount, originalPrice.currency)}
          </span>
        ) : '—'}
      </td>
      {/* New Price */}
      <td className="px-3 py-3 text-xs font-mono whitespace-nowrap text-right" style={{ width: columnWidths.new_price }}>
        {newPrice ? (
          <span className="text-green-400 font-medium">
            {formatMoney(newPrice, newCurrency)}
          </span>
        ) : '—'}
      </td>
      {/* Savings */}
      <td className="px-3 py-3 text-xs whitespace-nowrap text-right" style={{ width: columnWidths.savings }}>
        {enriching && !bookingEnrichment ? <Shimmer className="h-3 w-12" /> : savingsAmount ? (
          <span className="text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded font-medium">
            {formatMoney(savingsAmount, savingsCurrency)}
          </span>
        ) : '—'}
      </td>
      {/* Type */}
      <td className="px-3 py-3" style={{ width: columnWidths.type }}>
        <TypeBadge type={opp.opp_type} />
      </td>
      {/* Created */}
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap" style={{ width: columnWidths.created }}>
        {timeAgo(opp.created_at)}
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
  const [bookingEnrichmentMap, setBookingEnrichmentMap] = useState<Map<string, BookingEnrichment>>(new Map());
  const [enriching, setEnriching] = useState(false);

  // Detail panel
  const [selectedOpportunity, setSelectedOpportunity] = useState<EnrichedOpportunity | null>(null);

  // Column widths (resizable)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const widths: Record<string, number> = {};
    COLUMNS.forEach(c => { widths[c.id] = c.defaultWidth; });
    return widths;
  });

  function handleColumnResize(id: string, width: number) {
    setColumnWidths(prev => ({ ...prev, [id]: width }));
  }

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
          if (tab === 'past') {
            setOpportunities([]);
            setLoading(false);
            return;
          }
        }
      }

      setOpportunities(opps);

      // Non-blocking enrichment — single batch call extracts both user info + booking data
      const userIds = opps.map(o => o.user_id);
      setEnriching(true);
      api.batchEnrichFromMembers(userIds)
        .then(({ userInfoMap: uMap, bookingEnrichmentMap: bMap }) => {
          setUserInfoMap(uMap);
          setBookingEnrichmentMap(bMap);
        })
        .catch(() => {})
        .finally(() => setEnriching(false));
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
    () => paymentFiltered.filter(o => matchesSearch(o, search, userInfoMap, bookingEnrichmentMap)),
    [paymentFiltered, search, userInfoMap, bookingEnrichmentMap]
  );
  const sorted = useMemo(
    () => sortOpportunities(searched, sortKey, sortDir, userInfoMap, bookingEnrichmentMap),
    [searched, sortKey, sortDir, userInfoMap, bookingEnrichmentMap]
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
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>

        {/* Search */}
        <div className="flex-1 max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search hotel, name, conf code..."
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
            <table className="w-full" style={{ tableLayout: 'fixed' }}>
              <thead className="border-b border-border bg-accent/30">
                <tr>
                  {COLUMNS.map(col => (
                    <ResizableHeader
                      key={col.id}
                      column={col}
                      width={columnWidths[col.id]}
                      onResize={handleColumnResize}
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(opp => (
                  <OpportunityRow
                    key={opp.id}
                    opp={opp}
                    onClick={() => setSelectedOpportunity(opp)}
                    userInfo={userInfoMap.get(opp.user_id)}
                    bookingEnrichment={opp.old_booking_id ? bookingEnrichmentMap.get(opp.old_booking_id) : undefined}
                    columnWidths={columnWidths}
                    enriching={enriching}
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
          bookingEnrichment={selectedOpportunity.old_booking_id ? bookingEnrichmentMap.get(selectedOpportunity.old_booking_id) : undefined}
          userInfo={userInfoMap.get(selectedOpportunity.user_id)}
          variant={selectedOpportunity.opp_type === 'pending_payment' ? 'payment' : 'cancel'}
          onClose={() => setSelectedOpportunity(null)}
          onUpdate={(updated) => {
            setOpportunities(prev => prev.map(o => o.id === updated.id ? { ...updated, opp_type: o.opp_type } : o));
            setSelectedOpportunity({ ...updated, opp_type: selectedOpportunity.opp_type });
          }}
        />
      )}
    </div>
  );
}
