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
import { api } from '@/lib/api';
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
      const lifetimePromise = api.listUsers({ limit: 1 }).then(r => r.total_count).catch(() => 0);

      // Fetch the earliest user to compute lifetime duration
      // Use created_after with a very early date to get the first user chronologically
      const firstUserPromise = api.listUsers({ limit: 1, created_after: '2020-01-01T00:00:00Z' })
        .then(r => r.members?.[0]?.created_at ?? null)
        .catch(() => null);

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
    let rangeDays = 1;
    if (effectiveDates.start) {
      rangeDays = Math.max(1, (effectiveDates.end.getTime() - effectiveDates.start.getTime()) / (1000 * 60 * 60 * 24));
    }
    const dailyRateInRange = totalInRange / rangeDays;

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
      lifetimeDailyAvg,
      lifetimeDays,
      vsLifetime,
    };
  }, [totalInRange, chartData, granularity, effectiveDates, lifetimeTotal, lifetimeFirstDate]);

  // Export handlers
  function handleExport(type: 'chart_csv' | 'json') {
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
          {!loading && chartData.length > 0 && (
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
                {Math.floor(stats.lifetimeDays)} days ago
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
            <p className="text-xs text-zinc-500">{chartData.length} {stats.granLabel}s</p>
          </div>
          <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">Daily Rate</p>
            <p className="text-2xl font-semibold text-zinc-200">{stats.dailyRateInRange.toFixed(1)}</p>
            <p className="text-xs text-zinc-500">/day in range</p>
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
          Showing {totalInRange.toLocaleString()} new users from {dateRangeLabel}
          {` \u00b7 ${TIMEZONE_OPTIONS.find(o => o.value === timezone)?.label ?? timezone} time`}
          {lifetimeTotal > 0 && ` \u00b7 ${lifetimeTotal.toLocaleString()} lifetime users`}
        </p>
      )}
    </div>
  );
}
