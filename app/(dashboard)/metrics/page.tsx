'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { api, UserListItem } from '@/lib/api';
import { cn, exportCSV, exportJSON } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────

type DateRange = '24h' | '7d' | '30d' | '90d' | '6m' | '1y' | 'all' | 'custom';
type Granularity = 'hourly' | 'daily' | 'weekly' | 'monthly';
type ChartMode = 'cumulative' | 'new';
type Timezone = 'UTC' | 'America/New_York' | 'America/Chicago' | 'America/Los_Angeles';

interface ChartDataPoint {
  date: string;       // display label
  dateRaw: string;    // bucket key for sorting
  count: number;      // new users in this bucket
  cumulative: number; // running total
}

// ── Constants ────────────────────────────────────────────

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '6m', label: 'Last 6 months' },
  { value: '1y', label: 'Last year' },
  { value: 'all', label: 'All time' },
];

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const TIMEZONE_OPTIONS: { value: Timezone; label: string }[] = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
];

// ── Chart Color Palette (Robinhood-inspired) ────────────
const CHART_GREEN = '#00C805';
const CHART_GREEN_LIGHT = '#00E608';
const CHART_GREEN_DIM = '#00C80540';
const CHART_GRID = '#1a1f2e';
const CHART_AXIS = '#6b7280';

const STATUS_OPTIONS = [
  { value: null, label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'banned', label: 'Banned' },
  { value: 'deactivated', label: 'Deactivated' },
] as const;

// ── Auto-granularity map for preset ranges ──────────────
const AUTO_GRANULARITY: Partial<Record<DateRange, Granularity>> = {
  '24h': 'hourly',
  '7d': 'daily',
  '30d': 'daily',
  '90d': 'weekly',
  '6m': 'weekly',
  '1y': 'monthly',
  'all': 'monthly',
};

// ── Helpers ──────────────────────────────────────────────

/**
 * US DST check: DST runs from 2nd Sunday in March 2:00 AM to 1st Sunday in November 2:00 AM.
 * Takes UTC year/month(1-indexed)/day/hour and returns whether DST is active.
 */
function isUsDst(utcYear: number, utcMonth: number, utcDay: number, utcHour: number): boolean {
  // Find 2nd Sunday in March (in UTC terms — approximate, DST transitions at local 2 AM)
  // March 1 day-of-week
  const mar1dow = new Date(Date.UTC(utcYear, 2, 1)).getUTCDay(); // 0=Sun
  const mar2ndSun = 1 + ((7 - mar1dow) % 7) + 7; // 2nd Sunday date in March
  // DST starts at March 2nd-Sunday 2:00 AM local = 2:00+stdOffset AM UTC
  // For Eastern (std=-5): March 2ndSun 07:00 UTC
  // We'll just use a simplified approach: check if we're past March 2nd Sunday 10:00 UTC (covers all US zones)

  // Nov 1 day-of-week
  const nov1dow = new Date(Date.UTC(utcYear, 10, 1)).getUTCDay();
  const nov1stSun = 1 + ((7 - nov1dow) % 7); // 1st Sunday date in November

  // Convert to day-of-year for comparison
  const doy = dayOfYear(utcYear, utcMonth, utcDay);
  const dstStartDoy = dayOfYear(utcYear, 3, mar2ndSun);
  const dstEndDoy = dayOfYear(utcYear, 11, nov1stSun);

  if (doy > dstStartDoy && doy < dstEndDoy) return true;
  if (doy < dstStartDoy || doy > dstEndDoy) return false;
  // On the transition days, use hour (approximate — good enough for hourly buckets)
  if (doy === dstStartDoy) return utcHour >= 7; // ~2AM Eastern = 7 UTC (most conservative)
  if (doy === dstEndDoy) return utcHour < 6; // ~2AM Eastern = 6 UTC (DST)
  return false;
}

function dayOfYear(year: number, month: number, day: number): number {
  const daysInMonths = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // Leap year
  if ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) daysInMonths[2] = 29;
  let doy = 0;
  for (let i = 1; i < month; i++) doy += daysInMonths[i];
  return doy + day;
}

/**
 * Get UTC offset in hours for our supported US timezones.
 * Hardcoded to avoid any Intl.DateTimeFormat SSR/browser inconsistencies.
 */
function getUtcOffsetHours(date: Date, tz: Timezone): number {
  if (tz === 'UTC') return 0;
  const dst = isUsDst(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours());
  switch (tz) {
    case 'America/New_York':    return dst ? -4 : -5;
    case 'America/Chicago':     return dst ? -5 : -6;
    case 'America/Los_Angeles': return dst ? -7 : -8;
    default: return 0;
  }
}

/** Extract year/month/day/hour/dayOfWeek in a given timezone */
function getPartsInTz(date: Date, tz: Timezone): { year: number; month: number; day: number; hour: number; dayOfWeek: number } {
  const offsetMs = getUtcOffsetHours(date, tz) * 60 * 60 * 1000;
  const shifted = new Date(date.getTime() + offsetMs);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1, // 1-indexed
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    dayOfWeek: shifted.getUTCDay(),
  };
}

function getDateRange(range: DateRange): { start: Date | null; end: Date } {
  const now = new Date();

  if (range === '24h') {
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { start, end: now };
  }

  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  switch (range) {
    case '7d': {
      const s = new Date(end);
      s.setDate(s.getDate() - 7);
      s.setHours(0, 0, 0, 0);
      return { start: s, end };
    }
    case '30d': {
      const s = new Date(end);
      s.setDate(s.getDate() - 30);
      s.setHours(0, 0, 0, 0);
      return { start: s, end };
    }
    case '90d': {
      const s = new Date(end);
      s.setDate(s.getDate() - 90);
      s.setHours(0, 0, 0, 0);
      return { start: s, end };
    }
    case '6m': {
      const s = new Date(end);
      s.setMonth(s.getMonth() - 6);
      s.setHours(0, 0, 0, 0);
      return { start: s, end };
    }
    case '1y': {
      const s = new Date(end);
      s.setFullYear(s.getFullYear() - 1);
      s.setHours(0, 0, 0, 0);
      return { start: s, end };
    }
    case 'all':
    case 'custom':
      return { start: null, end };
  }
}

function getBucketKey(date: Date, granularity: Granularity, tz: Timezone): string {
  const p = getPartsInTz(date, tz);
  const year = p.year;
  const month = String(p.month).padStart(2, '0');
  const day = String(p.day).padStart(2, '0');
  const hour = String(p.hour).padStart(2, '0');

  switch (granularity) {
    case 'hourly':
      return `${year}-${month}-${day}T${hour}`;
    case 'daily':
      return `${year}-${month}-${day}`;
    case 'weekly': {
      const diff = p.dayOfWeek === 0 ? -6 : 1 - p.dayOfWeek;
      const monday = new Date(date);
      monday.setDate(monday.getDate() + diff);
      const mp = getPartsInTz(monday, tz);
      return `${mp.year}-${String(mp.month).padStart(2, '0')}-${String(mp.day).padStart(2, '0')}`;
    }
    case 'monthly':
      return `${year}-${month}-01`;
  }
}

/** Days in a given month (1-indexed) */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Advance a bucket key by one step, operating purely on the key string.
 * This avoids timezone conversion issues that occur when using Date cursors.
 */
function advanceBucketKey(key: string, granularity: Granularity): string {
  if (granularity === 'hourly') {
    // key = "YYYY-MM-DDThh"
    const [datePart, hourPart] = key.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    let h = parseInt(hourPart) + 1;
    let day = d, month = m, year = y;
    if (h >= 24) {
      h = 0;
      day += 1;
      const dim = daysInMonth(year, month);
      if (day > dim) {
        day = 1;
        month += 1;
        if (month > 12) { month = 1; year += 1; }
      }
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}`;
  }

  // key = "YYYY-MM-DD"
  const [y, m, d] = key.split('-').map(Number);
  let year = y, month = m, day = d;

  switch (granularity) {
    case 'daily':
      day += 1;
      if (day > daysInMonth(year, month)) { day = 1; month += 1; }
      if (month > 12) { month = 1; year += 1; }
      break;
    case 'weekly':
      day += 7;
      while (day > daysInMonth(year, month)) {
        day -= daysInMonth(year, month);
        month += 1;
        if (month > 12) { month = 1; year += 1; }
      }
      break;
    case 'monthly':
      month += 1;
      if (month > 12) { month = 1; year += 1; }
      day = 1;
      break;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatBucketLabel(key: string, granularity: Granularity): string {
  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (granularity === 'hourly') {
    const [datePart, hourPart] = key.split('T');
    const [, m, d] = datePart.split('-').map(Number);
    const h = parseInt(hourPart);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${monthNames[m]} ${d}, ${h12} ${ampm}`;
  }

  const [y, m, d] = key.split('-').map(Number);

  switch (granularity) {
    case 'daily':
      return `${monthNames[m]} ${d}`;
    case 'weekly':
      return `Week of ${monthNames[m]} ${d}`;
    case 'monthly':
      return `${monthNames[m]} ${y}`;
  }
}

// ── Calendar Picker Component ────────────────────────────

function CalendarPicker({
  startDate,
  endDate,
  onApply,
  onClose,
}: {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  onApply: (start: string, end: string) => void;
  onClose: () => void;
}) {
  const [viewYear, setViewYear] = useState(() => {
    const d = startDate ? new Date(startDate + 'T00:00:00') : new Date();
    return d.getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const d = startDate ? new Date(startDate + 'T00:00:00') : new Date();
    return d.getMonth(); // 0-indexed
  });
  const [selStart, setSelStart] = useState(startDate);
  const [selEnd, setSelEnd] = useState(endDate);
  const [selectingEnd, setSelectingEnd] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const dim = daysInMonth(viewYear, viewMonth + 1); // daysInMonth uses 1-indexed month
  const firstDow = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  function toKey(d: number) {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function handleDayClick(d: number) {
    const key = toKey(d);
    if (!selectingEnd) {
      setSelStart(key);
      setSelEnd('');
      setSelectingEnd(true);
    } else {
      if (key < selStart) {
        setSelEnd(selStart);
        setSelStart(key);
      } else {
        setSelEnd(key);
      }
      setSelectingEnd(false);
    }
  }

  function isInRange(d: number) {
    if (!selStart || !selEnd) return false;
    const key = toKey(d);
    return key >= selStart && key <= selEnd;
  }

  function isStart(d: number) { return toKey(d) === selStart; }
  function isEnd(d: number) { return toKey(d) === selEnd; }

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div ref={ref} className="absolute top-full mt-2 z-50 bg-[#0d1117] border border-[#1a1f2e] rounded-xl shadow-2xl p-4 w-[320px]">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span className="text-sm font-medium text-zinc-200">{monthNames[viewMonth]} {viewYear}</span>
        <button onClick={nextMonth} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
          <div key={d} className="text-center text-xs text-zinc-600 py-1">{d}</div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: firstDow }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {Array.from({ length: dim }).map((_, i) => {
          const d = i + 1;
          const inRange = isInRange(d);
          const start = isStart(d);
          const end = isEnd(d);
          const isToday = toKey(d) === todayKey;

          return (
            <button
              key={d}
              onClick={() => handleDayClick(d)}
              className={cn(
                'text-center text-sm py-1.5 rounded-md transition-all',
                inRange && !start && !end && 'bg-[#00C80520] text-zinc-200',
                (start || end) && 'text-white font-semibold',
                !inRange && !start && !end && 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
                isToday && !start && !end && !inRange && 'ring-1 ring-zinc-600',
              )}
              style={(start || end) ? { backgroundColor: CHART_GREEN } : undefined}
            >
              {d}
            </button>
          );
        })}
      </div>

      {/* Selection info + Apply */}
      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-zinc-500">
          {selStart && selEnd ? `${selStart} → ${selEnd}` : selStart ? `${selStart} → ...` : 'Select start date'}
        </div>
        <button
          disabled={!selStart || !selEnd}
          onClick={() => onApply(selStart, selEnd)}
          className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-white"
          style={{ backgroundColor: CHART_GREEN }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────

export default function MetricsPage() {
  // Controls
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [customEnd, setCustomEnd] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>('cumulative');
  const [timezone, setTimezone] = useState<Timezone>('UTC');
  const [showCalendar, setShowCalendar] = useState(false);

  // Data
  const [allUsers, setAllUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchProgress, setFetchProgress] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Close export menu on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Helper: format Date to YYYY-MM-DD
  const toDateKey = useCallback((d: Date) => {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  // Auto-set granularity when date range changes + sync calendar dates
  const handleDateRangeChange = useCallback((range: DateRange) => {
    setDateRange(range);
    const auto = AUTO_GRANULARITY[range];
    if (auto) setGranularity(auto);

    // Sync customStart/customEnd so the calendar always reflects the active range
    if (range !== 'custom') {
      const { start, end } = getDateRange(range);
      if (start) {
        setCustomStart(toDateKey(start));
      } else {
        setCustomStart('');
      }
      setCustomEnd(toDateKey(end));
    }
  }, [toDateKey]);

  // Compute effective date range
  const effectiveDates = useMemo(() => {
    if (dateRange === 'custom') {
      return {
        start: customStart ? new Date(customStart + 'T00:00:00') : null,
        end: customEnd ? new Date(customEnd + 'T23:59:59') : new Date(),
      };
    }
    return getDateRange(dateRange);
  }, [dateRange, customStart, customEnd]);

  // Fetch all users in the date range (paginated)
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFetchProgress('Fetching users...');

    try {
      const users: UserListItem[] = [];
      let offset = 0;
      const limit = 250;
      let totalCount = 0;

      do {
        const result = await api.listUsers({
          offset,
          limit,
          created_after: effectiveDates.start ? effectiveDates.start.toISOString() : undefined,
          created_before: effectiveDates.end.toISOString(),
        });

        users.push(...result.members);
        totalCount = result.total_count;
        offset += limit;

        setFetchProgress(`Fetched ${users.length} of ${totalCount} users...`);
      } while (users.length < totalCount);

      setAllUsers(users);
      setFetchProgress(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load users';
      setError(msg);
      setAllUsers([]);
    } finally {
      setLoading(false);
      setFetchProgress(null);
    }
  }, [effectiveDates]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter users by status
  const filteredUsers = useMemo(() => {
    if (!statusFilter) return allUsers;
    return allUsers.filter(u => u.status === statusFilter);
  }, [allUsers, statusFilter]);

  // Aggregate into chart data
  const chartData = useMemo((): ChartDataPoint[] => {
    if (filteredUsers.length === 0) return [];

    // Bucket users by created_at
    const buckets: Record<string, number> = {};

    for (const user of filteredUsers) {
      if (!user.created_at) continue;
      // Ensure created_at is parsed as UTC — backend may omit the Z suffix
      let raw = user.created_at;
      if (!raw.endsWith('Z') && !raw.includes('+') && !raw.includes('-', 10)) {
        raw = raw.replace(' ', 'T') + 'Z';
      }
      const date = new Date(raw);
      if (isNaN(date.getTime())) continue;
      const key = getBucketKey(date, granularity, timezone);
      buckets[key] = (buckets[key] || 0) + 1;
    }

    // Sort bucket keys chronologically
    const sortedKeys = Object.keys(buckets).sort();
    if (sortedKeys.length === 0) return [];

    // Fill gaps using advanceBucketKey (operates on key strings, no timezone issues)
    const allKeys: string[] = [];
    const firstKey = sortedKeys[0];
    const lastKey = sortedKeys[sortedKeys.length - 1];

    let cursor = firstKey;
    const maxIter = 10000; // safety limit
    let iter = 0;
    while (cursor <= lastKey && iter < maxIter) {
      allKeys.push(cursor);
      cursor = advanceBucketKey(cursor, granularity);
      iter++;
    }

    // Build data points
    let cumulative = 0;
    return allKeys.map(key => {
      const count = buckets[key] || 0;
      cumulative += count;
      return {
        date: formatBucketLabel(key, granularity),
        dateRaw: key,
        count,
        cumulative,
      };
    });
  }, [filteredUsers, granularity, timezone]);

  // Stats
  const stats = useMemo(() => {
    const totalInRange = filteredUsers.length;
    const periods = chartData.length || 1;
    const avgPerPeriod = totalInRange / periods;

    let growthRate: number | null = null;
    if (chartData.length >= 2) {
      const mid = Math.floor(chartData.length / 2);
      const firstHalf = chartData.slice(0, mid).reduce((s, d) => s + d.count, 0);
      const secondHalf = chartData.slice(mid).reduce((s, d) => s + d.count, 0);
      if (firstHalf > 0) {
        growthRate = ((secondHalf - firstHalf) / firstHalf) * 100;
      }
    }

    const granLabel = granularity === 'hourly' ? 'hour' : granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week' : 'month';

    return {
      totalInRange,
      avgPerPeriod: avgPerPeriod.toFixed(1),
      granLabel,
      growthRate,
    };
  }, [filteredUsers, chartData, granularity]);

  // Export handlers
  function handleExport(type: 'chart_csv' | 'users_csv' | 'json') {
    setShowExportMenu(false);
    const date = new Date().toISOString().slice(0, 10);
    const rangeSuffix = dateRange === 'custom' ? `${customStart}_${customEnd}` : dateRange;

    if (type === 'chart_csv') {
      const rows = chartData.map(d => ({
        period: d.date,
        period_key: d.dateRaw,
        new_users: d.count,
        cumulative_users: d.cumulative,
        granularity,
        timezone,
      }));
      exportCSV(rows, `user-growth-${rangeSuffix}-${date}.csv`);
    } else if (type === 'users_csv') {
      const rows = filteredUsers.map(u => ({
        id: u.id,
        email: u.email ?? '',
        phone: u.phone_number ?? '',
        name: u.name ?? '',
        status: u.status,
        membership_status: u.membership_status ?? '',
        membership_plan: u.membership_plan ?? '',
        created_at: u.created_at,
        hotel_count: u.hotel_count ?? '',
        flight_count: u.flight_count ?? '',
        email_count: u.email_count ?? '',
      }));
      exportCSV(rows, `users-${rangeSuffix}-${date}.csv`);
    } else {
      exportJSON({
        exported_at: new Date().toISOString(),
        date_range: dateRange === 'custom' ? `${customStart} to ${customEnd}` : dateRange,
        granularity,
        timezone,
        status_filter: statusFilter,
        stats,
        chart_data: chartData,
        users: filteredUsers,
      }, `metrics-full-${rangeSuffix}-${date}.json`);
    }
  }

  // Date range display string
  const dateRangeLabel = useMemo(() => {
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (effectiveDates.start) {
      return `${fmt(effectiveDates.start)} \u2013 ${fmt(effectiveDates.end)}`;
    }
    return `All time through ${fmt(effectiveDates.end)}`;
  }, [effectiveDates]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg px-3 py-2 shadow-xl">
        <p className="text-xs text-zinc-400 mb-1">{label}</p>
        <p className="text-sm font-semibold" style={{ color: CHART_GREEN }}>
          {chartMode === 'cumulative'
            ? `${payload[0].value.toLocaleString()} total users`
            : `${payload[0].value.toLocaleString()} new users`}
        </p>
      </div>
    );
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Metrics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            User growth and registration trends
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && filteredUsers.length > 0 && (
            <div ref={exportRef} className="relative">
              <button
                onClick={() => setShowExportMenu(v => !v)}
                className="px-3 py-2 text-sm font-medium bg-accent/50 rounded-lg hover:bg-accent transition-colors flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Export
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-[#0d1117] border border-[#1a1f2e] rounded-lg shadow-xl overflow-hidden min-w-[200px]">
                  <button onClick={() => handleExport('chart_csv')} className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-accent/50 transition-colors">
                    Chart data (CSV)
                  </button>
                  <button onClick={() => handleExport('users_csv')} className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-accent/50 transition-colors border-t border-[#1a1f2e]">
                    User list (CSV)
                  </button>
                  <button onClick={() => handleExport('json')} className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-accent/50 transition-colors border-t border-[#1a1f2e]">
                    Full export (JSON)
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            onClick={fetchData}
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

      {/* Controls Row 1: Date range, Granularity, Status */}
      <div className="flex flex-wrap gap-3 mb-3">
        {/* Date Range Dropdown + Calendar Icon */}
        <div className="relative flex items-center gap-1.5">
          <select
            value={dateRange}
            onChange={(e) => handleDateRangeChange(e.target.value as DateRange)}
            className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {DATE_RANGE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
            {dateRange === 'custom' && (
              <option value="custom">Custom</option>
            )}
          </select>

          {/* Always-visible calendar icon */}
          <button
            onClick={() => setShowCalendar(prev => !prev)}
            className={cn(
              'p-2 rounded-lg border transition-colors',
              showCalendar
                ? 'border-[#00C805] bg-[#00C80515] text-[#00C805]'
                : 'border-border bg-background text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
            )}
            title="Pick date range"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>

          {/* Calendar Picker */}
          {showCalendar && (
            <CalendarPicker
              startDate={customStart}
              endDate={customEnd}
              onApply={(start, end) => {
                setCustomStart(start);
                setCustomEnd(end);
                setDateRange('custom');
                setShowCalendar(false);
                // Auto-pick granularity based on span
                const span = Math.round((new Date(end + 'T23:59:59').getTime() - new Date(start + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24));
                if (span <= 2) setGranularity('hourly');
                else if (span <= 60) setGranularity('daily');
                else if (span <= 180) setGranularity('weekly');
                else setGranularity('monthly');
              }}
              onClose={() => setShowCalendar(false)}
            />
          )}
        </div>

        {/* Custom range badge (shows when custom dates are active) */}
        {dateRange === 'custom' && customStart && customEnd && (
          <button
            onClick={() => setShowCalendar(true)}
            className="flex items-center gap-1.5 bg-[#0d1117] border border-[#1a1f2e] rounded-lg px-3 py-2 text-sm text-zinc-300 hover:border-zinc-600 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-500">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {customStart} → {customEnd}
          </button>
        )}

        {/* Granularity */}
        <select
          value={granularity}
          onChange={(e) => setGranularity(e.target.value as Granularity)}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {GRANULARITY_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Status Filter */}
        <select
          value={statusFilter ?? ''}
          onChange={(e) => setStatusFilter(e.target.value || null)}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {STATUS_OPTIONS.map(opt => (
            <option key={opt.label} value={opt.value ?? ''}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Controls Row 2: Timezone + Chart mode */}
      <div className="flex flex-wrap gap-3 mb-4">
        {/* Timezone Toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          {TIMEZONE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setTimezone(opt.value)}
              className={cn(
                'px-2.5 py-2 text-sm font-medium transition-colors',
                timezone === opt.value
                  ? 'text-white'
                  : 'bg-background text-muted-foreground hover:bg-accent'
              )}
              style={timezone === opt.value ? { backgroundColor: CHART_GREEN } : undefined}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Chart Mode Toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setChartMode('cumulative')}
            className={cn(
              'px-3 py-2 text-sm font-medium transition-colors',
              chartMode === 'cumulative'
                ? 'text-white'
                : 'bg-background text-muted-foreground hover:bg-accent'
            )}
            style={chartMode === 'cumulative' ? { backgroundColor: CHART_GREEN } : undefined}
          >
            Cumulative
          </button>
          <button
            onClick={() => setChartMode('new')}
            className={cn(
              'px-3 py-2 text-sm font-medium transition-colors',
              chartMode === 'new'
                ? 'text-white'
                : 'bg-background text-muted-foreground hover:bg-accent'
            )}
            style={chartMode === 'new' ? { backgroundColor: CHART_GREEN } : undefined}
          >
            New Users
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      {!loading && !error && filteredUsers.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">Total Users</p>
            <p className="text-2xl font-semibold" style={{ color: CHART_GREEN }}>{stats.totalInRange.toLocaleString()}</p>
          </div>
          <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">Time Periods</p>
            <p className="text-2xl font-semibold text-zinc-200">{chartData.length}</p>
            <p className="text-xs text-zinc-500">{stats.granLabel}s</p>
          </div>
          <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">Avg per {stats.granLabel}</p>
            <p className="text-2xl font-semibold text-zinc-200">{stats.avgPerPeriod}</p>
          </div>
          <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">Growth Rate</p>
            {stats.growthRate !== null ? (
              <p className="text-2xl font-semibold" style={{ color: stats.growthRate > 0 ? CHART_GREEN : stats.growthRate < 0 ? '#ff5000' : '#9ca3af' }}>
                {stats.growthRate > 0 ? '+' : ''}{stats.growthRate.toFixed(0)}%
              </p>
            ) : (
              <p className="text-2xl font-semibold text-zinc-600">&mdash;</p>
            )}
            <p className="text-xs text-zinc-500">2nd half vs 1st half</p>
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-6">
        {error ? (
          <div className="text-center py-16">
            <p className="text-red-400 mb-2">{error}</p>
            <button
              onClick={fetchData}
              className="mt-3 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
              style={{ backgroundColor: CHART_GREEN }}
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="text-center py-16">
            <div className="inline-block animate-spin w-6 h-6 border-2 rounded-full mb-3" style={{ borderColor: CHART_GREEN, borderTopColor: 'transparent' }} />
            <p className="text-zinc-400 text-sm">{fetchProgress || 'Loading...'}</p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="text-center py-16 text-zinc-500">
            <p>No users found in the selected date range</p>
          </div>
        ) : (
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              {chartMode === 'cumulative' ? (
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCumulative" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_GREEN} stopOpacity={0.25} />
                      <stop offset="50%" stopColor={CHART_GREEN} stopOpacity={0.08} />
                      <stop offset="95%" stopColor={CHART_GREEN} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: CHART_AXIS }}
                    tickLine={false}
                    axisLine={{ stroke: CHART_GRID }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: CHART_AXIS }}
                    tickLine={false}
                    axisLine={{ stroke: CHART_GRID }}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ stroke: CHART_GREEN_DIM }} />
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    stroke={CHART_GREEN}
                    strokeWidth={2.5}
                    fill="url(#colorCumulative)"
                    dot={chartData.length <= 60 ? { fill: CHART_GREEN, r: 3, strokeWidth: 0 } : false}
                    activeDot={{ fill: CHART_GREEN_LIGHT, r: 5, strokeWidth: 2, stroke: '#0d1117' }}
                  />
                </AreaChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: CHART_AXIS }}
                    tickLine={false}
                    axisLine={{ stroke: CHART_GRID }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: CHART_AXIS }}
                    tickLine={false}
                    axisLine={{ stroke: CHART_GRID }}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: CHART_GREEN_DIM }} />
                  <Bar
                    dataKey="count"
                    fill={CHART_GREEN}
                    radius={[4, 4, 0, 0]}
                    opacity={0.85}
                  />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Footer info */}
      {!loading && !error && chartData.length > 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          Showing {filteredUsers.length.toLocaleString()} users from {dateRangeLabel}
          {statusFilter && ` (${statusFilter} only)`}
          {` \u00b7 ${TIMEZONE_OPTIONS.find(o => o.value === timezone)?.label ?? timezone} time`}
        </p>
      )}
    </div>
  );
}
