'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { cn, formatDate, fromMinorUnits, timeAgo } from '@/lib/utils';
import { api, HotelOpportunity, BookingEnrichment, UserBasicInfo } from '@/lib/api';
import { HotelOpportunityDetail } from '@/components/hotel-opportunity-detail';

// ── Helpers ──────────────────────────────────────────────

function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const cur = currency || 'USD';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: cur,
  }).format(fromMinorUnits(amount, cur));
}

function shortDate(dateStr: string | null): string {
  if (!dateStr) return '?';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}

// ── Types ────────────────────────────────────────────────

type PipelineStage = 'pending_cancel' | 'active' | 'needs_intervention' | 'done';

type EnrichedOpportunity = HotelOpportunity & { stage: PipelineStage };

// Terminal statuses
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'declined', 'expired', 'withdrawn', 'cancelled']);

// ── Pipeline Stage Config ────────────────────────────────

interface StageConfig {
  key: PipelineStage;
  label: string;
  accent: string;       // border/badge color
  bgAccent: string;     // header background
  textAccent: string;   // count badge text
}

const STAGES: StageConfig[] = [
  { key: 'pending_cancel', label: 'Pending Cancel', accent: 'border-red-500/40', bgAccent: 'bg-red-500/10', textAccent: 'text-red-400' },
  { key: 'active', label: 'Active', accent: 'border-blue-500/40', bgAccent: 'bg-blue-500/10', textAccent: 'text-blue-400' },
  { key: 'needs_intervention', label: 'Needs Intervention', accent: 'border-orange-500/40', bgAccent: 'bg-orange-500/10', textAccent: 'text-orange-400' },
  { key: 'done', label: 'Done', accent: 'border-zinc-500/30', bgAccent: 'bg-zinc-500/10', textAccent: 'text-zinc-400' },
];

// ── Search matching ──────────────────────────────────────

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
    opp.id?.toLowerCase().includes(q) ||
    opp.old_booking_id?.toLowerCase().includes(q) ||
    u?.email?.toLowerCase().includes(q) ||
    u?.phone?.toLowerCase().includes(q) ||
    u?.name?.toLowerCase().includes(q) ||
    guestName.toLowerCase().includes(q) ||
    be?.confirmation_code?.toLowerCase().includes(q)
  );
}

// ── Stage Badge ──────────────────────────────────────────

function StageBadge({ stage }: { stage: PipelineStage }) {
  const config = STAGES.find(s => s.key === stage);
  if (!config) return null;
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap', config.bgAccent, config.textAccent)}>
      {config.label}
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
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ── Kanban Card ──────────────────────────────────────────

function KanbanCard({
  opp,
  onClick,
  userInfo,
  bookingEnrichment,
  enriching,
}: {
  opp: EnrichedOpportunity;
  onClick: () => void;
  userInfo?: UserBasicInfo;
  bookingEnrichment?: BookingEnrichment;
  enriching: boolean;
}) {
  const guestName = bookingEnrichment?.guests?.[0] || null;
  const originalPrice = bookingEnrichment?.total_price || null;
  const newPrice = opp.payment_amount;
  const newCurrency = opp.payment_currency;
  const confCode = opp.old_booking_confirmation_code || bookingEnrichment?.confirmation_code;
  const hotelName = bookingEnrichment?.hotel_name || opp.hotel_name || 'Unknown Hotel';

  // Urgency: overdue payment or cancel deadline within 24h
  const now = Date.now();
  const paymentOverdue = opp.payment_due_at && new Date(opp.payment_due_at).getTime() < now && !TERMINAL_STATUSES.has(opp.status);
  const cancelUrgent = opp.cancellation_scheduled_at && (new Date(opp.cancellation_scheduled_at).getTime() - now) < 86400_000 && !TERMINAL_STATUSES.has(opp.status);
  const isUrgent = paymentOverdue || cancelUrgent;
  const isIntervention = opp.status === 'needs_intervention';
  const isDone = opp.stage === 'done';

  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-lg border p-3 cursor-pointer transition-all hover:shadow-md hover:border-foreground/20 space-y-1.5',
        'bg-card',
        isDone && 'opacity-60',
        isUrgent ? 'border-l-[3px] border-l-red-500 border-t-border border-r-border border-b-border'
          : isIntervention ? 'border-l-[3px] border-l-orange-500 border-t-border border-r-border border-b-border'
          : 'border-border',
      )}
    >
      {/* Hotel name */}
      <p className="text-sm font-medium truncate">{hotelName}</p>

      {/* Guest + dates */}
      <p className="text-xs text-muted-foreground truncate">
        {enriching && !bookingEnrichment ? (
          <span className="inline-block bg-muted-foreground/15 rounded animate-pulse h-3 w-20" />
        ) : (
          <>
            {guestName || userInfo?.name || '—'}
            {' · '}
            {shortDate(opp.check_in)} → {shortDate(opp.check_out)}
          </>
        )}
      </p>

      {/* Pricing */}
      <div className="flex items-center gap-1.5 text-xs">
        {originalPrice ? (
          <span className={cn(newPrice ? 'line-through text-muted-foreground' : 'font-mono')}>
            {formatMoney(originalPrice.amount, originalPrice.currency)}
          </span>
        ) : null}
        {newPrice ? (
          <>
            {originalPrice && <span className="text-muted-foreground">→</span>}
            <span className="text-green-400 font-medium font-mono">
              {formatMoney(newPrice, newCurrency)}
            </span>
          </>
        ) : null}
        {!originalPrice && !newPrice && enriching && (
          <span className="inline-block bg-muted-foreground/15 rounded animate-pulse h-3 w-16" />
        )}
      </div>

      {/* Status pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {opp.payment_status && (
          <span className={cn(
            'px-1.5 py-0.5 text-[10px] rounded font-medium',
            ['paid', 'collected', 'card_saved'].includes(opp.payment_status) ? 'bg-green-500/15 text-green-400'
              : ['pending', 'awaiting_card'].includes(opp.payment_status) ? 'bg-yellow-500/15 text-yellow-400'
              : opp.payment_status === 'overdue' ? 'bg-red-500/15 text-red-400'
              : 'bg-zinc-500/15 text-zinc-400',
          )}>
            {opp.payment_status.replace(/_/g, ' ')}
          </span>
        )}
        {opp.cancellation_capability && (
          <span className={cn(
            'px-1.5 py-0.5 text-[10px] rounded font-medium',
            opp.cancellation_capability === 'we_cancel' ? 'bg-green-500/15 text-green-400' : 'bg-yellow-500/15 text-yellow-400',
          )}>
            {opp.cancellation_capability === 'we_cancel' ? 'we cancel' : 'they cancel'}
          </span>
        )}
        {opp.old_booking_status && (opp.stage === 'pending_cancel' || opp.stage === 'active') && (
          <span className={cn(
            'px-1.5 py-0.5 text-[10px] rounded font-medium',
            opp.old_booking_status === 'active' ? 'bg-yellow-500/15 text-yellow-400' : 'bg-green-500/15 text-green-400',
          )}>
            booking {opp.old_booking_status}
          </span>
        )}
        {isDone && (
          <StatusBadge status={opp.status} />
        )}
      </div>

      {/* Outstanding offer: newer unapproved price drop for same booking */}
      {opp.outstanding_offer && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-purple-500/10 border border-purple-500/20">
          <span className="text-[10px] font-medium text-purple-400">
            New drop: {formatMoney(opp.outstanding_offer.savings_amount, opp.outstanding_offer.target_price_currency)} savings
          </span>
          <span className="text-[10px] text-purple-400/60">
            · {timeAgo(opp.outstanding_offer.created_at)}
          </span>
        </div>
      )}

      {/* Footer: conf code + time */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
        <span className="font-mono truncate max-w-[120px]">{confCode || '—'}</span>
        <span className="shrink-0 ml-2">{timeAgo(opp.created_at)}</span>
      </div>
    </div>
  );
}

// ── Kanban Column ────────────────────────────────────────

function KanbanColumn({
  config,
  opportunities,
  collapsed,
  onToggle,
  onCardClick,
  userInfoMap,
  bookingEnrichmentMap,
  enriching,
}: {
  config: StageConfig;
  opportunities: EnrichedOpportunity[];
  collapsed: boolean;
  onToggle: () => void;
  onCardClick: (opp: EnrichedOpportunity) => void;
  userInfoMap: Map<string, UserBasicInfo>;
  bookingEnrichmentMap: Map<string, BookingEnrichment>;
  enriching: boolean;
}) {
  const count = opportunities.length;

  if (collapsed) {
    return (
      <div
        onClick={onToggle}
        className={cn(
          'flex-shrink-0 w-12 rounded-lg border cursor-pointer transition-colors hover:bg-accent/50 flex flex-col items-center py-3 gap-2',
          config.accent,
          config.bgAccent,
        )}
        title={`${config.label} (${count}) — click to expand`}
      >
        <span className={cn('text-sm font-bold', config.textAccent)}>{count}</span>
        <span className={cn('text-[10px] font-medium [writing-mode:vertical-rl] [text-orientation:mixed]', config.textAccent)}>
          {config.label}
        </span>
      </div>
    );
  }

  return (
    <div className={cn('flex-shrink-0 w-72 flex flex-col rounded-lg border', config.accent)}>
      {/* Column header */}
      <div
        className={cn('px-3 py-2.5 rounded-t-lg flex items-center justify-between cursor-pointer', config.bgAccent)}
        onClick={config.key === 'done' ? onToggle : undefined}
      >
        <div className="flex items-center gap-2 min-w-0">
          <h3 className={cn('text-sm font-semibold truncate', config.textAccent)}>
            {config.label}
          </h3>
          <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded-full', config.bgAccent, config.textAccent)}>
            {count}
          </span>
        </div>
        {config.key === 'done' && (
          <button className="text-xs text-muted-foreground hover:text-foreground">collapse</button>
        )}
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[calc(100vh-220px)]">
        {count === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No items</p>
        ) : (
          opportunities.map(opp => (
            <KanbanCard
              key={opp.id}
              opp={opp}
              onClick={() => onCardClick(opp)}
              userInfo={userInfoMap.get(opp.user_id)}
              bookingEnrichment={opp.old_booking_id ? bookingEnrichmentMap.get(opp.old_booking_id) : undefined}
              enriching={enriching}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Search Results Table ─────────────────────────────────

function SearchResultsTable({
  results,
  userInfoMap,
  bookingEnrichmentMap,
  enriching,
  onRowClick,
}: {
  results: EnrichedOpportunity[];
  userInfoMap: Map<string, UserBasicInfo>;
  bookingEnrichmentMap: Map<string, BookingEnrichment>;
  enriching: boolean;
  onRowClick: (opp: EnrichedOpportunity) => void;
}) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {results.length === 0 ? (
        <p className="text-center text-muted-foreground py-8 text-sm">No results match your search</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border bg-accent/30">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Stage</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Status</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Hotel</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Guest</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Account</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Check-In / Out</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Conf Code</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Original</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">New Price</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">Created</th>
              </tr>
            </thead>
            <tbody>
              {results.map(opp => {
                const u = userInfoMap.get(opp.user_id);
                const be = opp.old_booking_id ? bookingEnrichmentMap.get(opp.old_booking_id) : undefined;
                const guestName = be?.guests?.[0] || null;
                const originalPrice = be?.total_price || null;

                return (
                  <tr
                    key={opp.id}
                    onClick={() => onRowClick(opp)}
                    className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer"
                  >
                    <td className="px-3 py-2.5"><StageBadge stage={opp.stage} /></td>
                    <td className="px-3 py-2.5"><StatusBadge status={opp.status} /></td>
                    <td className="px-3 py-2.5 text-sm truncate max-w-[200px]">{opp.hotel_name || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground truncate max-w-[140px]">
                      {enriching && !be ? <span className="inline-block bg-muted-foreground/15 rounded animate-pulse h-3 w-20" /> : guestName || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-sm">
                      {enriching && !u ? <span className="inline-block bg-muted-foreground/15 rounded animate-pulse h-3 w-20" /> : u?.name ? (
                        <Link
                          href={`/users-list/${opp.user_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-primary hover:underline truncate block max-w-[140px]"
                        >
                          {u.name}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                      {formatDate(opp.check_in)} – {formatDate(opp.check_out)}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {opp.old_booking_confirmation_code || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap text-right">
                      {enriching && !be ? <span className="inline-block bg-muted-foreground/15 rounded animate-pulse h-3 w-14" /> : originalPrice
                        ? <span className={cn(opp.payment_amount ? 'line-through text-muted-foreground' : 'font-mono')}>{formatMoney(originalPrice.amount, originalPrice.currency)}</span>
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono whitespace-nowrap text-right">
                      {opp.payment_amount ? (
                        <span className="text-green-400 font-medium">{formatMoney(opp.payment_amount, opp.payment_currency)}</span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(opp.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────

export default function HotelRepricingTrackingPage() {
  const [search, setSearch] = useState('');

  // Data
  const [opportunities, setOpportunities] = useState<EnrichedOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Enrichment
  const [userInfoMap, setUserInfoMap] = useState<Map<string, UserBasicInfo>>(new Map());
  const [bookingEnrichmentMap, setBookingEnrichmentMap] = useState<Map<string, BookingEnrichment>>(new Map());
  const [enriching, setEnriching] = useState(false);

  // Detail panel
  const [selectedOpportunity, setSelectedOpportunity] = useState<EnrichedOpportunity | null>(null);

  // Pending payment count (shown as info stat, not a column — not actionable by operators)
  const [pendingPaymentCount, setPendingPaymentCount] = useState(0);

  // Done column collapsed
  const [doneCollapsed, setDoneCollapsed] = useState(true);

  // Auto-refresh
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);

  // Fetch data. `silent` skips the loading spinner (used for auto-refresh).
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    try {
      // Fetch all endpoints in parallel
      const [paymentRes, cancelRes, activeRes, completedRes] = await Promise.allSettled([
        api.listHotelOpportunitiesPendingPayment({ limit: 100 }),
        api.listHotelOpportunitiesPendingCancel({ limit: 100 }),
        api.listHotelOpportunitiesActive({ limit: 100 }),
        api.listHotelOpportunitiesCompleted({ limit: 100 }),
      ]);

      const paymentOpps = paymentRes.status === 'fulfilled' ? paymentRes.value.opportunities : [];
      const cancelOpps = cancelRes.status === 'fulfilled' ? cancelRes.value.opportunities : [];
      const activeOpps = activeRes.status === 'fulfilled' ? activeRes.value.opportunities : [];
      const completedOpps = completedRes.status === 'fulfilled' ? completedRes.value.opportunities : [];

      setPendingPaymentCount(paymentOpps.length);
      const cancelIds = new Set(cancelOpps.map(o => o.id));

      function classify(o: HotelOpportunity): PipelineStage {
        if (cancelIds.has(o.id)) return 'pending_cancel';
        if (TERMINAL_STATUSES.has(o.status)) return 'done';
        if (o.status === 'needs_intervention') return 'needs_intervention';
        // If old booking still needs cancelling, route to pending_cancel
        // so ops can see and act on it even if the backend endpoint didn't return it
        if (o.old_booking_status && o.old_booking_status !== 'cancelled') return 'pending_cancel';
        // pending_payment items are not actionable by operators — group with active
        return 'active';
      }

      // Deduplicate: active endpoint returns everything non-terminal
      const seen = new Set<string>();
      const all: EnrichedOpportunity[] = [];

      for (const o of activeOpps) {
        if (!seen.has(o.id)) { seen.add(o.id); all.push({ ...o, stage: classify(o) }); }
      }
      for (const o of completedOpps) {
        if (!seen.has(o.id)) { seen.add(o.id); all.push({ ...o, stage: 'done' }); }
      }

      setOpportunities(all);

      // Background enrichment
      const userIds = all.map(o => o.user_id);
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
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 30s (silent — no loading flash). Paused while detail panel open or searching.
  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (!selectedOpportunity && !search) {
      refreshTimer.current = setInterval(() => fetchData(true), 30_000);
    }
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [fetchData, selectedOpportunity, search]);

  // Group by stage
  const stageGroups = useMemo(() => {
    const groups: Record<PipelineStage, EnrichedOpportunity[]> = {
      pending_cancel: [],
      active: [],
      needs_intervention: [],
      done: [],
    };
    for (const opp of opportunities) {
      groups[opp.stage].push(opp);
    }
    // Sort each column
    // Pending cancel: nearest check-in first
    groups.pending_cancel.sort((a, b) => {
      const aT = a.check_in ? new Date(a.check_in + 'T00:00:00').getTime() : Infinity;
      const bT = b.check_in ? new Date(b.check_in + 'T00:00:00').getTime() : Infinity;
      return aT - bT;
    });
    groups.active.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    groups.needs_intervention.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    groups.done.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return groups;
  }, [opportunities]);

  // Search results
  const searchResults = useMemo(() => {
    if (!search) return [];
    return opportunities.filter(o => matchesSearch(o, search, userInfoMap, bookingEnrichmentMap));
  }, [opportunities, search, userInfoMap, bookingEnrichmentMap]);

  const isSearchMode = search.length > 0;

  // Variant for detail panel
  function getVariant(opp: EnrichedOpportunity): 'payment' | 'cancel' | 'active' {
    if (opp.stage === 'pending_cancel') return 'cancel';
    return 'active';
  }

  const totalActive = opportunities.filter(o => o.stage !== 'done').length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Hotel Repricings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {totalActive} active repricing{totalActive !== 1 ? 's' : ''} across the pipeline
            {pendingPaymentCount > 0 && (
              <span className="ml-2 text-yellow-400/70">· {pendingPaymentCount} awaiting payment</span>
            )}
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

      {/* Search */}
      <div className="mb-4 relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by hotel, guest, account, conf code, email, phone, ID..."
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
      {loading && opportunities.length === 0 && !error && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Loading hotel repricings...
        </div>
      )}

      {/* Search Results */}
      {isSearchMode && !loading && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-muted-foreground">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for &quot;{search}&quot;
            </p>
          </div>
          <SearchResultsTable
            results={searchResults}
            userInfoMap={userInfoMap}
            bookingEnrichmentMap={bookingEnrichmentMap}
            enriching={enriching}
            onRowClick={(opp) => setSelectedOpportunity(opp)}
          />
        </div>
      )}

      {/* Kanban Board */}
      {!isSearchMode && !loading && !error && (
        <div className="flex-1 flex gap-3 overflow-x-auto pb-2">
          {STAGES.map(config => (
            <KanbanColumn
              key={config.key}
              config={config}
              opportunities={stageGroups[config.key]}
              collapsed={config.key === 'done' && doneCollapsed}
              onToggle={() => { if (config.key === 'done') setDoneCollapsed(prev => !prev); }}
              onCardClick={(opp) => setSelectedOpportunity(opp)}
              userInfoMap={userInfoMap}
              bookingEnrichmentMap={bookingEnrichmentMap}
              enriching={enriching}
            />
          ))}
        </div>
      )}

      {/* Truncation warning */}
      {!loading && opportunities.length >= 100 && (
        <div className="mt-2 text-xs text-yellow-400">
          Results may be truncated — showing first 100 per category.
        </div>
      )}

      {/* Detail Panel */}
      {selectedOpportunity && (
        <HotelOpportunityDetail
          opportunity={selectedOpportunity}
          bookingEnrichment={selectedOpportunity.old_booking_id ? bookingEnrichmentMap.get(selectedOpportunity.old_booking_id) : undefined}
          userInfo={userInfoMap.get(selectedOpportunity.user_id)}
          variant={getVariant(selectedOpportunity)}
          onClose={() => setSelectedOpportunity(null)}
          onUpdate={(updated) => {
            setOpportunities(prev => prev.map(o => o.id === updated.id ? { ...updated, stage: o.stage } : o));
            setSelectedOpportunity({ ...updated, stage: selectedOpportunity.stage });
          }}
        />
      )}
    </div>
  );
}
