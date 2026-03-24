'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { cn, fromMinorUnits, parseLocalDate, timeAgo } from '@/lib/utils';
import { api, HotelBookingListItem, HotelCheckoutSession, UserBasicInfo } from '@/lib/api';
import { HotelBookingDetail } from '@/components/hotel-booking-detail';

// ── Helpers ──────────────────────────────────────────────

function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const cur = currency || 'USD';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: cur,
  }).format(fromMinorUnits(amount, cur));
}

function nightsBetween(checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  const a = parseLocalDate(checkIn);
  const b = parseLocalDate(checkOut);
  const diff = Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : null;
}

function formatDateRange(checkIn: string | null, checkOut: string | null): string {
  if (!checkIn) return '—';
  const a = parseLocalDate(checkIn);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const start = a.toLocaleDateString('en-US', opts);
  if (!checkOut) return start;
  const b = parseLocalDate(checkOut);
  const end = b.toLocaleDateString('en-US', opts);
  const nights = nightsBetween(checkIn, checkOut);
  return `${start} – ${end}${nights ? ` (${nights}n)` : ''}`;
}

function primaryGuestName(guests: { name: string; is_primary: boolean }[]): string {
  if (!guests || guests.length === 0) return '—';
  const primary = guests.find(g => g.is_primary);
  return primary?.name || guests[0]?.name || '—';
}

function isCheckInUrgent(checkIn: string | null): boolean {
  if (!checkIn) return false;
  const d = parseLocalDate(checkIn);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  return diffMs > 0 && diffMs < 48 * 60 * 60 * 1000;
}

function derivePaymentType(cancellationPolicy: string | null): { label: string; className: string } {
  if (!cancellationPolicy) return { label: 'Unknown', className: 'bg-zinc-500/20 text-zinc-400' };
  const lower = cancellationPolicy.toLowerCase();
  if (lower.includes('free cancellation') || lower.includes('refundable')) {
    return { label: 'Pay Later', className: 'bg-green-500/20 text-green-400' };
  }
  if (lower.includes('non-refundable') || lower.includes('prepaid')) {
    return { label: 'Prepaid', className: 'bg-blue-500/20 text-blue-400' };
  }
  return { label: 'Unknown', className: 'bg-zinc-500/20 text-zinc-400' };
}

// ── Status Badge ─────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    confirmed: 'bg-green-500/20 text-green-400',
    in_progress: 'bg-blue-500/20 text-blue-400',
    pending: 'bg-yellow-500/20 text-yellow-400',
    cancelled: 'bg-red-500/20 text-red-400',
    completed: 'bg-zinc-500/20 text-zinc-400',
    accepted: 'bg-green-500/20 text-green-400',
    active: 'bg-blue-500/20 text-blue-400',
    expired: 'bg-zinc-500/20 text-zinc-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap', colors[status] || 'bg-zinc-500/20 text-zinc-400')}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ── Types ────────────────────────────────────────────────

type ViewFilter = 'all' | 'upcoming' | 'active' | 'past' | 'cancelled';

interface ViewFilterConfig {
  key: ViewFilter;
  label: string;
}

const VIEW_FILTERS: ViewFilterConfig[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'active', label: 'Active' },
  { key: 'past', label: 'Past' },
  { key: 'cancelled', label: 'Cancelled' },
];

type SessionTab = 'accepted' | 'payment' | 'guests' | 'all';

const SESSION_TABS: { key: SessionTab; label: string }[] = [
  { key: 'accepted', label: 'Accepted' },
  { key: 'payment', label: 'At Payment' },
  { key: 'guests', label: 'At Guests' },
  { key: 'all', label: 'All Sessions' },
];

type SortField = 'check_in_date' | 'created_at' | 'customer_price_amount' | 'hotel_name';
type SortDir = 'asc' | 'desc';

// ── Checkout Sessions Section ────────────────────────────

function CheckoutSessionsSection() {
  const [tab, setTab] = useState<SessionTab>('accepted');
  const [sessions, setSessions] = useState<HotelCheckoutSession[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userInfoMap, setUserInfoMap] = useState<Map<string, UserBasicInfo>>(new Map());
  const [enriching, setEnriching] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Parameters<typeof api.listHotelCheckoutSessions>[0] = { limit: 100 };
      if (tab === 'accepted') params.accepted_only = true;
      else if (tab === 'payment') params.checkout_step = 'payment';
      else if (tab === 'guests') params.checkout_step = 'guests';

      const res = await api.listHotelCheckoutSessions(params);
      setSessions(res.sessions);
      setTotalCount(res.total_count);

      const userIds = [...new Set(res.sessions.map(s => s.user_id).filter(Boolean))];
      if (userIds.length > 0) {
        setEnriching(true);
        api.batchGetUserBasicInfo(userIds)
          .then(map => setUserInfoMap(map))
          .catch(() => {})
          .finally(() => setEnriching(false));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch checkout sessions';
      if (msg.includes('404')) {
        setError('Checkout sessions endpoint not yet available. Pending ENG-17424 deployment.');
      } else {
        setError(msg);
      }
      setSessions([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold">Checkout Sessions</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Bookings from the hotel_book_now flow — prepaid and pay-later reservations
          </p>
        </div>
        {!error && (
          <span className="text-xs text-muted-foreground">{totalCount} sessions</span>
        )}
      </div>

      {/* Tab filters */}
      <div className="flex items-center gap-1 mb-3">
        {SESSION_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
              tab === t.key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Graceful 404 */}
      {error && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p className="text-yellow-400 text-sm">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && !error && (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
          Loading checkout sessions...
        </div>
      )}

      {/* Empty */}
      {!loading && !error && sessions.length === 0 && (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
          No checkout sessions found.
        </div>
      )}

      {/* Table */}
      {!error && sessions.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-accent/30">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Status</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Hotel</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Room Type</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Dates</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Price</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Payment Type</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Step</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Account</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Accepted</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(session => {
                  const u = userInfoMap.get(session.user_id);
                  const urgent = isCheckInUrgent(session.check_in) && session.status !== 'expired';
                  const notBooked = session.accepted_at && !session.booking_id;
                  const payment = derivePaymentType(session.cancellation_policy);

                  return (
                    <tr
                      key={session.id}
                      className={cn(
                        'border-b border-border last:border-0 hover:bg-accent/50 transition-colors',
                        urgent && 'border-l-[3px] border-l-orange-500',
                      )}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={session.status} />
                          {notBooked && (
                            <span className="px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap bg-red-500/20 text-red-400">
                              NOT BOOKED
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 max-w-[200px]">
                        <p className="text-sm font-medium truncate">{session.hotel_name || '—'}</p>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground truncate max-w-[140px]">
                        {session.room_type || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                        {formatDateRange(session.check_in, session.check_out)}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-mono whitespace-nowrap text-right">
                        {formatMoney(session.price_amount, session.price_currency)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn('px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap', payment.className)}>
                          {payment.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap capitalize">
                        {session.checkout_step || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-sm">
                        {enriching && !u ? (
                          <span className="inline-block bg-muted-foreground/15 rounded animate-pulse h-3 w-20" />
                        ) : u?.name ? (
                          <Link
                            href={`/users-list/${session.user_id}`}
                            className="text-primary hover:underline truncate block max-w-[140px]"
                          >
                            {u.name}
                          </Link>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {session.accepted_at ? timeAgo(session.accepted_at) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────

export default function HotelBookingsPage() {
  // Filters
  const [view, setView] = useState<ViewFilter>('upcoming');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('check_in_date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  // Data
  const [bookings, setBookings] = useState<HotelBookingListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Enrichment
  const [userInfoMap, setUserInfoMap] = useState<Map<string, UserBasicInfo>>(new Map());
  const [enriching, setEnriching] = useState(false);

  // Detail panel
  const [selectedBooking, setSelectedBooking] = useState<HotelBookingListItem | null>(null);

  // Summary stats
  const [stats, setStats] = useState<{ total: number; upcoming: number; active: number }>({
    total: 0,
    upcoming: 0,
    active: 0,
  });

  // Auto-refresh timer
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Build API params from current state
  const apiParams = useMemo(() => {
    const params: {
      offset: number;
      limit: number;
      status?: string;
      check_in_after?: string;
      check_in_before?: string;
      sort_by?: string;
      sort_dir?: string;
      q?: string;
    } = {
      offset: page * pageSize,
      limit: pageSize,
      sort_by: sortBy,
      sort_dir: sortDir,
    };

    const today = new Date().toISOString().split('T')[0];

    switch (view) {
      case 'upcoming':
        params.status = 'confirmed';
        params.check_in_after = today;
        params.sort_by = 'check_in_date';
        params.sort_dir = 'asc';
        break;
      case 'active':
        params.status = 'in_progress';
        break;
      case 'past':
        params.status = 'completed';
        break;
      case 'cancelled':
        params.status = 'cancelled';
        break;
    }

    if (debouncedSearch) {
      params.q = debouncedSearch;
    }

    return params;
  }, [view, debouncedSearch, sortBy, sortDir, page, pageSize]);

  // Fetch data
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    try {
      const res = await api.listHotelBookings(apiParams);
      setBookings(res.bookings);
      setTotalCount(res.total_count);

      const userIds = [...new Set(res.bookings.map(b => b.user_id).filter(Boolean))];
      if (userIds.length > 0) {
        setEnriching(true);
        api.batchGetUserBasicInfo(userIds)
          .then(map => setUserInfoMap(map))
          .catch(() => {})
          .finally(() => setEnriching(false));
      }
    } catch (err) {
      if (!silent) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch hotel bookings';
        if (msg.includes('404')) {
          setError('Hotel bookings endpoint not yet available. The backend endpoint is pending deployment — check FAC ticket for status.');
        } else {
          setError(msg);
        }
      }
      if (!silent) {
        setBookings([]);
        setTotalCount(0);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiParams]);

  // Fetch summary stats (independent of current view)
  const fetchStats = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const [allRes, upcomingRes, activeRes] = await Promise.allSettled([
        api.listHotelBookings({ limit: 1 }),
        api.listHotelBookings({ status: 'confirmed', check_in_after: today, limit: 1 }),
        api.listHotelBookings({ status: 'in_progress', limit: 1 }),
      ]);
      setStats({
        total: allRes.status === 'fulfilled' ? allRes.value.total_count : 0,
        upcoming: upcomingRes.status === 'fulfilled' ? upcomingRes.value.total_count : 0,
        active: activeRes.status === 'fulfilled' ? activeRes.value.total_count : 0,
      });
    } catch {
      // Ignore stats errors
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Auto-refresh every 30s (silent). Paused while detail panel open or searching.
  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (!selectedBooking && !debouncedSearch) {
      refreshTimer.current = setInterval(() => {
        fetchData(true);
        fetchStats();
      }, 30_000);
    }
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [fetchData, fetchStats, selectedBooking, debouncedSearch]);

  // Pagination
  const totalPages = Math.ceil(totalCount / pageSize);

  // Column sort handler
  function handleSort(field: SortField) {
    if (view === 'upcoming') return;
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir(field === 'check_in_date' ? 'asc' : 'desc');
    }
    setPage(0);
  }

  function SortIndicator({ field }: { field: SortField }) {
    if (view === 'upcoming') return null;
    if (sortBy !== field) return <span className="text-muted-foreground/30 ml-1">↕</span>;
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Hotel Bookings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {stats.total} total · {stats.upcoming} upcoming · {stats.active} active
          </p>
        </div>
        <button
          onClick={() => fetchData()}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-muted-foreground rounded-lg hover:bg-accent transition-colors disabled:opacity-50 shrink-0"
          title="Refresh"
        >
          {loading ? 'Loading...' : '↻ Refresh'}
        </button>
      </div>

      {/* ── Checkout Sessions (hotel_book_now pipeline) ── */}
      <CheckoutSessionsSection />

      {/* ── Confirmed Bookings ── */}
      <h2 className="text-lg font-semibold mb-3">Confirmed Bookings</h2>

      {/* View filter tabs */}
      <div className="flex items-center gap-1 mb-3">
        {VIEW_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => { setView(f.key); setPage(0); }}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
              view === f.key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4 relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by hotel, guest, conf code, ETG order ID, provider..."
          className="w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary pl-10"
        />
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" strokeWidth={2} />
          <path strokeLinecap="round" strokeWidth={2} d="m21 21-4.35-4.35" />
        </svg>
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-sm"
          >
            Clear
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={() => fetchData()} className="mt-2 px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && bookings.length === 0 && !error && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Loading hotel bookings...
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && bookings.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          No hotel bookings found{debouncedSearch ? ` for "${debouncedSearch}"` : ''}.
        </div>
      )}

      {/* Table */}
      {bookings.length > 0 && (
        <div className="flex-1 bg-card border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-accent/30">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Status</th>
                  <th
                    className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap cursor-pointer hover:text-foreground"
                    onClick={() => handleSort('hotel_name')}
                  >
                    Hotel <SortIndicator field="hotel_name" />
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Guest</th>
                  <th
                    className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap cursor-pointer hover:text-foreground"
                    onClick={() => handleSort('check_in_date')}
                  >
                    Check-in / out <SortIndicator field="check_in_date" />
                  </th>
                  <th
                    className="text-right text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap cursor-pointer hover:text-foreground"
                    onClick={() => handleSort('customer_price_amount')}
                  >
                    Price <SortIndicator field="customer_price_amount" />
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Conf Code</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Provider</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Account</th>
                  <th
                    className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap cursor-pointer hover:text-foreground"
                    onClick={() => handleSort('created_at')}
                  >
                    Created <SortIndicator field="created_at" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {bookings.map(booking => {
                  const u = userInfoMap.get(booking.user_id);
                  const urgent = isCheckInUrgent(booking.check_in_date) && booking.status !== 'cancelled' && booking.status !== 'completed';

                  return (
                    <tr
                      key={booking.id}
                      onClick={() => setSelectedBooking(booking)}
                      className={cn(
                        'border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer',
                        urgent && 'border-l-[3px] border-l-orange-500',
                      )}
                    >
                      <td className="px-3 py-2.5"><StatusBadge status={booking.status} /></td>
                      <td className="px-3 py-2.5 max-w-[200px]">
                        <p className="text-sm font-medium truncate">{booking.hotel_name || '—'}</p>
                        {(booking.city || booking.country) && (
                          <p className="text-xs text-muted-foreground truncate">
                            {[booking.city, booking.country].filter(Boolean).join(', ')}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground truncate max-w-[140px]">
                        {primaryGuestName(booking.guests)}
                      </td>
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                        {formatDateRange(booking.check_in_date, booking.check_out_date)}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-mono whitespace-nowrap text-right">
                        {formatMoney(booking.customer_price_amount, booking.customer_price_currency)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-mono text-muted-foreground truncate block max-w-[120px]">
                          {booking.confirmation_code || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {booking.booking_provider || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-sm">
                        {enriching && !u ? (
                          <span className="inline-block bg-muted-foreground/15 rounded animate-pulse h-3 w-20" />
                        ) : u?.name ? (
                          <Link
                            href={`/users-list/${booking.user_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-primary hover:underline truncate block max-w-[140px]"
                          >
                            {u.name}
                          </Link>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {timeAgo(booking.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <div className="flex items-center gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-muted-foreground rounded-lg hover:bg-accent transition-colors disabled:opacity-30"
            >
              &larr; Previous
            </button>
            <span className="text-xs text-muted-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-muted-foreground rounded-lg hover:bg-accent transition-colors disabled:opacity-30"
            >
              Next &rarr;
            </button>
          </div>
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }}
            className="text-xs bg-background border border-border rounded px-2 py-1"
          >
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>
        </div>
      )}

      {/* Detail Panel */}
      {selectedBooking && (
        <HotelBookingDetail
          booking={selectedBooking}
          userInfo={userInfoMap.get(selectedBooking.user_id)}
          onClose={() => setSelectedBooking(null)}
        />
      )}
    </div>
  );
}
