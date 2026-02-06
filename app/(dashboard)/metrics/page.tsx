'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
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
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────

type DateRange = '7d' | '30d' | '90d' | '6m' | '1y' | 'all' | 'custom';
type Granularity = 'hourly' | 'daily' | 'weekly' | 'monthly';
type ChartMode = 'cumulative' | 'new';
type Timezone = 'UTC' | 'America/New_York' | 'America/Chicago' | 'America/Los_Angeles';

interface ChartDataPoint {
  date: string;       // display label
  dateRaw: string;    // ISO date for sorting
  count: number;      // new users in this bucket
  cumulative: number; // running total
}

// ── Constants ────────────────────────────────────────────

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '6m', label: 'Last 6 months' },
  { value: '1y', label: 'Last year' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
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

const STATUS_OPTIONS = [
  { value: null, label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'banned', label: 'Banned' },
  { value: 'deactivated', label: 'Deactivated' },
] as const;

// ── Helpers ──────────────────────────────────────────────

/** Extract year/month/day/hour/dayOfWeek in a given timezone */
function getPartsInTz(date: Date, tz: Timezone): { year: number; month: number; day: number; hour: number; dayOfWeek: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: parseInt(get('year')),
    month: parseInt(get('month')),
    day: parseInt(get('day')),
    hour: parseInt(get('hour')) % 24, // handle "24" edge case
    dayOfWeek: weekdayMap[get('weekday')] ?? 0,
  };
}

function getDateRange(range: DateRange): { start: Date | null; end: Date } {
  const now = new Date();
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
      // Get Monday of the week
      const diff = p.dayOfWeek === 0 ? -6 : 1 - p.dayOfWeek;
      const monday = new Date(date);
      monday.setDate(monday.getDate() + diff);
      const mp = getPartsInTz(monday, tz);
      const wy = mp.year;
      const wm = String(mp.month).padStart(2, '0');
      const wd = String(mp.day).padStart(2, '0');
      return `${wy}-${wm}-${wd}`;
    }
    case 'monthly':
      return `${year}-${month}-01`;
  }
}

function formatBucketLabel(key: string, granularity: Granularity): string {
  if (granularity === 'hourly') {
    // key is like "2026-02-05T14" — parse as parts directly
    const [datePart, hourPart] = key.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    const h = parseInt(hourPart);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[m]} ${d}, ${h12} ${ampm}`;
  }

  // For daily/weekly/monthly, parse the date string directly (no timezone conversion needed — it's already a label)
  const [y, m, d] = key.split('-').map(Number);
  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  switch (granularity) {
    case 'daily':
      return `${monthNames[m]} ${d}`;
    case 'weekly':
      return `Week of ${monthNames[m]} ${d}`;
    case 'monthly':
      return `${monthNames[m]} ${y}`;
  }
}

function formatDateForInput(date: Date): string {
  return date.toISOString().split('T')[0];
}

// ── Main Page ────────────────────────────────────────────

export default function MetricsPage() {
  // Controls
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>('cumulative');
  const [timezone, setTimezone] = useState<Timezone>('UTC');

  // Data
  const [allUsers, setAllUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchProgress, setFetchProgress] = useState<string | null>(null);

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
      const date = new Date(user.created_at);
      if (isNaN(date.getTime())) continue;
      const key = getBucketKey(date, granularity, timezone);
      buckets[key] = (buckets[key] || 0) + 1;
    }

    // Sort bucket keys chronologically
    const sortedKeys = Object.keys(buckets).sort();
    if (sortedKeys.length === 0) return [];

    // Fill gaps: generate all bucket keys between first and last
    // We iterate using a simple counter to avoid timezone conversion issues in the gap filler
    const allKeys: string[] = [];
    const firstKey = sortedKeys[0];
    const lastKey = sortedKeys[sortedKeys.length - 1];

    // For gap filling, use a UTC cursor and convert each step via getBucketKey
    // Start from the earliest user's created_at that maps to firstKey
    const first = granularity === 'hourly'
      ? new Date(firstKey + ':00:00Z')
      : new Date(firstKey + 'T00:00:00Z');
    const last = granularity === 'hourly'
      ? new Date(lastKey + ':00:00Z')
      : new Date(lastKey + 'T00:00:00Z');
    // Add buffer for timezone offset (up to 12h ahead)
    last.setHours(last.getHours() + 14);

    const cursor = new Date(first);
    const seen = new Set<string>();
    while (cursor <= last) {
      const key = getBucketKey(cursor, granularity, timezone);
      if (!seen.has(key)) {
        seen.add(key);
        allKeys.push(key);
      }
      // Stop once we've passed the last actual key
      if (key > lastKey && !buckets[key]) break;
      switch (granularity) {
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

    // Growth rate: compare first half to second half
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

  // Date range display string
  const dateRangeLabel = useMemo(() => {
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (effectiveDates.start) {
      return `${fmt(effectiveDates.start)} \u2013 ${fmt(effectiveDates.end)}`;
    }
    return `All time through ${fmt(effectiveDates.end)}`;
  }, [effectiveDates]);

  // Custom tooltip component
  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-sm font-medium">
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

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-4">
        {/* Date Range */}
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRange)}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {DATE_RANGE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Custom date inputs */}
        {dateRange === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <input
              type="date"
              value={customEnd || formatDateForInput(new Date())}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
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

        {/* Timezone Toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          {TIMEZONE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setTimezone(opt.value)}
              className={cn(
                'px-2.5 py-2 text-sm font-medium transition-colors',
                timezone === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent'
              )}
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
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-accent'
            )}
          >
            Cumulative
          </button>
          <button
            onClick={() => setChartMode('new')}
            className={cn(
              'px-3 py-2 text-sm font-medium transition-colors',
              chartMode === 'new'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-accent'
            )}
          >
            New Users
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      {!loading && !error && filteredUsers.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Users</p>
            <p className="text-2xl font-semibold">{stats.totalInRange.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground mb-1">Time Periods</p>
            <p className="text-2xl font-semibold">{chartData.length}</p>
            <p className="text-xs text-muted-foreground">{stats.granLabel}s</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground mb-1">Avg per {stats.granLabel}</p>
            <p className="text-2xl font-semibold">{stats.avgPerPeriod}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground mb-1">Growth Rate</p>
            {stats.growthRate !== null ? (
              <p className={cn(
                'text-2xl font-semibold',
                stats.growthRate > 0 ? 'text-green-400' : stats.growthRate < 0 ? 'text-red-400' : ''
              )}>
                {stats.growthRate > 0 ? '+' : ''}{stats.growthRate.toFixed(0)}%
              </p>
            ) : (
              <p className="text-2xl font-semibold text-muted-foreground">—</p>
            )}
            <p className="text-xs text-muted-foreground">2nd half vs 1st half</p>
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="bg-card border border-border rounded-lg p-6">
        {error ? (
          <div className="text-center py-16">
            <p className="text-red-400 mb-2">{error}</p>
            <button
              onClick={fetchData}
              className="mt-3 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="text-center py-16">
            <div className="inline-block animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mb-3" />
            <p className="text-muted-foreground text-sm">{fetchProgress || 'Loading...'}</p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p>No users found in the selected date range</p>
          </div>
        ) : (
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              {chartMode === 'cumulative' ? (
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCumulative" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#colorCumulative)"
                    dot={chartData.length <= 60}
                  />
                </AreaChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar
                    dataKey="count"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                    opacity={0.8}
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
