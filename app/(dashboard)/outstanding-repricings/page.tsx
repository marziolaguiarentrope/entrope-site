'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { cn, fromMinorUnits, exportCSV, exportJSON } from '@/lib/utils';
import { api, HotelOpportunity, BookingEnrichment, UserEnrichedInfo } from '@/lib/api';

// ── Types ────────────────────────────────────────────────

type SortKey = 'user_name' | 'hotel' | 'check_in' | 'original_price' | 'new_price' | 'savings_amount' | 'savings_pct' | 'user_type' | 'offer_sent' | 'contacted';
type SortDir = 'asc' | 'desc';
type UserTypeFilter = 'all' | 'paid' | 'free';
type ContactedFilter = 'all' | 'contacted' | 'not_contacted';
type DateFilter = 'all' | 'today' | 'week' | 'month';

interface RepricingRow {
  id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  user_phone: string | null;
  first_name: string | null;
  subscription_status: string | null;
  hotel_name: string | null;
  location: string | null;
  check_in: string | null;
  check_out: string | null;
  room_type: string | null;
  original_price_amount: number | null;
  original_price_currency: string | null;
  new_price_amount: number | null;
  new_price_currency: string | null;
  savings_amount: number | null;
  savings_pct: number | null;
  offer_sent_date: string;
  status: string;
  contacted: boolean;
}

interface ColumnDef {
  id: string;
  label: string;
  sortKey?: SortKey;
  minWidth: number;
  defaultWidth: number;
}

const COLUMNS: ColumnDef[] = [
  { id: 'user', label: 'User', sortKey: 'user_name', minWidth: 120, defaultWidth: 150 },
  { id: 'hotel', label: 'Hotel', sortKey: 'hotel', minWidth: 120, defaultWidth: 180 },
  { id: 'location', label: 'Location', minWidth: 80, defaultWidth: 110 },
  { id: 'check_in', label: 'Check-in', sortKey: 'check_in', minWidth: 80, defaultWidth: 95 },
  { id: 'original_price', label: 'Original', sortKey: 'original_price', minWidth: 80, defaultWidth: 95 },
  { id: 'new_price', label: 'New Price', sortKey: 'new_price', minWidth: 80, defaultWidth: 95 },
  { id: 'savings', label: 'Savings', sortKey: 'savings_amount', minWidth: 90, defaultWidth: 115 },
  { id: 'user_type', label: 'Type', sortKey: 'user_type', minWidth: 60, defaultWidth: 70 },
  { id: 'offer_sent', label: 'Sent', sortKey: 'offer_sent', minWidth: 70, defaultWidth: 85 },
  { id: 'contacted', label: 'Contacted', sortKey: 'contacted', minWidth: 80, defaultWidth: 95 },
];

const PAGE_SIZES = [25, 50, 100];
const CONTACTED_STORAGE_KEY = 'outstanding-repricings-contacted';

// ── Helpers ──────────────────────────────────────────────

function timeAgo(dateString: string): string {
  const now = new Date();
  const normalized = dateString.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateString) ? dateString : dateString + 'Z';
  const date = new Date(normalized);
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
  const cur = currency || 'USD';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: cur,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(fromMinorUnits(amount, cur));
}

function formatMoneyPrecise(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const cur = currency || 'USD';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: cur,
  }).format(fromMinorUnits(amount, cur));
}

function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return '—';
  const normalized = dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00';
  const date = new Date(normalized);
  if (isNaN(date.getTime())) return dateStr;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function formatDateFull(dateStr: string | null): string {
  if (!dateStr) return '—';
  const normalized = dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00';
  const date = new Date(normalized);
  if (isNaN(date.getTime())) return dateStr;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function isToday(dateStr: string): boolean {
  const normalized = dateStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr) ? dateStr : dateStr + 'Z';
  const date = new Date(normalized);
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function isWithinDays(dateStr: string, days: number): boolean {
  const normalized = dateStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr) ? dateStr : dateStr + 'Z';
  const date = new Date(normalized);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

// ── Contacted State ─────────────────────────────────────

function loadContactedSet(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = localStorage.getItem(CONTACTED_STORAGE_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch { /* ignore */ }
  return new Set();
}

function saveContactedSet(set: Set<string>): void {
  try {
    localStorage.setItem(CONTACTED_STORAGE_KEY, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

// ── Notification Text ───────────────────────────────────

function generateNotificationText(row: RepricingRow): string {
  const name = row.first_name || 'there';
  const savingsStr = row.savings_amount != null && row.original_price_currency
    ? formatMoneyPrecise(row.savings_amount, row.original_price_currency)
    : 'a great saving';
  const destination = row.location || row.hotel_name || 'your upcoming trip';

  return `Hey ${name}! You have a ${savingsStr} saving on your hotel in ${destination}. Head to your Axel dashboard to claim it!`;
}

// ── Sort Logic ──────────────────────────────────────────

function sortRows(rows: RepricingRow[], key: SortKey, dir: SortDir): RepricingRow[] {
  return [...rows].sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;

    switch (key) {
      case 'user_name':
        aVal = (a.user_name || '').toLowerCase();
        bVal = (b.user_name || '').toLowerCase();
        break;
      case 'hotel':
        aVal = (a.hotel_name || '').toLowerCase();
        bVal = (b.hotel_name || '').toLowerCase();
        break;
      case 'check_in':
        aVal = a.check_in ? new Date(a.check_in + 'T00:00:00').getTime() : Infinity;
        bVal = b.check_in ? new Date(b.check_in + 'T00:00:00').getTime() : Infinity;
        break;
      case 'original_price':
        aVal = a.original_price_amount ?? 0;
        bVal = b.original_price_amount ?? 0;
        break;
      case 'new_price':
        aVal = a.new_price_amount ?? 0;
        bVal = b.new_price_amount ?? 0;
        break;
      case 'savings_amount':
        aVal = a.savings_amount ?? 0;
        bVal = b.savings_amount ?? 0;
        break;
      case 'savings_pct':
        aVal = a.savings_pct ?? 0;
        bVal = b.savings_pct ?? 0;
        break;
      case 'user_type':
        aVal = a.subscription_status === 'PAYING' ? 0 : 1;
        bVal = b.subscription_status === 'PAYING' ? 0 : 1;
        break;
      case 'offer_sent':
        aVal = new Date(a.offer_sent_date).getTime();
        bVal = new Date(b.offer_sent_date).getTime();
        break;
      case 'contacted':
        aVal = a.contacted ? 1 : 0;
        bVal = b.contacted ? 1 : 0;
        break;
      default:
        return 0;
    }

    if (aVal < bVal) return dir === 'asc' ? -1 : 1;
    if (aVal > bVal) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ── Search Logic ────────────────────────────────────────

function matchesSearch(row: RepricingRow, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return !!(
    row.user_name?.toLowerCase().includes(q) ||
    row.user_email?.toLowerCase().includes(q) ||
    row.hotel_name?.toLowerCase().includes(q) ||
    row.location?.toLowerCase().includes(q) ||
    row.user_phone?.toLowerCase().includes(q)
  );
}

// ── Sub-Components ──────────────────────────────────────

function UserTypeBadge({ status }: { status: string | null }) {
  const isPaid = status === 'PAYING';
  return (
    <span className={cn(
      'px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap',
      isPaid
        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
        : 'bg-zinc-500/10 text-zinc-500 border border-zinc-500/20'
    )}>
      {isPaid ? 'Paid' : 'Free'}
    </span>
  );
}

function ContactedBadge({ contacted }: { contacted: boolean }) {
  return (
    <span className={cn(
      'px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap',
      contacted
        ? 'bg-green-500/20 text-green-400'
        : 'bg-yellow-500/20 text-yellow-400'
    )}>
      {contacted ? 'Contacted' : 'Pending'}
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
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap', colors[status] || 'bg-zinc-500/20 text-zinc-400')}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={cn(
        'shrink-0 transition-colors rounded',
        label
          ? 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20'
          : 'p-1 hover:bg-accent text-muted-foreground hover:text-foreground',
      )}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
    >
      {copied ? (
        <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth={2} />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth={2} />
        </svg>
      )}
      {label && <span>{copied ? 'Copied!' : label}</span>}
    </button>
  );
}

function Shimmer({ className }: { className?: string }) {
  return (
    <span className={cn('inline-block bg-muted-foreground/15 rounded animate-pulse', className || 'h-3.5 w-16')} />
  );
}

// ── Resizable Header ────────────────────────────────────

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
        {column.sortKey && !isActive && (
          <span className="ml-1 opacity-0 group-hover:opacity-40 transition-opacity">↕</span>
        )}
        {isActive && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </div>
      <div
        onMouseDown={handleMouseDown}
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 group-hover:bg-border/50 transition-colors"
      />
    </th>
  );
}

// ── Filter Tab ──────────────────────────────────────────

function FilterTab<T extends string>({
  value,
  current,
  label,
  count,
  onChange,
}: {
  value: T;
  current: T;
  label: string;
  count?: number;
  onChange: (v: T) => void;
}) {
  const active = value === current;
  return (
    <button
      onClick={() => onChange(value)}
      className={cn(
        'px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-accent/50 text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {label}
      {count !== undefined && (
        <span className={cn('ml-1.5', active ? 'opacity-80' : 'opacity-60')}>{count}</span>
      )}
    </button>
  );
}

// ── Main Component ──────────────────────────────────────

export default function OutstandingRepricingsPage() {
  // Data
  const [rows, setRows] = useState<RepricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [userTypeFilter, setUserTypeFilter] = useState<UserTypeFilter>('all');
  const [contactedFilter, setContactedFilter] = useState<ContactedFilter>('all');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('savings_amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  // Contacted
  const [contactedSet, setContactedSet] = useState<Set<string>>(() => loadContactedSet());

  // Expanded row
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // Column widths
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    () => Object.fromEntries(COLUMNS.map(c => [c.id, c.defaultWidth]))
  );

  // Refresh timer
  const refreshRef = useRef<NodeJS.Timeout | null>(null);

  // Search debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // Reset page on filter change
  useEffect(() => { setPage(0); }, [debouncedSearch, dateFilter, userTypeFilter, contactedFilter]);

  // ── Data Fetching ───────────────────────────────────────

  const fetchData = useCallback(async () => {
    setError(null);
    setLoading(true);
    setElapsed(0);

    const elapsedInterval = setInterval(() => setElapsed(e => e + 1), 1000);

    try {
      // Step 1: Get all active hotel opportunities
      const oppResponse = await api.listHotelOpportunitiesActive({ limit: 500 });
      const opportunities = oppResponse.opportunities;

      if (opportunities.length === 0) {
        setRows([]);
        setLoading(false);
        clearInterval(elapsedInterval);
        return;
      }

      // Show table immediately with what we have
      const contactedNow = loadContactedSet();
      setContactedSet(contactedNow);

      const stubRows: RepricingRow[] = opportunities.map(opp => ({
        id: opp.id,
        user_id: opp.user_id,
        user_name: null,
        user_email: null,
        user_phone: null,
        first_name: null,
        subscription_status: null,
        hotel_name: opp.hotel_name,
        location: null,
        check_in: opp.check_in,
        check_out: opp.check_out,
        room_type: null,
        original_price_amount: null,
        original_price_currency: null,
        new_price_amount: opp.payment_amount,
        new_price_currency: opp.payment_currency,
        savings_amount: null,
        savings_pct: null,
        offer_sent_date: opp.created_at,
        status: opp.status,
        contacted: contactedNow.has(opp.id),
      }));

      setRows(stubRows);
      setLoading(false);
      clearInterval(elapsedInterval);

      // Step 2: Enrich with user info + booking data
      setEnriching(true);
      const userIds = [...new Set(opportunities.map(o => o.user_id).filter(Boolean))];
      const { userInfoMap, bookingEnrichmentMap } = await api.batchEnrichWithSubscription(userIds);

      const enrichedRows: RepricingRow[] = opportunities.map(opp => {
        const user = userInfoMap.get(opp.user_id);
        const be = opp.old_booking_id ? bookingEnrichmentMap.get(opp.old_booking_id) : undefined;

        const originalAmount = be?.total_price?.amount ?? null;
        const originalCurrency = be?.total_price?.currency ?? null;
        const newAmount = opp.payment_amount;
        const newCurrency = opp.payment_currency;

        let savingsAmount: number | null = null;
        let savingsPct: number | null = null;
        if (originalAmount && newAmount && originalCurrency === (newCurrency || 'USD')) {
          const diff = originalAmount - newAmount;
          if (diff > 0) {
            savingsAmount = diff;
            savingsPct = (diff / originalAmount) * 100;
          }
        }

        return {
          id: opp.id,
          user_id: opp.user_id,
          user_name: user?.name ?? null,
          user_email: user?.email ?? null,
          user_phone: user?.phone ?? null,
          first_name: user?.first_name ?? null,
          subscription_status: user?.subscription_status ?? null,
          hotel_name: opp.hotel_name || be?.hotel_name || null,
          location: be?.hotel_city ?? null,
          check_in: opp.check_in || be?.check_in || null,
          check_out: opp.check_out || be?.check_out || null,
          room_type: be?.room_type ?? null,
          original_price_amount: originalAmount,
          original_price_currency: originalCurrency,
          new_price_amount: newAmount,
          new_price_currency: newCurrency,
          savings_amount: savingsAmount,
          savings_pct: savingsPct,
          offer_sent_date: opp.created_at,
          status: opp.status,
          contacted: contactedNow.has(opp.id),
        };
      });

      setRows(enrichedRows);
      setEnriching(false);
    } catch (err) {
      clearInterval(elapsedInterval);
      setError(err instanceof Error ? err.message : 'Failed to load repricings');
      setLoading(false);
      setEnriching(false);
    }
  }, []);

  // Initial fetch + auto-refresh
  useEffect(() => {
    fetchData();
    refreshRef.current = setInterval(() => {
      if (!expandedRowId) fetchData();
    }, 60_000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [fetchData, expandedRowId]);

  // ── Contacted Toggle ────────────────────────────────────

  function toggleContacted(opportunityId: string) {
    setContactedSet(prev => {
      const next = new Set(prev);
      if (next.has(opportunityId)) next.delete(opportunityId);
      else next.add(opportunityId);
      saveContactedSet(next);
      return next;
    });

    setRows(prev => prev.map(r =>
      r.id === opportunityId ? { ...r, contacted: !r.contacted } : r
    ));
  }

  // ── Sort Handler ────────────────────────────────────────

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'savings_amount' || key === 'offer_sent' ? 'desc' : 'asc');
    }
  }

  // ── Column Resize ─────────────────────────────────────

  function handleResize(id: string, width: number) {
    setColumnWidths(prev => ({ ...prev, [id]: width }));
  }

  // ── Filter + Sort + Paginate Pipeline ─────────────────

  const filtered = useMemo(() => {
    let result = rows;

    // Date filter
    if (dateFilter === 'today') result = result.filter(r => isToday(r.offer_sent_date));
    else if (dateFilter === 'week') result = result.filter(r => isWithinDays(r.offer_sent_date, 7));
    else if (dateFilter === 'month') result = result.filter(r => isWithinDays(r.offer_sent_date, 30));

    // User type
    if (userTypeFilter === 'paid') result = result.filter(r => r.subscription_status === 'PAYING');
    else if (userTypeFilter === 'free') result = result.filter(r => r.subscription_status !== 'PAYING');

    // Contacted
    if (contactedFilter === 'contacted') result = result.filter(r => r.contacted);
    else if (contactedFilter === 'not_contacted') result = result.filter(r => !r.contacted);

    // Search
    if (debouncedSearch) result = result.filter(r => matchesSearch(r, debouncedSearch));

    return result;
  }, [rows, dateFilter, userTypeFilter, contactedFilter, debouncedSearch]);

  const sorted = useMemo(() => sortRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paginated = sorted.slice(page * pageSize, (page + 1) * pageSize);

  // Stats
  const totalSavings = filtered.reduce((sum, r) => sum + (r.savings_amount ?? 0), 0);
  const contactedCount = filtered.filter(r => r.contacted).length;
  const pendingCount = filtered.length - contactedCount;

  // ── Export ─────────────────────────────────────────────

  function handleExport(format: 'csv' | 'json') {
    const data = sorted.map(r => ({
      user_name: r.user_name || '',
      user_email: r.user_email || '',
      user_phone: r.user_phone || '',
      user_type: r.subscription_status === 'PAYING' ? 'Paid' : 'Free',
      hotel: r.hotel_name || '',
      location: r.location || '',
      check_in: r.check_in || '',
      check_out: r.check_out || '',
      original_price: r.original_price_amount != null ? fromMinorUnits(r.original_price_amount, r.original_price_currency || 'USD') : '',
      new_price: r.new_price_amount != null ? fromMinorUnits(r.new_price_amount, r.new_price_currency || 'USD') : '',
      savings: r.savings_amount != null ? fromMinorUnits(r.savings_amount, r.original_price_currency || 'USD') : '',
      savings_pct: r.savings_pct != null ? `${r.savings_pct.toFixed(1)}%` : '',
      currency: r.original_price_currency || r.new_price_currency || '',
      offer_sent: r.offer_sent_date,
      status: r.status,
      contacted: r.contacted ? 'Yes' : 'No',
      notification_text: generateNotificationText(r),
    }));

    const ts = new Date().toISOString().slice(0, 10);
    if (format === 'csv') exportCSV(data, `outstanding-repricings-${ts}.csv`);
    else exportJSON(data, `outstanding-repricings-${ts}.json`);
  }

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="p-6 max-w-[1600px]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Outstanding Repricings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Active hotel repricing opportunities awaiting user action
        </p>
      </div>

      {/* Stats Bar */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center gap-4 mb-4 text-sm">
          <span className="text-foreground font-medium">{filtered.length} outstanding</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-green-400">{contactedCount} contacted</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-yellow-400">{pendingCount} pending</span>
          {totalSavings > 0 && (
            <>
              <span className="text-muted-foreground ml-2">|</span>
              <span className="text-green-400 font-medium ml-2">
                Total savings: {formatMoney(totalSavings, filtered[0]?.original_price_currency || 'USD')}
              </span>
            </>
          )}
        </div>
      )}

      {/* Filter Row 1: Search + Date + Refresh */}
      <div className="flex items-center gap-3 mb-2">
        <input
          type="text"
          placeholder="Search by name, email, hotel, location..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-md px-3 py-1.5 text-sm bg-card border border-border rounded-md placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
        />

        <div className="flex items-center gap-1">
          <FilterTab<DateFilter> value="all" current={dateFilter} label="All Time" onChange={setDateFilter} />
          <FilterTab<DateFilter> value="today" current={dateFilter} label="Today" onChange={setDateFilter} />
          <FilterTab<DateFilter> value="week" current={dateFilter} label="This Week" onChange={setDateFilter} />
          <FilterTab<DateFilter> value="month" current={dateFilter} label="This Month" onChange={setDateFilter} />
        </div>

        <button
          onClick={fetchData}
          disabled={loading}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Filter Row 2: User Type + Contacted + Export */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1">
          <FilterTab<UserTypeFilter> value="all" current={userTypeFilter} label="All Users" onChange={setUserTypeFilter} />
          <FilterTab<UserTypeFilter> value="paid" current={userTypeFilter} label="Paid" onChange={setUserTypeFilter} />
          <FilterTab<UserTypeFilter> value="free" current={userTypeFilter} label="Free" onChange={setUserTypeFilter} />
        </div>

        <div className="w-px h-5 bg-border" />

        <div className="flex items-center gap-1">
          <FilterTab<ContactedFilter> value="all" current={contactedFilter} label="All" onChange={setContactedFilter} />
          <FilterTab<ContactedFilter> value="not_contacted" current={contactedFilter} label="Pending" onChange={setContactedFilter} />
          <FilterTab<ContactedFilter> value="contacted" current={contactedFilter} label="Contacted" onChange={setContactedFilter} />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => handleExport('csv')}
            className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-accent/50 hover:bg-accent rounded-md transition-colors"
          >
            CSV
          </button>
          <button
            onClick={() => handleExport('json')}
            className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-accent/50 hover:bg-accent rounded-md transition-colors"
          >
            JSON
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchData} className="px-3 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-medium transition-colors">
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <RefreshCw className="size-6 animate-spin mb-3" />
          <p className="text-sm">Loading outstanding repricings...{elapsed > 0 && ` ${elapsed}s`}</p>
          {elapsed >= 10 && (
            <p className="text-xs mt-1 text-muted-foreground/70">Backend may be waking up, hang tight</p>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">No outstanding repricings found</p>
        </div>
      )}

      {/* Filter Empty State */}
      {!loading && rows.length > 0 && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">No repricings match the current filters</p>
          <button
            onClick={() => { setSearch(''); setDateFilter('all'); setUserTypeFilter('all'); setContactedFilter('all'); }}
            className="mt-2 text-xs text-primary hover:underline"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Table */}
      {!loading && paginated.length > 0 && (
        <>
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr className="border-b border-border bg-card">
                    {COLUMNS.map(col => (
                      <ResizableHeader
                        key={col.id}
                        column={col}
                        width={columnWidths[col.id]}
                        onResize={handleResize}
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(row => (
                    <Fragment key={row.id}>
                      <tr
                        onClick={() => setExpandedRowId(expandedRowId === row.id ? null : row.id)}
                        className={cn(
                          'border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer',
                          expandedRowId === row.id && 'bg-accent/30',
                          row.contacted && 'opacity-60',
                        )}
                      >
                        {/* User */}
                        <td className="px-3 py-2.5 text-xs" style={{ width: columnWidths.user }}>
                          {enriching && !row.user_name ? (
                            <Shimmer className="h-3.5 w-20" />
                          ) : (
                            <div className="truncate">
                              <span className="text-foreground font-medium">{row.user_name || '—'}</span>
                            </div>
                          )}
                        </td>

                        {/* Hotel */}
                        <td className="px-3 py-2.5 text-xs truncate" style={{ width: columnWidths.hotel }}>
                          {row.hotel_name || '—'}
                        </td>

                        {/* Location */}
                        <td className="px-3 py-2.5 text-xs text-muted-foreground truncate" style={{ width: columnWidths.location }}>
                          {enriching && !row.location ? <Shimmer className="h-3.5 w-14" /> : (row.location || '—')}
                        </td>

                        {/* Check-in */}
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ width: columnWidths.check_in }}>
                          {formatDateShort(row.check_in)}
                        </td>

                        {/* Original Price */}
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ width: columnWidths.original_price }}>
                          {enriching && row.original_price_amount === null ? (
                            <Shimmer className="h-3.5 w-12" />
                          ) : (
                            <span className="text-muted-foreground line-through">
                              {formatMoney(row.original_price_amount, row.original_price_currency)}
                            </span>
                          )}
                        </td>

                        {/* New Price */}
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap text-green-400" style={{ width: columnWidths.new_price }}>
                          {formatMoney(row.new_price_amount, row.new_price_currency)}
                        </td>

                        {/* Savings */}
                        <td className="px-3 py-2.5 text-xs" style={{ width: columnWidths.savings }}>
                          {enriching && row.savings_amount === null ? (
                            <Shimmer className="h-3.5 w-16" />
                          ) : row.savings_amount != null ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 font-medium">
                              {formatMoney(row.savings_amount, row.original_price_currency)}
                              {row.savings_pct != null && (
                                <span className="text-green-400/60 text-[10px]">
                                  {row.savings_pct.toFixed(0)}%
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>

                        {/* User Type */}
                        <td className="px-3 py-2.5" style={{ width: columnWidths.user_type }}>
                          {enriching && !row.subscription_status ? (
                            <Shimmer className="h-4 w-10" />
                          ) : (
                            <UserTypeBadge status={row.subscription_status} />
                          )}
                        </td>

                        {/* Sent */}
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap" style={{ width: columnWidths.offer_sent }}>
                          {timeAgo(row.offer_sent_date)}
                        </td>

                        {/* Contacted */}
                        <td className="px-3 py-2.5" style={{ width: columnWidths.contacted }}>
                          <ContactedBadge contacted={row.contacted} />
                        </td>
                      </tr>

                      {/* Expanded Detail */}
                      {expandedRowId === row.id && (
                        <tr className="border-b border-border bg-accent/20">
                          <td colSpan={COLUMNS.length} className="p-0">
                            <div className="p-4 space-y-4">
                              {/* Notification Text */}
                              <div className="rounded-lg bg-primary/5 border border-primary/20 p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1">
                                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                                      Notification Text
                                    </p>
                                    <p className="text-sm text-foreground leading-relaxed">
                                      {generateNotificationText(row)}
                                    </p>
                                  </div>
                                  <CopyButton value={generateNotificationText(row)} label="Copy" />
                                </div>
                              </div>

                              {/* Actions Row */}
                              <div className="flex items-center gap-4">
                                {/* Contacted Toggle */}
                                <label
                                  className="flex items-center gap-2 cursor-pointer select-none"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div
                                    onClick={() => toggleContacted(row.id)}
                                    className={cn(
                                      'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                                      row.contacted
                                        ? 'bg-green-500 border-green-500'
                                        : 'border-muted-foreground/40 hover:border-muted-foreground',
                                    )}
                                  >
                                    {row.contacted && (
                                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                      </svg>
                                    )}
                                  </div>
                                  <span className="text-sm text-foreground">
                                    {row.contacted ? 'Contacted' : 'Mark as Contacted'}
                                  </span>
                                </label>

                                <div className="w-px h-5 bg-border" />

                                {/* View Profile */}
                                <Link
                                  href={`/users-list/${row.user_id}`}
                                  target="_blank"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-xs text-primary hover:underline"
                                >
                                  View Full Profile &rarr;
                                </Link>
                              </div>

                              {/* Details Grid */}
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                                <div>
                                  <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Status</span>
                                  <div className="mt-0.5"><StatusBadge status={row.status} /></div>
                                </div>
                                <div>
                                  <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Check-in / Out</span>
                                  <div className="mt-0.5 text-foreground">
                                    {formatDateFull(row.check_in)} — {formatDateFull(row.check_out)}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Room Type</span>
                                  <div className="mt-0.5 text-foreground">{row.room_type || '—'}</div>
                                </div>
                                <div>
                                  <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Email</span>
                                  <div className="mt-0.5 text-foreground flex items-center gap-1">
                                    <span className="truncate">{row.user_email || '—'}</span>
                                    {row.user_email && <CopyButton value={row.user_email} />}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Original Price</span>
                                  <div className="mt-0.5 text-foreground">
                                    {formatMoneyPrecise(row.original_price_amount, row.original_price_currency)}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-[11px] text-muted-foreground uppercase tracking-wide">New Price</span>
                                  <div className="mt-0.5 text-green-400 font-medium">
                                    {formatMoneyPrecise(row.new_price_amount, row.new_price_currency)}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Savings</span>
                                  <div className="mt-0.5 text-green-400 font-medium">
                                    {row.savings_amount != null
                                      ? `${formatMoneyPrecise(row.savings_amount, row.original_price_currency)} (${row.savings_pct?.toFixed(1)}%)`
                                      : '—'}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Phone</span>
                                  <div className="mt-0.5 text-foreground flex items-center gap-1">
                                    <span>{row.user_phone || '—'}</span>
                                    {row.user_phone && <CopyButton value={row.user_phone} />}
                                  </div>
                                </div>
                              </div>

                              {/* Opportunity ID */}
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
                                <span>ID: {row.id.slice(0, 8)}...</span>
                                <CopyButton value={row.id} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                className="bg-card border border-border rounded px-1.5 py-0.5 text-xs"
              >
                {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <span>
                Page {page + 1} of {totalPages} · {sorted.length} result{sorted.length !== 1 ? 's' : ''}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-2.5 py-1 rounded bg-accent/50 hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-2.5 py-1 rounded bg-accent/50 hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Enriching indicator */}
      {enriching && (
        <div className="fixed bottom-4 right-4 bg-card border border-border rounded-lg px-3 py-2 text-xs text-muted-foreground shadow-lg flex items-center gap-2 z-50">
          <RefreshCw className="size-3 animate-spin" />
          Loading user details...
        </div>
      )}
    </div>
  );
}
