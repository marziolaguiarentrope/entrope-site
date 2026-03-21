'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { api } from '@/lib/api';
import type { OnboardingFunnelUser } from '@/lib/api';
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

type MetricsView = 'registrations' | 'funnel';

interface FunnelChartPoint {
  date: string;
  dateRaw: string;
  registered: number;
  cwi: number;
  monitored: number;
  opportunity: number;
  cwiRate: number;
}

interface FunnelTotals {
  registered: number;
  cwi: number;
  monitored: number;
  opportunity: number;
  progressed: number;
  avgHoursToBooking: number | null;
  avgHoursToOpp: number | null;
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
const CHART_CYAN = '#06b6d4';
const CHART_AMBER = '#f59e0b';
const CHART_ORANGE = '#f97316';

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

/**
 * Compute the effective date range in UTC.
 * Uses UTC consistently to avoid local-timezone drift in bucket generation.
 * The timezone parameter adjusts the "now" anchor so that date boundaries
 * align with the user's selected display timezone.
 */
function getDateRange(range: DateRange, tz: Timezone = 'UTC'): { start: Date | null; end: Date } {
  const now = new Date();

  if (range === '24h') {
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { start, end: now };
  }

  // Compute "end of today" in the selected timezone, expressed as a UTC Date.
  // This ensures "Last 7 days" in Pacific means the last 7 Pacific days, not UTC days.
  const offsetMs = getUtcOffsetHours(now, tz) * 60 * 60 * 1000;
  const nowInTz = new Date(now.getTime() + offsetMs);
  // End of today in tz = start of tomorrow in tz - 1ms, converted back to UTC
  const endOfTodayInTzUtc = new Date(
    Date.UTC(nowInTz.getUTCFullYear(), nowInTz.getUTCMonth(), nowInTz.getUTCDate(), 23, 59, 59) - offsetMs
  );
  // But don't go past actual "now" — if it's 3pm Pacific, don't claim data through 11:59pm Pacific
  const end = new Date(Math.min(now.getTime(), endOfTodayInTzUtc.getTime() + 1000));

  // Start of day in tz for the computed start date
  function startOfDayInTz(d: Date): Date {
    const dInTz = new Date(d.getTime() + offsetMs);
    return new Date(
      Date.UTC(dInTz.getUTCFullYear(), dInTz.getUTCMonth(), dInTz.getUTCDate(), 0, 0, 0) - offsetMs
    );
  }

  switch (range) {
    case '7d': {
      const s = new Date(now);
      s.setUTCDate(s.getUTCDate() - 7);
      return { start: startOfDayInTz(s), end };
    }
    case '30d': {
      const s = new Date(now);
      s.setUTCDate(s.getUTCDate() - 30);
      return { start: startOfDayInTz(s), end };
    }
    case '90d': {
      const s = new Date(now);
      s.setUTCDate(s.getUTCDate() - 90);
      return { start: startOfDayInTz(s), end };
    }
    case '6m': {
      const s = new Date(now);
      s.setUTCMonth(s.getUTCMonth() - 6);
      return { start: startOfDayInTz(s), end };
    }
    case '1y': {
      const s = new Date(now);
      s.setUTCFullYear(s.getUTCFullYear() - 1);
      return { start: startOfDayInTz(s), end };
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

/**
 * Generate time bucket boundaries for the count-based fetch strategy.
 * Returns an array of { key, start: ISO, end: ISO } for each bucket in the range.
 * Now timezone-aware: bucket keys are computed in the selected timezone.
 */
function generateBuckets(
  rangeStart: Date,
  rangeEnd: Date,
  gran: Granularity,
  tz: Timezone = 'UTC',
): { key: string; start: Date; end: Date }[] {
  const buckets: { key: string; start: Date; end: Date }[] = [];
  const cursor = new Date(rangeStart);
  const maxIter = 10000;
  let iter = 0;

  while (cursor < rangeEnd && iter < maxIter) {
    const bucketStart = new Date(cursor);
    // Advance cursor to next bucket start
    switch (gran) {
      case 'hourly':
        cursor.setUTCHours(cursor.getUTCHours() + 1);
        break;
      case 'daily':
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        break;
      case 'weekly':
        cursor.setUTCDate(cursor.getUTCDate() + 7);
        break;
      case 'monthly':
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        break;
    }
    const bucketEnd = new Date(Math.min(cursor.getTime(), rangeEnd.getTime()));
    const key = getBucketKey(bucketStart, gran, tz);
    buckets.push({ key, start: bucketStart, end: bucketEnd });
    iter++;
  }

  return buckets;
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
  const [chartMode, setChartMode] = useState<ChartMode>('cumulative');
  const [timezone, setTimezone] = useState<Timezone>('UTC');
  const [showCalendar, setShowCalendar] = useState(false);

  // Data — store chart points directly instead of raw user records
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [baselineCount, setBaselineCount] = useState(0); // users before range start
  const [totalInRange, setTotalInRange] = useState(0);
  const [lifetimeTotal, setLifetimeTotal] = useState(0); // total users ever
  const [lifetimeFirstDate, setLifetimeFirstDate] = useState<string | null>(null); // earliest user creation
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchProgress, setFetchProgress] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Marketing Funnel state
  const [metricsView, setMetricsView] = useState<MetricsView>('registrations');
  const [funnelChartData, setFunnelChartData] = useState<FunnelChartPoint[]>([]);
  const [funnelTotals, setFunnelTotals] = useState<FunnelTotals | null>(null);
  const [funnelError, setFunnelError] = useState<string | null>(null);
  const [funnelUsers, setFunnelUsers] = useState<OnboardingFunnelUser[]>([]);
  const [adSpend, setAdSpend] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('axel-metrics-ad-spend') || '';
    }
    return '';
  });

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

  // Persist ad spend to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('axel-metrics-ad-spend', adSpend);
    }
  }, [adSpend]);

  // Helper: format Date to YYYY-MM-DD (uses UTC to match effectiveDates computation)
  const toDateKey = useCallback((d: Date) => {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }, []);

  // Auto-set granularity when date range changes + sync calendar dates
  const handleDateRangeChange = useCallback((range: DateRange) => {
    setDateRange(range);
    const auto = AUTO_GRANULARITY[range];
    if (auto) setGranularity(auto);

    // Sync customStart/customEnd so the calendar always reflects the active range
    if (range !== 'custom') {
      const { start, end } = getDateRange(range, timezone);
      if (start) {
        setCustomStart(toDateKey(start));
      } else {
        setCustomStart('');
      }
      setCustomEnd(toDateKey(end));
    }
  }, [toDateKey, timezone]);

  // Compute effective date range (now timezone-aware)
  const effectiveDates = useMemo(() => {
    if (dateRange === 'custom') {
      // For custom ranges, interpret the dates in the selected timezone
      const offsetMs = getUtcOffsetHours(new Date(), timezone) * 60 * 60 * 1000;
      return {
        start: customStart ? new Date(new Date(customStart + 'T00:00:00Z').getTime() - offsetMs) : null,
        end: customEnd ? new Date(new Date(customEnd + 'T23:59:59Z').getTime() - offsetMs) : new Date(),
      };
    }
    return getDateRange(dateRange, timezone);
  }, [dateRange, customStart, customEnd, timezone]);

  // Fetch counts per bucket in parallel (no user record download)
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFunnelError(null);
    setFetchProgress('Generating buckets...');

    try {
      const rangeStart = effectiveDates.start ?? new Date('2020-01-01T00:00:00Z');
      const rangeEnd = effectiveDates.end;

      // Generate time buckets for the range — now timezone-aware
      const buckets = generateBuckets(rangeStart, rangeEnd, granularity, timezone);

      if (buckets.length === 0) {
        setChartData([]);
        setBaselineCount(0);
        setTotalInRange(0);
        setLoading(false);
        setFetchProgress(null);
        return;
      }

      setFetchProgress(`Fetching counts for ${buckets.length} periods...`);

      // Fire all bucket count requests in parallel + baseline count + lifetime total
      // Use limit=1 to only get total_count without downloading user data
      const BATCH_SIZE = 15; // limit concurrent requests to avoid hammering the API
      const bucketCounts: number[] = new Array(buckets.length).fill(0);
      let baseline = 0;

      // Fetch baseline (users before range start) for cumulative mode
      const baselinePromise = effectiveDates.start
        ? api.listUsers({ limit: 1, created_before: effectiveDates.start.toISOString() }).then(r => r.total_count).catch(() => 0)
        : Promise.resolve(0);

      // Fetch lifetime total (all users ever) — fires in parallel with bucket fetches
      // Then use the total to find the earliest user via offset (API returns newest first)
      const lifetimePromise = api.listUsers({ limit: 1 }).then(r => r.total_count).catch(() => 0);

      // We need lifetime total first, then offset to the last page to get the earliest user
      // This is sequential but only adds one lightweight API call
      const firstUserPromise = lifetimePromise.then(total => {
        if (total === 0) return null;
        return api.listUsers({ limit: 1, offset: total - 1 })
          .then(r => r.members?.[0]?.created_at ?? null)
          .catch(() => null);
      });

      // Fetch funnel data in parallel with bucket counts
      const daysForFunnel = effectiveDates.start
        ? Math.min(30, Math.max(1, Math.ceil((effectiveDates.end.getTime() - effectiveDates.start.getTime()) / (1000 * 60 * 60 * 24))))
        : 30;
      const funnelPromise = api.getBusinessDashboard(daysForFunnel).catch((err) => {
        const msg = err instanceof Error ? err.message : 'Failed to load funnel data';
        setFunnelError(msg);
        return null;
      });

      // Process buckets in batches
      for (let i = 0; i < buckets.length; i += BATCH_SIZE) {
        const batch = buckets.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(b =>
            api.listUsers({
              limit: 1,
              created_after: b.start.toISOString(),
              created_before: b.end.toISOString(),
            }).then(r => r.total_count).catch(() => 0)
          )
        );
        for (let j = 0; j < results.length; j++) {
          bucketCounts[i + j] = results[j];
        }
        setFetchProgress(`Fetched ${Math.min(i + BATCH_SIZE, buckets.length)} of ${buckets.length} periods...`);
      }

      baseline = await baselinePromise;
      const lifetime = await lifetimePromise;
      const firstDate = await firstUserPromise;

      // Build chart data points
      let cumulative = baseline;
      const points: ChartDataPoint[] = buckets.map((b, i) => {
        const count = bucketCounts[i];
        cumulative += count;
        return {
          date: formatBucketLabel(b.key, granularity),
          dateRaw: b.key,
          count,
          cumulative,
        };
      });

      const total = bucketCounts.reduce((s, c) => s + c, 0);
      setChartData(points);
      setBaselineCount(baseline);
      setTotalInRange(total);
      setLifetimeTotal(lifetime);
      setLifetimeFirstDate(firstDate);
      setFetchProgress(null);

      // Process funnel data
      const dashboardData = await funnelPromise;
      if (dashboardData?.onboarding_funnel) {
        setFunnelError(null);
        const funnel = dashboardData.onboarding_funnel;
        const users: OnboardingFunnelUser[] = funnel.users || [];
        setFunnelUsers(users);

        // Compute averages
        const bookingHours = users.filter(u => u.hours_to_first_booking !== null).map(u => u.hours_to_first_booking!);
        const oppHours = users.filter(u => u.hours_to_first_opp !== null).map(u => u.hours_to_first_opp!);

        setFunnelTotals({
          registered: funnel.summary.signed_up,
          cwi: funnel.summary.has_booking,
          monitored: funnel.summary.has_watch,
          opportunity: funnel.summary.has_opportunity,
          progressed: funnel.summary.has_opportunity_progressed,
          avgHoursToBooking: bookingHours.length > 0 ? bookingHours.reduce((a, b) => a + b, 0) / bookingHours.length : null,
          avgHoursToOpp: oppHours.length > 0 ? oppHours.reduce((a, b) => a + b, 0) / oppHours.length : null,
        });

        // Bucket users by signup date for trend chart
        const userBuckets = new Map<string, { registered: number; cwi: number; monitored: number; opportunity: number }>();
        for (const user of users) {
          const signupDate = new Date(user.signed_up.endsWith('Z') ? user.signed_up : user.signed_up + 'Z');
          if (effectiveDates.start && signupDate < effectiveDates.start) continue;
          if (signupDate > effectiveDates.end) continue;
          const key = getBucketKey(signupDate, granularity, timezone);
          const existing = userBuckets.get(key) || { registered: 0, cwi: 0, monitored: 0, opportunity: 0 };
          existing.registered++;
          if (user.flight_bookings + user.hotel_bookings > 0) existing.cwi++;
          if (user.flight_watches + user.hotel_watches > 0) existing.monitored++;
          if (user.flight_opps + user.hotel_opps > 0) existing.opportunity++;
          userBuckets.set(key, existing);
        }

        const funnelPoints: FunnelChartPoint[] = buckets.map(b => {
          const data = userBuckets.get(b.key) || { registered: 0, cwi: 0, monitored: 0, opportunity: 0 };
          return {
            date: formatBucketLabel(b.key, granularity),
            dateRaw: b.key,
            ...data,
            cwiRate: data.registered > 0 ? Math.round((data.cwi / data.registered) * 100) : 0,
          };
        });
        setFunnelChartData(funnelPoints);
      } else {
        setFunnelTotals(null);
        setFunnelChartData([]);
        setFunnelUsers([]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load metrics';
      setError(msg);
      setChartData([]);
    } finally {
      setLoading(false);
      setFetchProgress(null);
    }
  }, [effectiveDates, granularity, timezone]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Stats — now includes lifetime context
  const stats = useMemo(() => {
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

    // Compute range duration in days for daily rate
    // Clamp the effective start to lifetimeFirstDate so we don't dilute the rate
    // with days before the product had any users
    let rangeDays = 1;
    const rangeStartMs = effectiveDates.start?.getTime() ?? null;
    const firstUserMs = lifetimeFirstDate ? new Date(lifetimeFirstDate).getTime() : null;
    const rangeEndMs = effectiveDates.end.getTime();

    if (rangeStartMs !== null) {
      // Use the later of range start vs first user date, so we don't count empty pre-launch days
      const effectiveStart = firstUserMs ? Math.max(rangeStartMs, firstUserMs) : rangeStartMs;
      rangeDays = Math.max(1, (rangeEndMs - effectiveStart) / (1000 * 60 * 60 * 24));
    } else if (firstUserMs) {
      // "All time" range — use lifetime span from first user
      rangeDays = Math.max(1, (rangeEndMs - firstUserMs) / (1000 * 60 * 60 * 24));
    }
    const dailyRateInRange = totalInRange / rangeDays;

    // For ≤24h ranges, compute hourly rate instead (daily rate is redundant with total)
    const rangeHours = rangeDays * 24;
    const isShortRange = rangeDays <= 1.5; // roughly 24h or less
    const hourlyRateInRange = isShortRange ? totalInRange / Math.max(1, rangeHours) : null;

    // Lifetime daily average
    let lifetimeDailyAvg: number | null = null;
    let lifetimeDays: number | null = null;
    if (lifetimeFirstDate && lifetimeTotal > 0) {
      const firstDate = new Date(lifetimeFirstDate);
      lifetimeDays = Math.max(1, (new Date().getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
      lifetimeDailyAvg = lifetimeTotal / lifetimeDays;
    }

    // How current range compares to lifetime average
    let vsLifetime: number | null = null;
    if (lifetimeDailyAvg && lifetimeDailyAvg > 0) {
      vsLifetime = ((dailyRateInRange - lifetimeDailyAvg) / lifetimeDailyAvg) * 100;
    }

    return {
      totalInRange,
      avgPerPeriod: avgPerPeriod.toFixed(1),
      granLabel,
      growthRate,
      dailyRateInRange,
      hourlyRateInRange,
      isShortRange,
      lifetimeDailyAvg,
      lifetimeDays,
      vsLifetime,
    };
  }, [totalInRange, chartData, granularity, effectiveDates, lifetimeTotal, lifetimeFirstDate]);

  // CPR/CPI computations
  const cprMetrics = useMemo(() => {
    const spend = parseFloat(adSpend) || 0;
    if (spend <= 0 || !funnelTotals) return null;
    const cpr = funnelTotals.registered > 0 ? spend / funnelTotals.registered : 0;
    const cpi = funnelTotals.cwi > 0 ? spend / funnelTotals.cwi : 0;
    const cpOpp = funnelTotals.opportunity > 0 ? spend / funnelTotals.opportunity : 0;
    return { cpr, cpi, cpOpp };
  }, [adSpend, funnelTotals]);

  // Period-over-period deltas for funnel stages (2nd half vs 1st half)
  const funnelDeltas = useMemo(() => {
    if (funnelChartData.length < 4) return null;
    const mid = Math.floor(funnelChartData.length / 2);
    const first = funnelChartData.slice(0, mid);
    const second = funnelChartData.slice(mid);

    const sum = (arr: FunnelChartPoint[], key: 'registered' | 'cwi' | 'monitored' | 'opportunity') =>
      arr.reduce((s, d) => s + d[key], 0);

    const calc = (key: 'registered' | 'cwi' | 'monitored' | 'opportunity') => {
      const f = sum(first, key);
      const s = sum(second, key);
      if (f === 0) return null;
      return Math.round(((s - f) / f) * 100);
    };

    return {
      registered: calc('registered'),
      cwi: calc('cwi'),
      monitored: calc('monitored'),
      opportunity: calc('opportunity'),
    };
  }, [funnelChartData]);

  // Executive insights auto-generated from funnel data
  const executiveInsights = useMemo(() => {
    const insights: { type: 'success' | 'warning' | 'info' | 'action'; text: string }[] = [];

    // Registration-based insights (always available if we have registration data)
    if (!funnelTotals && totalInRange > 0) {
      insights.push({ type: 'info', text: `${totalInRange.toLocaleString()} new registrations in this period. Funnel breakdown unavailable — retry or check backend status.` });
      if (stats.growthRate !== null) {
        insights.push({
          type: stats.growthRate > 0 ? 'success' : stats.growthRate < -10 ? 'warning' : 'info',
          text: `Registration growth: ${stats.growthRate > 0 ? '+' : ''}${stats.growthRate.toFixed(0)}% (2nd half vs 1st half of period).`,
        });
      }
      if (stats.vsLifetime !== null) {
        insights.push({
          type: stats.vsLifetime > 10 ? 'success' : stats.vsLifetime < -10 ? 'warning' : 'info',
          text: `Daily registration rate is ${stats.vsLifetime > 0 ? '+' : ''}${stats.vsLifetime.toFixed(0)}% vs lifetime average (${stats.dailyRateInRange.toFixed(1)}/day vs ${stats.lifetimeDailyAvg?.toFixed(1)}/day).`,
        });
      }
      const spend = parseFloat(adSpend) || 0;
      if (spend > 0) {
        const cpr = spend / totalInRange;
        insights.push({
          type: cpr <= 5 ? 'success' : cpr <= 10 ? 'info' : 'action',
          text: `CPR at $${cpr.toFixed(2)} based on ${totalInRange} registrations. ${cpr <= 5 ? 'Below $5 goal.' : cpr <= 10 ? 'Above $5 goal — review targeting.' : 'Well above goal — pause underperformers.'}`,
        });
      }
      return insights.length > 0 ? insights : null;
    }

    if (!funnelTotals || funnelTotals.registered === 0) return null;

    // 1. Biggest drop-off point
    const stages = [
      { name: 'Registered → CWI', from: funnelTotals.registered, to: funnelTotals.cwi },
      { name: 'CWI → Monitored', from: funnelTotals.cwi, to: funnelTotals.monitored },
      { name: 'Monitored → Opportunity', from: funnelTotals.monitored, to: funnelTotals.opportunity },
      { name: 'Opportunity → Progressed', from: funnelTotals.opportunity, to: funnelTotals.progressed },
    ];

    const dropoffs = stages
      .filter(s => s.from > 0)
      .map(s => ({ ...s, dropPct: Math.round(((s.from - s.to) / s.from) * 100), lost: s.from - s.to }));

    if (dropoffs.length > 0) {
      const worst = dropoffs.reduce((a, b) => b.dropPct > a.dropPct ? b : a, dropoffs[0]);
      if (worst.dropPct > 50) {
        insights.push({
          type: 'warning',
          text: `Biggest bottleneck: ${worst.name} loses ${worst.dropPct}% (${worst.lost.toLocaleString()} users). Focus retention efforts here.`,
        });
      } else if (worst.dropPct > 30) {
        insights.push({
          type: 'info',
          text: `Largest drop-off at ${worst.name}: ${worst.dropPct}% (${worst.lost.toLocaleString()} users).`,
        });
      }
    }

    // 2. CWI rate trend (first half vs second half)
    if (funnelChartData.length >= 4) {
      const mid = Math.floor(funnelChartData.length / 2);
      const firstHalf = funnelChartData.slice(0, mid);
      const secondHalf = funnelChartData.slice(mid);
      const firstReg = firstHalf.reduce((s, d) => s + d.registered, 0);
      const firstCwi = firstHalf.reduce((s, d) => s + d.cwi, 0);
      const secondReg = secondHalf.reduce((s, d) => s + d.registered, 0);
      const secondCwi = secondHalf.reduce((s, d) => s + d.cwi, 0);
      const firstRate = firstReg > 0 ? (firstCwi / firstReg) * 100 : 0;
      const secondRate = secondReg > 0 ? (secondCwi / secondReg) * 100 : 0;
      const delta = secondRate - firstRate;

      if (Math.abs(delta) > 2) {
        insights.push({
          type: delta > 0 ? 'success' : 'warning',
          text: `CWI rate ${delta > 0 ? 'improving' : 'declining'}: ${Math.abs(delta).toFixed(1)}pp shift (${firstRate.toFixed(0)}% → ${secondRate.toFixed(0)}%) over the period.`,
        });
      }
    }

    // 3. Time to intent assessment
    if (funnelTotals.avgHoursToBooking !== null) {
      const hours = funnelTotals.avgHoursToBooking;
      if (hours <= 24) {
        insights.push({ type: 'success', text: `Users show intent within ${Math.round(hours)}h on average — strong activation speed.` });
      } else if (hours <= 72) {
        insights.push({ type: 'info', text: `Avg ${(hours / 24).toFixed(1)} days to first intent. Consider onboarding nudges at 24h and 48h marks.` });
      } else {
        insights.push({ type: 'action', text: `Slow activation: ${(hours / 24).toFixed(1)} days avg to first intent. Add drip emails or in-app prompts to accelerate.` });
      }
    }

    // 4. CPR assessment
    if (cprMetrics) {
      if (cprMetrics.cpr <= 5) {
        insights.push({ type: 'success', text: `CPR at $${cprMetrics.cpr.toFixed(2)} — below $5 goal. Ad spend is efficient.` });
      } else if (cprMetrics.cpr <= 10) {
        insights.push({ type: 'info', text: `CPR at $${cprMetrics.cpr.toFixed(2)} — above $5 goal. Review ad targeting or creative.` });
      } else {
        insights.push({ type: 'action', text: `CPR at $${cprMetrics.cpr.toFixed(2)} — 2x+ above goal. Pause underperforming ad sets and reallocate budget.` });
      }
    }

    // 5. End-to-end efficiency
    const overallConversion = funnelTotals.registered > 0
      ? (funnelTotals.progressed / funnelTotals.registered) * 100
      : 0;
    if (overallConversion > 0) {
      insights.push({
        type: overallConversion >= 5 ? 'success' : 'info',
        text: `End-to-end conversion: ${overallConversion.toFixed(1)}% of registered users reach Progressed stage.`,
      });
    }

    // 6. Channel imbalance detection
    if (funnelUsers.length > 0) {
      let flightActive = 0, hotelActive = 0;
      for (const u of funnelUsers) {
        if (u.flight_bookings + u.flight_watches > 0) flightActive++;
        if (u.hotel_bookings + u.hotel_watches > 0) hotelActive++;
      }
      const total = flightActive + hotelActive;
      if (total > 0) {
        const flightPct = Math.round((flightActive / total) * 100);
        if (flightPct > 80) {
          insights.push({ type: 'info', text: `${flightPct}% of active users are flight-focused. Consider promoting hotel features to diversify engagement.` });
        } else if (flightPct < 20) {
          insights.push({ type: 'info', text: `${100 - flightPct}% of active users are hotel-focused. Flight adoption is low — consider flight-specific campaigns.` });
        }
      }
    }

    // 7. Stalled user warning
    if (funnelUsers.length > 0) {
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      const stalledCount = funnelUsers.filter(u => {
        const age = now - new Date(u.signed_up.endsWith('Z') ? u.signed_up : u.signed_up + 'Z').getTime();
        const hasActivity = u.flight_bookings + u.hotel_bookings + u.flight_watches + u.hotel_watches > 0;
        return age > weekMs && !hasActivity;
      }).length;
      const stalledPct = Math.round((stalledCount / funnelUsers.length) * 100);
      if (stalledPct > 30) {
        insights.push({ type: 'action', text: `${stalledPct}% of users (${stalledCount}) are inactive 7+ days post-signup. Trigger re-engagement flow via email or push.` });
      }
    }

    return insights.length > 0 ? insights : null;
  }, [funnelTotals, funnelChartData, cprMetrics, funnelUsers, totalInRange, stats, adSpend]);

  // Drop-off analysis: per-stage conversion rates and loss counts
  const dropoffAnalysis = useMemo(() => {
    if (!funnelTotals || funnelTotals.registered === 0) return null;

    const stages = [
      { label: 'Registered', count: funnelTotals.registered, color: CHART_GREEN },
      { label: 'CWI', count: funnelTotals.cwi, color: CHART_CYAN },
      { label: 'Monitored', count: funnelTotals.monitored, color: CHART_AMBER },
      { label: 'Opportunity', count: funnelTotals.opportunity, color: CHART_ORANGE },
      { label: 'Progressed', count: funnelTotals.progressed, color: '#a78bfa' },
    ];

    return stages.map((stage, i) => ({
      ...stage,
      pctOfTotal: Math.round((stage.count / funnelTotals.registered) * 100),
      convFromPrev: i === 0 ? 100 : (stages[i - 1].count > 0 ? Math.round((stage.count / stages[i - 1].count) * 100) : 0),
      lost: i === 0 ? 0 : stages[i - 1].count - stage.count,
    }));
  }, [funnelTotals]);

  // At-risk users: stalled at each funnel stage
  const atRiskAnalysis = useMemo(() => {
    if (funnelUsers.length === 0) return null;

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Users registered 3+ days ago with no intent (no bookings)
    const noIntent = funnelUsers.filter(u => {
      const age = now - new Date(u.signed_up.endsWith('Z') ? u.signed_up : u.signed_up + 'Z').getTime();
      const hasIntent = u.flight_bookings + u.hotel_bookings > 0;
      return age > 3 * dayMs && !hasIntent;
    });

    // Users with bookings but no watches (stalled after first intent)
    const noWatch = funnelUsers.filter(u => {
      const hasBooking = u.flight_bookings + u.hotel_bookings > 0;
      const hasWatch = u.flight_watches + u.hotel_watches > 0;
      return hasBooking && !hasWatch;
    });

    // Users with watches but no opportunities (waiting)
    const noOpp = funnelUsers.filter(u => {
      const hasWatch = u.flight_watches + u.hotel_watches > 0;
      const hasOpp = u.flight_opps + u.hotel_opps > 0;
      return hasWatch && !hasOpp;
    });

    return {
      noIntent: noIntent.length,
      noWatch: noWatch.length,
      noOpp: noOpp.length,
      total: funnelUsers.length,
    };
  }, [funnelUsers]);

  // Cohort analysis: group users by signup week, show conversion rates per cohort
  const cohortAnalysis = useMemo(() => {
    if (funnelUsers.length === 0) return null;

    const cohorts = new Map<string, {
      label: string;
      registered: number;
      cwi: number;
      monitored: number;
      opportunity: number;
    }>();

    for (const u of funnelUsers) {
      const d = new Date(u.signed_up.endsWith('Z') ? u.signed_up : u.signed_up + 'Z');
      // Group by week (Monday-start)
      const dow = d.getUTCDay();
      const diff = dow === 0 ? -6 : 1 - dow;
      const monday = new Date(d);
      monday.setUTCDate(monday.getUTCDate() + diff);
      const key = `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`;
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const label = `${monthNames[monday.getUTCMonth()]} ${monday.getUTCDate()}`;

      const existing = cohorts.get(key) || { label, registered: 0, cwi: 0, monitored: 0, opportunity: 0 };
      existing.registered++;
      if (u.flight_bookings + u.hotel_bookings > 0) existing.cwi++;
      if (u.flight_watches + u.hotel_watches > 0) existing.monitored++;
      if (u.flight_opps + u.hotel_opps > 0) existing.opportunity++;
      cohorts.set(key, existing);
    }

    return Array.from(cohorts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, data]) => ({
        key,
        ...data,
        cwiRate: data.registered > 0 ? Math.round((data.cwi / data.registered) * 100) : 0,
        monitoredRate: data.registered > 0 ? Math.round((data.monitored / data.registered) * 100) : 0,
        oppRate: data.registered > 0 ? Math.round((data.opportunity / data.registered) * 100) : 0,
      }));
  }, [funnelUsers]);

  // Conversion velocity: distribution of time-to-first-booking
  const velocityDistribution = useMemo(() => {
    if (funnelUsers.length === 0) return null;

    const buckets = [
      { label: '< 1h', min: 0, max: 1, count: 0 },
      { label: '1-6h', min: 1, max: 6, count: 0 },
      { label: '6-24h', min: 6, max: 24, count: 0 },
      { label: '1-3d', min: 24, max: 72, count: 0 },
      { label: '3-7d', min: 72, max: 168, count: 0 },
      { label: '7+ days', min: 168, max: Infinity, count: 0 },
    ];

    let totalWithBooking = 0;
    for (const u of funnelUsers) {
      if (u.hours_to_first_booking !== null) {
        totalWithBooking++;
        const h = u.hours_to_first_booking;
        for (const b of buckets) {
          if (h >= b.min && h < b.max) {
            b.count++;
            break;
          }
        }
      }
    }

    if (totalWithBooking === 0) return null;

    const maxCount = Math.max(...buckets.map(b => b.count));
    return buckets.map(b => ({
      ...b,
      pct: Math.round((b.count / totalWithBooking) * 100),
      barWidth: maxCount > 0 ? Math.round((b.count / maxCount) * 100) : 0,
    }));
  }, [funnelUsers]);

  // Channel breakdown: flight vs hotel activity
  const channelBreakdown = useMemo(() => {
    if (funnelUsers.length === 0) return null;

    let flightBookings = 0, hotelBookings = 0;
    let flightWatches = 0, hotelWatches = 0;
    let flightOpps = 0, hotelOpps = 0;
    let flightOnly = 0, hotelOnly = 0, both = 0, neither = 0;

    for (const u of funnelUsers) {
      flightBookings += u.flight_bookings;
      hotelBookings += u.hotel_bookings;
      flightWatches += u.flight_watches;
      hotelWatches += u.hotel_watches;
      flightOpps += u.flight_opps;
      hotelOpps += u.hotel_opps;

      const hasFlight = u.flight_bookings + u.flight_watches > 0;
      const hasHotel = u.hotel_bookings + u.hotel_watches > 0;
      if (hasFlight && hasHotel) both++;
      else if (hasFlight) flightOnly++;
      else if (hasHotel) hotelOnly++;
      else neither++;
    }

    return {
      flights: { bookings: flightBookings, watches: flightWatches, opps: flightOpps },
      hotels: { bookings: hotelBookings, watches: hotelWatches, opps: hotelOpps },
      userSplit: { flightOnly, hotelOnly, both, neither },
      totalActive: flightOnly + hotelOnly + both,
    };
  }, [funnelUsers]);

  // Stalled users: breakdown by days since signup with no progression
  const stalledBreakdown = useMemo(() => {
    if (funnelUsers.length === 0) return null;

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const brackets = [
      { label: '1-3 days', min: 1, max: 3, count: 0 },
      { label: '3-7 days', min: 3, max: 7, count: 0 },
      { label: '7-14 days', min: 7, max: 14, count: 0 },
      { label: '14-30 days', min: 14, max: 30, count: 0 },
      { label: '30+ days', min: 30, max: Infinity, count: 0 },
    ];

    for (const u of funnelUsers) {
      const hasAnyActivity = u.flight_bookings + u.hotel_bookings + u.flight_watches + u.hotel_watches > 0;
      if (hasAnyActivity) continue;

      const ageDays = (now - new Date(u.signed_up.endsWith('Z') ? u.signed_up : u.signed_up + 'Z').getTime()) / dayMs;
      for (const b of brackets) {
        if (ageDays >= b.min && ageDays < b.max) {
          b.count++;
          break;
        }
      }
    }

    const totalStalled = brackets.reduce((s, b) => s + b.count, 0);
    if (totalStalled === 0) return null;

    const maxCount = Math.max(...brackets.map(b => b.count));
    return {
      brackets: brackets.map(b => ({
        ...b,
        pct: Math.round((b.count / totalStalled) * 100),
        barWidth: maxCount > 0 ? Math.round((b.count / maxCount) * 100) : 0,
      })),
      total: totalStalled,
    };
  }, [funnelUsers]);

  // Export handlers
  function handleExport(type: 'chart_csv' | 'json' | 'funnel_csv' | 'funnel_json') {
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
    } else if (type === 'funnel_csv') {
      const rows = funnelChartData.map(d => ({
        period: d.date,
        period_key: d.dateRaw,
        registered: d.registered,
        cwi: d.cwi,
        monitored: d.monitored,
        opportunity: d.opportunity,
        cwi_rate_pct: d.cwiRate,
        granularity,
        timezone,
      }));
      exportCSV(rows, `marketing-funnel-${rangeSuffix}-${date}.csv`);
    } else if (type === 'funnel_json') {
      exportJSON({
        exported_at: new Date().toISOString(),
        date_range: dateRange === 'custom' ? `${customStart} to ${customEnd}` : dateRange,
        granularity,
        timezone,
        funnel_summary: funnelTotals,
        cpr_metrics: cprMetrics,
        ad_spend: parseFloat(adSpend) || 0,
        funnel_chart_data: funnelChartData,
      }, `marketing-funnel-full-${rangeSuffix}-${date}.json`);
    } else {
      exportJSON({
        exported_at: new Date().toISOString(),
        date_range: dateRange === 'custom' ? `${customStart} to ${customEnd}` : dateRange,
        granularity,
        timezone,
        baseline_count: baselineCount,
        stats,
        chart_data: chartData,
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

  // CWI rate tooltip
  const CwiRateTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string | number }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg px-3 py-2 shadow-xl">
        <p className="text-xs text-zinc-400 mb-1">{label}</p>
        <p className="text-sm font-semibold" style={{ color: CHART_CYAN }}>
          {payload[0].value}% conversion
        </p>
      </div>
    );
  };

  // Funnel tooltip
  const FunnelTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string }>; label?: string }) => {
    if (!active || !payload?.length) return null;
    const registered = payload.find(p => p.dataKey === 'registered')?.value ?? 0;
    const cwi = payload.find(p => p.dataKey === 'cwi')?.value ?? 0;
    const labels: Record<string, string> = { registered: 'registered', cwi: 'with intent', monitored: 'monitored', opportunity: 'opportunities' };
    return (
      <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg px-3 py-2 shadow-xl">
        <p className="text-xs text-zinc-400 mb-1.5">{label}</p>
        {payload.map((entry) => (
          <p key={entry.dataKey} className="text-xs" style={{ color: entry.color }}>
            <span className="font-semibold">{entry.value.toLocaleString()}</span>{' '}
            {labels[entry.dataKey] ?? entry.dataKey}
          </p>
        ))}
        {registered > 0 && (
          <p className="text-xs text-zinc-500 mt-1 pt-1 border-t border-zinc-800">
            {Math.round((cwi / registered) * 100)}% CWI rate
          </p>
        )}
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
            {metricsView === 'registrations' ? 'User growth and registration trends' : 'Marketing funnel analytics, insights, and cohort performance'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && (chartData.length > 0 || funnelChartData.length > 0) && (
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
                  {metricsView === 'registrations' ? (<>
                  <button onClick={() => handleExport('chart_csv')} className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-accent/50 transition-colors">
                    Chart data (CSV)
                  </button>
                  <button onClick={() => handleExport('json')} className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-accent/50 transition-colors border-t border-[#1a1f2e]">
                    Full export (JSON)
                  </button>
                  </>) : (<>
                  <button onClick={() => handleExport('funnel_csv')} className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-accent/50 transition-colors">
                    Funnel data (CSV)
                  </button>
                  <button onClick={() => handleExport('funnel_json')} className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-accent/50 transition-colors border-t border-[#1a1f2e]">
                    Full funnel export (JSON)
                  </button>
                  </>)}
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

        {/* Chart Mode Toggle (registration view only) */}
        {metricsView === 'registrations' && (
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
        )}

        {/* View Toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden ml-auto">
          <button
            onClick={() => setMetricsView('registrations')}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors',
              metricsView === 'registrations'
                ? 'text-white'
                : 'bg-background text-muted-foreground hover:bg-accent'
            )}
            style={metricsView === 'registrations' ? { backgroundColor: CHART_GREEN } : undefined}
          >
            Registration Growth
          </button>
          <button
            onClick={() => setMetricsView('funnel')}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors',
              metricsView === 'funnel'
                ? 'text-white'
                : 'bg-background text-muted-foreground hover:bg-accent'
            )}
            style={metricsView === 'funnel' ? { backgroundColor: CHART_CYAN } : undefined}
          >
            Marketing Funnel
          </button>
        </div>
      </div>

      {/* ── Registration Growth View ── */}
      {metricsView === 'registrations' && (<>
      {/* Lifetime Stats (always visible when data loaded) */}
      {!loading && !error && lifetimeTotal > 0 && (
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2 bg-[#0d1117] border border-[#1a1f2e] rounded-lg px-4 py-2.5">
            <span className="text-xs text-zinc-500">Lifetime Users</span>
            <span className="text-lg font-semibold" style={{ color: CHART_GREEN }}>{lifetimeTotal.toLocaleString()}</span>
          </div>
          {stats.lifetimeDailyAvg !== null && (
            <div className="flex items-center gap-2 bg-[#0d1117] border border-[#1a1f2e] rounded-lg px-4 py-2.5">
              <span className="text-xs text-zinc-500">Lifetime Avg</span>
              <span className="text-lg font-semibold text-zinc-200">{stats.lifetimeDailyAvg.toFixed(1)}</span>
              <span className="text-xs text-zinc-500">/day</span>
            </div>
          )}
          {stats.lifetimeDays !== null && (
            <div className="flex items-center gap-2 bg-[#0d1117] border border-[#1a1f2e] rounded-lg px-4 py-2.5">
              <span className="text-xs text-zinc-500">Since</span>
              <span className="text-sm font-medium text-zinc-300">
                {Math.floor(stats.lifetimeDays)} {Math.floor(stats.lifetimeDays) === 1 ? 'day' : 'days'} ago
              </span>
            </div>
          )}
        </div>
      )}

      {/* Selected Range Stats Bar */}
      {!loading && !error && chartData.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">New Users</p>
            <p className="text-2xl font-semibold" style={{ color: CHART_GREEN }}>{stats.totalInRange.toLocaleString()}</p>
            <p className="text-xs text-zinc-500">in selected range</p>
          </div>
          <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">Avg per {stats.granLabel}</p>
            <p className="text-2xl font-semibold text-zinc-200">{stats.avgPerPeriod}</p>
            <p className="text-xs text-zinc-500">{chartData.length} {stats.granLabel}{chartData.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">{stats.isShortRange ? 'Hourly Rate' : 'Daily Rate'}</p>
            <p className="text-2xl font-semibold text-zinc-200">
              {stats.isShortRange
                ? (stats.hourlyRateInRange ?? 0).toFixed(1)
                : stats.dailyRateInRange.toFixed(1)}
            </p>
            <p className="text-xs text-zinc-500">{stats.isShortRange ? '/hour in range' : '/day in range'}</p>
          </div>
          <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">vs Lifetime Avg</p>
            {stats.vsLifetime !== null ? (
              <p className="text-2xl font-semibold" style={{ color: stats.vsLifetime > 0 ? CHART_GREEN : stats.vsLifetime < 0 ? '#ff5000' : '#9ca3af' }}>
                {stats.vsLifetime > 0 ? '+' : ''}{stats.vsLifetime.toFixed(0)}%
              </p>
            ) : (
              <p className="text-2xl font-semibold text-zinc-600">&mdash;</p>
            )}
            <p className="text-xs text-zinc-500">daily rate comparison</p>
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
                    domain={[
                      (dataMin: number) => Math.max(0, Math.floor(dataMin * 0.95)),
                      (dataMax: number) => Math.ceil(dataMax * 1.02),
                    ]}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : v.toLocaleString()}
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
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : v.toLocaleString()}
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
          Showing {totalInRange.toLocaleString()} new users from {dateRangeLabel}
          {` \u00b7 ${TIMEZONE_OPTIONS.find(o => o.value === timezone)?.label ?? timezone} time`}
          {lifetimeTotal > 0 && ` \u00b7 ${lifetimeTotal.toLocaleString()} lifetime users`}
        </p>
      )}
      </>)}

      {/* ── Marketing Funnel View ── */}
      {metricsView === 'funnel' && (<>

      {/* Funnel Overview Cards */}
      {!loading && (funnelTotals || totalInRange > 0) && (
        <div className="mb-6">
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {/* Registered */}
            <div className="flex-1 min-w-[130px] bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4 text-center">
              <p className="text-xs text-zinc-500 mb-1">Registered</p>
              <p className="text-2xl font-semibold" style={{ color: CHART_GREEN }}>{(funnelTotals?.registered ?? totalInRange).toLocaleString()}</p>
              {funnelDeltas?.registered != null && (
                <p className="text-[10px] mt-1" style={{ color: funnelDeltas.registered > 0 ? CHART_GREEN : funnelDeltas.registered < 0 ? '#f87171' : CHART_AXIS }}>
                  {funnelDeltas.registered > 0 ? '+' : ''}{funnelDeltas.registered}% vs prior half
                </p>
              )}
            </div>
            {/* Arrow */}
            <div className="flex flex-col items-center px-1 shrink-0">
              <span className="text-xs font-medium" style={{ color: CHART_CYAN }}>
                {funnelTotals && funnelTotals.registered > 0 ? Math.round((funnelTotals.cwi / funnelTotals.registered) * 100) : '\u2014'}
              </span>
              <svg width="20" height="12" viewBox="0 0 20 12" className="text-zinc-600"><path d="M0 6h16M12 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </div>
            {/* CWI */}
            <div className="flex-1 min-w-[130px] bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4 text-center">
              <p className="text-xs text-zinc-500 mb-0.5">CWI</p>
              <p className="text-[10px] text-zinc-600 mb-1">Customers with Intent</p>
              <p className="text-2xl font-semibold" style={{ color: CHART_CYAN }}>{funnelTotals ? funnelTotals.cwi.toLocaleString() : '\u2014'}</p>
              {funnelDeltas?.cwi != null && (
                <p className="text-[10px] mt-1" style={{ color: funnelDeltas.cwi > 0 ? CHART_GREEN : funnelDeltas.cwi < 0 ? '#f87171' : CHART_AXIS }}>
                  {funnelDeltas.cwi > 0 ? '+' : ''}{funnelDeltas.cwi}% vs prior half
                </p>
              )}
            </div>
            {/* Arrow */}
            <div className="flex flex-col items-center px-1 shrink-0">
              <span className="text-xs font-medium" style={{ color: CHART_AMBER }}>
                {funnelTotals && funnelTotals.cwi > 0 ? Math.round((funnelTotals.monitored / funnelTotals.cwi) * 100) : '\u2014'}
              </span>
              <svg width="20" height="12" viewBox="0 0 20 12" className="text-zinc-600"><path d="M0 6h16M12 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </div>
            {/* Monitored */}
            <div className="flex-1 min-w-[130px] bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4 text-center">
              <p className="text-xs text-zinc-500 mb-1">Monitored</p>
              <p className="text-2xl font-semibold" style={{ color: CHART_AMBER }}>{funnelTotals ? funnelTotals.monitored.toLocaleString() : '\u2014'}</p>
              {funnelDeltas?.monitored != null && (
                <p className="text-[10px] mt-1" style={{ color: funnelDeltas.monitored > 0 ? CHART_GREEN : funnelDeltas.monitored < 0 ? '#f87171' : CHART_AXIS }}>
                  {funnelDeltas.monitored > 0 ? '+' : ''}{funnelDeltas.monitored}% vs prior half
                </p>
              )}
            </div>
            {/* Arrow */}
            <div className="flex flex-col items-center px-1 shrink-0">
              <span className="text-xs font-medium" style={{ color: CHART_ORANGE }}>
                {funnelTotals && funnelTotals.monitored > 0 ? Math.round((funnelTotals.opportunity / funnelTotals.monitored) * 100) : '\u2014'}
              </span>
              <svg width="20" height="12" viewBox="0 0 20 12" className="text-zinc-600"><path d="M0 6h16M12 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </div>
            {/* Opportunity */}
            <div className="flex-1 min-w-[130px] bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4 text-center">
              <p className="text-xs text-zinc-500 mb-1">Opportunity</p>
              <p className="text-2xl font-semibold" style={{ color: CHART_ORANGE }}>{funnelTotals ? funnelTotals.opportunity.toLocaleString() : '\u2014'}</p>
              {funnelDeltas?.opportunity != null && (
                <p className="text-[10px] mt-1" style={{ color: funnelDeltas.opportunity > 0 ? CHART_GREEN : funnelDeltas.opportunity < 0 ? '#f87171' : CHART_AXIS }}>
                  {funnelDeltas.opportunity > 0 ? '+' : ''}{funnelDeltas.opportunity}% vs prior half
                </p>
              )}
            </div>
            {/* Arrow */}
            <div className="flex flex-col items-center px-1 shrink-0">
              <span className="text-xs font-medium text-zinc-400">
                {funnelTotals && funnelTotals.opportunity > 0 ? Math.round((funnelTotals.progressed / funnelTotals.opportunity) * 100) : '\u2014'}
              </span>
              <svg width="20" height="12" viewBox="0 0 20 12" className="text-zinc-600"><path d="M0 6h16M12 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </div>
            {/* Progressed */}
            <div className="flex-1 min-w-[130px] bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4 text-center">
              <p className="text-xs text-zinc-500 mb-1">Progressed</p>
              <p className="text-2xl font-semibold text-zinc-200">{funnelTotals ? funnelTotals.progressed.toLocaleString() : '\u2014'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Marketing KPI Cards */}
      {!loading && (funnelTotals || totalInRange > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          {/* CWI Rate */}
          <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">CWI Rate</p>
            <p className="text-2xl font-semibold" style={{ color: CHART_CYAN }}>
              {funnelTotals && funnelTotals.registered > 0 ? Math.round((funnelTotals.cwi / funnelTotals.registered) * 100) : '\u2014'}%
            </p>
            {(() => {
              if (!funnelChartData || funnelChartData.length < 4) return null;
              const mid = Math.floor(funnelChartData.length / 2);
              const f1 = funnelChartData.slice(0, mid);
              const f2 = funnelChartData.slice(mid);
              const r1 = f1.reduce((s, d) => s + d.registered, 0);
              const c1 = f1.reduce((s, d) => s + d.cwi, 0);
              const r2 = f2.reduce((s, d) => s + d.registered, 0);
              const c2 = f2.reduce((s, d) => s + d.cwi, 0);
              const rate1 = r1 > 0 ? (c1 / r1) * 100 : 0;
              const rate2 = r2 > 0 ? (c2 / r2) * 100 : 0;
              const d = rate2 - rate1;
              if (Math.abs(d) < 1) return null;
              return (
                <p className="text-[10px] mt-0.5" style={{ color: d > 0 ? CHART_GREEN : '#f87171' }}>
                  {d > 0 ? '+' : ''}{d.toFixed(1)}pp trend
                </p>
              );
            })()}
            <p className="text-xs text-zinc-500">registered &rarr; intent</p>
          </div>
          {/* Ad Spend Input */}
          <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">Ad Spend ($)</p>
            <div className="flex items-center gap-1">
              <span className="text-zinc-400 text-lg">$</span>
              <input
                type="number"
                value={adSpend}
                onChange={(e) => setAdSpend(e.target.value)}
                placeholder="0"
                className="bg-transparent border-b border-zinc-700 text-2xl font-semibold w-full focus:outline-none focus:border-[#06b6d4] text-zinc-200 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <p className="text-xs text-zinc-500">Facebook spend in range</p>
          </div>
          {/* CPR */}
          <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">CPR</p>
            {cprMetrics ? (
              <>
                <p className="text-2xl font-semibold" style={{ color: cprMetrics.cpr <= 5 ? CHART_GREEN : cprMetrics.cpr <= 10 ? CHART_AMBER : '#f87171' }}>
                  ${cprMetrics.cpr.toFixed(2)}
                </p>
                <div className="mt-1.5">
                  <div className="flex justify-between text-[10px] text-zinc-600 mb-0.5">
                    <span>$0</span>
                    <span className="text-zinc-400">goal: $5</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, (5 / Math.max(cprMetrics.cpr, 0.01)) * 100)}%`,
                        backgroundColor: cprMetrics.cpr <= 5 ? CHART_GREEN : cprMetrics.cpr <= 10 ? CHART_AMBER : '#f87171',
                      }}
                    />
                  </div>
                </div>
              </>
            ) : parseFloat(adSpend) > 0 && totalInRange > 0 ? (
              <>
                <p className="text-2xl font-semibold" style={{ color: (parseFloat(adSpend) / totalInRange) <= 5 ? '#00C805' : (parseFloat(adSpend) / totalInRange) <= 10 ? '#f59e0b' : '#f87171' }}>
                  ${(parseFloat(adSpend) / totalInRange).toFixed(2)}
                </p>
                <p className="text-[10px] text-zinc-600">based on registration count</p>
              </>
            ) : (
              <p className="text-2xl font-semibold text-zinc-600">&mdash;</p>
            )}
            <p className="text-xs text-zinc-500">cost per registration</p>
          </div>
          {/* CPI */}
          <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">CPI</p>
            {cprMetrics ? (
              <p className="text-2xl font-semibold text-zinc-200">${cprMetrics.cpi.toFixed(2)}</p>
            ) : (
              <p className="text-2xl font-semibold text-zinc-600">&mdash;</p>
            )}
            <p className="text-xs text-zinc-500">cost per intent</p>
          </div>
          {/* Avg Time to Intent */}
          <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">Avg Time to Intent</p>
            {funnelTotals?.avgHoursToBooking !== null && funnelTotals?.avgHoursToBooking !== undefined ? (
              <p className="text-2xl font-semibold text-zinc-200">
                {funnelTotals.avgHoursToBooking < 24
                  ? `${Math.round(funnelTotals.avgHoursToBooking)}h`
                  : `${(funnelTotals.avgHoursToBooking / 24).toFixed(1)}d`}
              </p>
            ) : (
              <p className="text-2xl font-semibold text-zinc-600">&mdash;</p>
            )}
            <p className="text-xs text-zinc-500">signup &rarr; first search</p>
          </div>
        </div>
      )}

      {/* Executive Insights */}
      {executiveInsights && !loading && (
        <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-5 mb-6">
          <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-400">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            Executive Insights
          </h3>
          <div className="space-y-2">
            {executiveInsights.map((insight, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 text-sm"
              >
                <span
                  className="mt-0.5 w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    backgroundColor:
                      insight.type === 'success' ? CHART_GREEN
                      : insight.type === 'warning' ? '#f87171'
                      : insight.type === 'action' ? CHART_ORANGE
                      : CHART_CYAN,
                  }}
                />
                <span className={cn(
                  'leading-relaxed',
                  insight.type === 'success' && 'text-zinc-300',
                  insight.type === 'warning' && 'text-zinc-300',
                  insight.type === 'action' && 'text-zinc-300',
                  insight.type === 'info' && 'text-zinc-400',
                )}>
                  {insight.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Funnel data error banner */}
      {funnelError && !loading && (
        <div className="bg-[#0d1117] border border-amber-500/30 rounded-lg p-4 mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm text-amber-400 font-medium">Funnel data unavailable</p>
            <p className="text-xs text-zinc-500 mt-0.5">{funnelError}. Showing registration metrics as fallback.</p>
          </div>
          <button
            onClick={fetchData}
            className="px-3 py-1.5 text-xs font-medium rounded-md text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: '#06b6d4' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Section: Funnel Health ── */}
      {/* Drop-off Analysis + At-Risk Users */}
      {dropoffAnalysis && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Funnel waterfall */}
          <div className="lg:col-span-2 bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-5">
            <h3 className="text-sm font-medium text-zinc-300 mb-4">Funnel Drop-off Analysis</h3>
            <div className="space-y-3">
              {dropoffAnalysis.map((stage, i) => (
                <div key={stage.label}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-zinc-300">{stage.label}</span>
                      <span className="text-xs text-zinc-500">{stage.count.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {i > 0 && (
                        <span className="text-[10px] text-zinc-500">
                          {stage.convFromPrev}% from {dropoffAnalysis[i - 1].label}
                          {stage.lost > 0 && <span className="text-red-400/70 ml-1">(-{stage.lost.toLocaleString()})</span>}
                        </span>
                      )}
                      <span className="text-xs font-medium" style={{ color: stage.color }}>{stage.pctOfTotal}%</span>
                    </div>
                  </div>
                  <div className="h-2 bg-zinc-800/50 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${stage.pctOfTotal}%`,
                        backgroundColor: stage.color,
                        opacity: 0.8,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* At-risk users */}
          {atRiskAnalysis && (
            <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-5">
              <h3 className="text-sm font-medium text-zinc-300 mb-4">At-Risk Users</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-zinc-400">Registered 3+ days, no intent</span>
                    <span className="text-sm font-semibold text-red-400">{atRiskAnalysis.noIntent.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800/50 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-red-400/70"
                      style={{ width: `${atRiskAnalysis.total > 0 ? Math.min(100, (atRiskAnalysis.noIntent / atRiskAnalysis.total) * 100) : 0}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-0.5">Target with re-engagement email or push notification</p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-zinc-400">Has intent, no watch set</span>
                    <span className="text-sm font-semibold" style={{ color: CHART_AMBER }}>{atRiskAnalysis.noWatch.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800/50 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ backgroundColor: CHART_AMBER, opacity: 0.7, width: `${atRiskAnalysis.total > 0 ? Math.min(100, (atRiskAnalysis.noWatch / atRiskAnalysis.total) * 100) : 0}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-0.5">Nudge to set up price monitoring</p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-zinc-400">Monitoring, no opportunity yet</span>
                    <span className="text-sm font-semibold" style={{ color: CHART_CYAN }}>{atRiskAnalysis.noOpp.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800/50 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ backgroundColor: CHART_CYAN, opacity: 0.7, width: `${atRiskAnalysis.total > 0 ? Math.min(100, (atRiskAnalysis.noOpp / atRiskAnalysis.total) * 100) : 0}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-0.5">Normal — waiting for price drops</p>
                </div>
                <div className="pt-2 border-t border-zinc-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Total users in funnel</span>
                    <span className="text-sm font-medium text-zinc-300">{atRiskAnalysis.total.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cohort Analysis + Conversion Velocity */}
      {(cohortAnalysis || velocityDistribution) && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Cohort table */}
          {cohortAnalysis && cohortAnalysis.length > 0 && (
            <div className="lg:col-span-2 bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-5 overflow-x-auto">
              <h3 className="text-sm font-medium text-zinc-300 mb-3">Weekly Cohort Conversion</h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-zinc-500 border-b border-zinc-800">
                    <th className="text-left py-2 pr-3 font-medium">Week of</th>
                    <th className="text-right py-2 px-2 font-medium">Registered</th>
                    <th className="text-right py-2 px-2 font-medium">CWI %</th>
                    <th className="text-right py-2 px-2 font-medium">Monitored %</th>
                    <th className="text-right py-2 px-2 font-medium">Opp %</th>
                    <th className="py-2 pl-3 font-medium">CWI Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const visible = cohortAnalysis.slice(-12);
                    const rates = visible.map(c => c.cwiRate);
                    const maxRate = Math.max(...rates);
                    const minRate = Math.min(...rates);
                    return visible.map(c => (
                    <tr key={c.key} className={cn(
                      "border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors",
                      c.cwiRate === maxRate && maxRate > 0 && "bg-[#00C80508]",
                      c.cwiRate === minRate && minRate < maxRate && "bg-[#f8717108]",
                    )}>
                      <td className="py-2 pr-3 text-zinc-300 font-medium">
                        {c.label}
                        {c.cwiRate === maxRate && maxRate > 0 && <span className="ml-1 text-[9px] align-top" style={{ color: CHART_GREEN }}>BEST</span>}
                        {c.cwiRate === minRate && minRate < maxRate && <span className="ml-1 text-[9px] align-top text-red-400/70">LOW</span>}
                      </td>
                      <td className="py-2 px-2 text-right text-zinc-400">{c.registered}</td>
                      <td className="py-2 px-2 text-right" style={{ color: CHART_CYAN }}>{c.cwiRate}%</td>
                      <td className="py-2 px-2 text-right" style={{ color: CHART_AMBER }}>{c.monitoredRate}%</td>
                      <td className="py-2 px-2 text-right" style={{ color: CHART_ORANGE }}>{c.oppRate}%</td>
                      <td className="py-2 pl-3">
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden w-16">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${c.cwiRate}%`, backgroundColor: CHART_CYAN, opacity: 0.8 }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ));
                  })()}
                </tbody>
              </table>
              {cohortAnalysis.length > 12 && (
                <p className="text-[10px] text-zinc-600 mt-2">Showing most recent 12 of {cohortAnalysis.length} cohorts</p>
              )}
            </div>
          )}

          {/* Conversion velocity */}
          {velocityDistribution && (
            <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-5">
              <h3 className="text-sm font-medium text-zinc-300 mb-3">Time to First Intent</h3>
              <p className="text-[10px] text-zinc-500 mb-4">How quickly users search after signup</p>
              <div className="space-y-3">
                {velocityDistribution.map(b => (
                  <div key={b.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-zinc-400 w-16">{b.label}</span>
                      <span className="text-xs text-zinc-500">{b.count} ({b.pct}%)</span>
                    </div>
                    <div className="h-2 bg-zinc-800/50 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${b.barWidth}%`,
                          backgroundColor: b.min < 24 ? CHART_GREEN : b.min < 72 ? CHART_CYAN : CHART_AMBER,
                          opacity: 0.8,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Channel Breakdown + Stalled Users */}
      {(channelBreakdown || stalledBreakdown) && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {/* Channel breakdown */}
          {channelBreakdown && (
            <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-5">
              <h3 className="text-sm font-medium text-zinc-300 mb-4">Channel Breakdown</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Flights</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Searches</span>
                      <span className="text-zinc-200 font-medium">{channelBreakdown.flights.bookings.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Watches</span>
                      <span className="text-zinc-200 font-medium">{channelBreakdown.flights.watches.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Opportunities</span>
                      <span className="text-zinc-200 font-medium">{channelBreakdown.flights.opps.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Hotels</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Searches</span>
                      <span className="text-zinc-200 font-medium">{channelBreakdown.hotels.bookings.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Watches</span>
                      <span className="text-zinc-200 font-medium">{channelBreakdown.hotels.watches.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Opportunities</span>
                      <span className="text-zinc-200 font-medium">{channelBreakdown.hotels.opps.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
              {/* User split visual */}
              <div className="pt-3 border-t border-zinc-800">
                <p className="text-[10px] text-zinc-500 mb-2">User Channel Mix</p>
                {channelBreakdown.totalActive > 0 ? (
                  <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
                    {channelBreakdown.userSplit.flightOnly > 0 && (
                      <div
                        className="rounded-full"
                        style={{
                          width: `${(channelBreakdown.userSplit.flightOnly / channelBreakdown.totalActive) * 100}%`,
                          backgroundColor: CHART_CYAN,
                          opacity: 0.8,
                        }}
                        title={`Flight only: ${channelBreakdown.userSplit.flightOnly}`}
                      />
                    )}
                    {channelBreakdown.userSplit.both > 0 && (
                      <div
                        className="rounded-full"
                        style={{
                          width: `${(channelBreakdown.userSplit.both / channelBreakdown.totalActive) * 100}%`,
                          backgroundColor: CHART_GREEN,
                          opacity: 0.8,
                        }}
                        title={`Both: ${channelBreakdown.userSplit.both}`}
                      />
                    )}
                    {channelBreakdown.userSplit.hotelOnly > 0 && (
                      <div
                        className="rounded-full"
                        style={{
                          width: `${(channelBreakdown.userSplit.hotelOnly / channelBreakdown.totalActive) * 100}%`,
                          backgroundColor: CHART_AMBER,
                          opacity: 0.8,
                        }}
                        title={`Hotel only: ${channelBreakdown.userSplit.hotelOnly}`}
                      />
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-600">No active users</p>
                )}
                <div className="flex items-center gap-4 mt-2 text-[10px] text-zinc-500">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_CYAN }} /> Flight only ({channelBreakdown.userSplit.flightOnly})</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_GREEN }} /> Both ({channelBreakdown.userSplit.both})</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_AMBER }} /> Hotel only ({channelBreakdown.userSplit.hotelOnly})</span>
                </div>
              </div>
            </div>
          )}

          {/* Stalled users by age */}
          {stalledBreakdown && (
            <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-5">
              <h3 className="text-sm font-medium text-zinc-300 mb-1">Stalled Users by Age</h3>
              <p className="text-[10px] text-zinc-500 mb-4">
                {stalledBreakdown.total.toLocaleString()} users registered but took no action
              </p>
              <div className="space-y-3">
                {stalledBreakdown.brackets.map(b => (
                  <div key={b.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-zinc-400">{b.label}</span>
                      <span className="text-xs text-zinc-500">{b.count} ({b.pct}%)</span>
                    </div>
                    <div className="h-2 bg-zinc-800/50 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${b.barWidth}%`,
                          backgroundColor: b.min < 7 ? CHART_AMBER : b.min < 14 ? CHART_ORANGE : '#f87171',
                          opacity: 0.8,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-3 border-t border-zinc-800">
                <p className="text-[10px] text-zinc-500">
                  Users stalled 7+ days are unlikely to convert organically. Target with re-engagement campaigns.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Funnel Trend Chart: Registration vs CWI */}
      <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-6">
        {error ? (
          <div className="text-center py-16">
            <p className="text-red-400 mb-2">{error}</p>
            <button
              onClick={fetchData}
              className="mt-3 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
              style={{ backgroundColor: CHART_CYAN }}
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="text-center py-16">
            <div className="inline-block animate-spin w-6 h-6 border-2 rounded-full mb-3" style={{ borderColor: CHART_CYAN, borderTopColor: 'transparent' }} />
            <p className="text-zinc-400 text-sm">{fetchProgress || 'Loading funnel data...'}</p>
          </div>
        ) : funnelChartData.length === 0 && chartData.length === 0 ? (
          <div className="text-center py-16 text-zinc-500">
            <p>No data available for this range</p>
          </div>
        ) : funnelChartData.length === 0 && chartData.length > 0 ? (
          <>
            <div className="flex items-center gap-4 mb-4">
              <h3 className="text-sm font-medium text-zinc-300">Registration Trend</h3>
              <span className="text-xs text-zinc-500">(Funnel breakdown unavailable &mdash; showing registrations)</span>
            </div>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1f2e" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#1a1f2e' }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#1a1f2e' }} allowDecimals={false} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : v.toLocaleString()} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: '#00C80540' }} />
                  <Bar dataKey="count" fill="#00C805" radius={[4, 4, 0, 0]} opacity={0.7} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-4 mb-4">
              <h3 className="text-sm font-medium text-zinc-300">Registration → Intent Conversion</h3>
              <div className="flex items-center gap-3 text-xs text-zinc-400">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: CHART_GREEN, opacity: 0.5 }} /> Registered</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHART_CYAN }} /> CWI</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5" style={{ backgroundColor: CHART_AMBER }} /> Monitored</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5" style={{ backgroundColor: CHART_ORANGE, opacity: 0.7 }} /> Opportunity</span>
              </div>
            </div>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={funnelChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
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
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : v.toLocaleString()}
                  />
                  <Tooltip content={<FunnelTooltip />} cursor={{ fill: CHART_GREEN_DIM }} />
                  <Bar dataKey="registered" fill={CHART_GREEN} radius={[4, 4, 0, 0]} opacity={0.35} />
                  <Line type="monotone" dataKey="cwi" stroke={CHART_CYAN} strokeWidth={2.5} dot={funnelChartData.length <= 60 ? { fill: CHART_CYAN, r: 3, strokeWidth: 0 } : false} />
                  <Line type="monotone" dataKey="monitored" stroke={CHART_AMBER} strokeWidth={2} dot={false} strokeDasharray="5 3" />
                  <Line type="monotone" dataKey="opportunity" stroke={CHART_ORANGE} strokeWidth={2} dot={false} strokeDasharray="3 3" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>

      {/* CWI Conversion Rate Over Time */}
      {funnelChartData.length > 0 && !loading && (
        <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-6 mt-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-4">CWI Conversion Rate Over Time</h3>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={funnelChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCwiRate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_CYAN} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={CHART_CYAN} stopOpacity={0} />
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
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  content={<CwiRateTooltip />}
                  cursor={{ stroke: CHART_CYAN + '40' }}
                />
                <Area
                  type="monotone"
                  dataKey="cwiRate"
                  stroke={CHART_CYAN}
                  strokeWidth={2}
                  fill="url(#colorCwiRate)"
                  dot={funnelChartData.length <= 60 ? { fill: CHART_CYAN, r: 2, strokeWidth: 0 } : false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Funnel Footer */}
      {!loading && (funnelTotals || totalInRange > 0) && (
        <p className="text-xs text-muted-foreground mt-3">
          Funnel: {(funnelTotals?.registered ?? totalInRange).toLocaleString()} registered{funnelTotals ? ` \u2192 ${funnelTotals.cwi.toLocaleString()} CWI (${funnelTotals.registered > 0 ? Math.round((funnelTotals.cwi / funnelTotals.registered) * 100) : 0}%)` : ''}
          {` \u00b7 ${dateRangeLabel}`}
          {` \u00b7 ${TIMEZONE_OPTIONS.find(o => o.value === timezone)?.label ?? timezone} time`}
        </p>
      )}
      </>)}
    </div>
  );
}
