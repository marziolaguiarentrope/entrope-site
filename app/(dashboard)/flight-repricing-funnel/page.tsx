'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import { cn, fromMinorUnits } from '@/lib/utils';
import {
  api,
  OnboardingFunnelUser,
  BusinessDashboardResponse,
  UserBasicInfo,
} from '@/lib/api';

// ── Constants ────────────────────────────────────────────

const FUNNEL_STAGES = [
  { key: 'signed_up', label: 'Registered', description: 'Created an account', color: '#6366f1' },
  { key: 'has_booking', label: 'CWI', description: 'Customer With Intent — forwarded a booking email', color: '#8b5cf6' },
  { key: 'has_watch', label: 'Monitored', description: 'Active price watch running on their booking', color: '#a78bfa' },
  { key: 'has_opportunity', label: 'Opportunity', description: 'Price drop found, user notified', color: '#c084fc' },
  { key: 'has_opportunity_progressed', label: 'Converted', description: 'Approved repricing or completed savings', color: '#00C805' },
] as const;

type FunnelStageKey = typeof FUNNEL_STAGES[number]['key'];

const CHART_GRID = '#1a1f2e';
const CHART_AXIS = '#6b7280';

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

function formatMoney(amountCents: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(fromMinorUnits(amountCents, currency));
}

function pct(num: number, denom: number): string {
  if (denom === 0) return '0%';
  return `${((num / denom) * 100).toFixed(1)}%`;
}

function pctNum(num: number, denom: number): number {
  if (denom === 0) return 0;
  return (num / denom) * 100;
}

function formatHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return '<1h';
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Determine furthest funnel stage (includes hotel + flight data) */
function getUserFunnelStage(user: OnboardingFunnelUser): FunnelStageKey {
  const totalOpps = user.flight_opps + user.hotel_opps;
  if (totalOpps > 0) {
    const progressedStatuses = ['accepted', 'executing', 'awaiting_customer', 'awaiting_cancellation', 'completed', 'needs_intervention'];
    const hasProgressed = progressedStatuses.some(s =>
      (user.flight_opp_statuses[s] || 0) > 0 || (user.hotel_opp_statuses[s] || 0) > 0
    );
    if (hasProgressed) return 'has_opportunity_progressed';
    return 'has_opportunity';
  }
  if (user.flight_watches > 0 || user.hotel_watches > 0) return 'has_watch';
  if (user.flight_bookings > 0 || user.hotel_bookings > 0) return 'has_booking';
  return 'signed_up';
}

/** Median of an array of numbers */
function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Badge Components ─────────────────────────────────────

function StageBadge({ stage }: { stage: FunnelStageKey }) {
  const info = FUNNEL_STAGES.find(s => s.key === stage);
  if (!info) return null;
  return (
    <span
      className="px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap"
      style={{ backgroundColor: info.color + '20', color: info.color }}
    >
      {info.label}
    </span>
  );
}

// ── Funnel Chart Tooltip ─────────────────────────────────

function FunnelTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label: string; count: number; description: string; pctOfTotal: string; dropOff: string } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg px-3 py-2 shadow-xl">
      <p className="text-sm font-medium text-zinc-200 mb-1">{d.label}</p>
      <p className="text-xs text-zinc-400 mb-1.5">{d.description}</p>
      <p className="text-lg font-semibold text-zinc-100">{d.count.toLocaleString()} users</p>
      <div className="flex gap-3 mt-1 text-xs">
        <span className="text-zinc-400">{d.pctOfTotal} of registrations</span>
        {d.dropOff && <span className="text-red-400">{d.dropOff} drop-off</span>}
      </div>
    </div>
  );
}

// ── KPI Card ─────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={cn('text-2xl font-semibold', accent || 'text-foreground')}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────

export default function FlightRepricingFunnelPage() {
  const [dashboard, setDashboard] = useState<BusinessDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);
  const [selectedStage, setSelectedStage] = useState<FunnelStageKey | null>(null);
  const [search, setSearch] = useState('');
  const [userInfoMap, setUserInfoMap] = useState<Map<string, UserBasicInfo>>(new Map());
  const [enriching, setEnriching] = useState(false);
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dashboardRes = await api.getBusinessDashboard(days);
      setDashboard(dashboardRes);

      const funnelUsers = dashboardRes.onboarding_funnel?.users || [];
      if (funnelUsers.length > 0) {
        setEnriching(true);
        api.batchGetUserBasicInfo(funnelUsers.map(u => u.user_id))
          .then(setUserInfoMap)
          .catch(() => {})
          .finally(() => setEnriching(false));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(fetchData, 60_000);
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [fetchData]);
  useEffect(() => { setSelectedStage(null); setSearch(''); }, [days]);

  // ── Derived data ───────────────────────────────────────

  const funnel = dashboard?.onboarding_funnel;
  const summary = funnel?.summary;
  const users = funnel?.users || [];

  // Funnel chart data
  const funnelChartData = useMemo(() => {
    if (!summary) return [];
    return FUNNEL_STAGES.map((stage, i) => {
      const count = summary[stage.key as keyof typeof summary] ?? 0;
      const total = summary.signed_up || 1;
      const prevCount = i > 0 ? (summary[FUNNEL_STAGES[i - 1].key as keyof typeof summary] ?? 0) : 0;
      return {
        key: stage.key,
        label: stage.label,
        description: stage.description,
        count: count as number,
        color: stage.color,
        pctOfTotal: pct(count as number, total),
        dropOff: i > 0 && prevCount > 0 ? pct((prevCount as number) - (count as number), prevCount as number) : '',
      };
    });
  }, [summary]);

  // Conversion velocity stats
  const velocityStats = useMemo(() => {
    const bookingTimes = users.filter(u => u.hours_to_first_booking !== null).map(u => u.hours_to_first_booking!);
    const oppTimes = users.filter(u => u.hours_to_first_opp !== null).map(u => u.hours_to_first_opp!);
    return {
      medianToBooking: median(bookingTimes),
      medianToOpp: median(oppTimes),
      bookingSampleSize: bookingTimes.length,
      oppSampleSize: oppTimes.length,
    };
  }, [users]);

  // Users by stage breakdown
  const usersByStage = useMemo(() => {
    const counts: Record<FunnelStageKey, number> = {
      signed_up: 0, has_booking: 0, has_watch: 0, has_opportunity: 0, has_opportunity_progressed: 0,
    };
    for (const u of users) {
      counts[getUserFunnelStage(u)]++;
    }
    return counts;
  }, [users]);

  // At-risk users: signed up > 3 days ago, no booking
  const atRiskUsers = useMemo(() => {
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    return users.filter(u => {
      const stage = getUserFunnelStage(u);
      return stage === 'signed_up' && new Date(u.signed_up).getTime() < threeDaysAgo;
    });
  }, [users]);

  // Revenue & savings from live fields
  const revenue = dashboard?.revenue_usd_cents;
  const msr = dashboard?.msr;
  const activeUsers = dashboard?.active_users;

  // Filter + sort users for drill-down
  const filteredUsers = useMemo(() => {
    let result = [...users];
    if (selectedStage) result = result.filter(u => getUserFunnelStage(u) === selectedStage);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(u => {
        const info = userInfoMap.get(u.user_id);
        return u.email.toLowerCase().includes(q) || u.user_id.toLowerCase().includes(q) ||
          info?.name?.toLowerCase().includes(q) || info?.phone?.toLowerCase().includes(q);
      });
    }
    return result;
  }, [users, selectedStage, search, userInfoMap]);

  const sortedUsers = useMemo(() => {
    const order: Record<FunnelStageKey, number> = {
      signed_up: 0, has_booking: 1, has_watch: 2, has_opportunity: 3, has_opportunity_progressed: 4,
    };
    return [...filteredUsers].sort((a, b) => {
      const diff = (order[getUserFunnelStage(b)] ?? 0) - (order[getUserFunnelStage(a)] ?? 0);
      if (diff !== 0) return diff;
      return new Date(b.signed_up).getTime() - new Date(a.signed_up).getTime();
    });
  }, [filteredUsers]);

  // ── Render ─────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Marketing Funnel</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Registration → CWI → Monitoring → Opportunity → Conversion
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-3 py-2 text-sm font-medium bg-accent/50 rounded-lg hover:bg-accent disabled:opacity-30 transition-colors"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="bg-card border border-border rounded-lg p-6 text-center">
          <p className="text-red-400 mb-2">{error}</p>
          <button onClick={fetchData} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            Retry
          </button>
        </div>
      ) : loading && !dashboard ? (
        <div className="bg-card border border-border rounded-lg p-6 text-center text-muted-foreground">
          Loading marketing funnel data...
        </div>
      ) : (
        <>
          {/* ── KPI Row ────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <KpiCard
              label="Registrations"
              value={summary?.signed_up?.toLocaleString() ?? '—'}
              sub={`Last ${days} days`}
            />
            <KpiCard
              label="CWI Rate"
              value={summary ? pct(summary.has_booking, summary.signed_up) : '—'}
              sub={summary ? `${summary.has_booking} of ${summary.signed_up} registered` : undefined}
              accent={summary && pctNum(summary.has_booking, summary.signed_up) > 20 ? 'text-green-400' : 'text-yellow-400'}
            />
            <KpiCard
              label="Monitoring Rate"
              value={summary ? pct(summary.has_watch, summary.has_booking) : '—'}
              sub={summary ? `${summary.has_watch} of ${summary.has_booking} CWI` : undefined}
            />
            <KpiCard
              label="Opportunity Rate"
              value={summary ? pct(summary.has_opportunity, summary.has_watch) : '—'}
              sub={summary ? `${summary.has_opportunity} opportunities found` : undefined}
            />
            <KpiCard
              label="Money Saved (Total)"
              value={msr ? formatMoney(msr.total.last_period, 'USD') : '—'}
              sub={msr ? `prev: ${formatMoney(msr.total.prev_period, 'USD')}` : undefined}
              accent="text-green-400"
            />
            <KpiCard
              label="Revenue"
              value={revenue ? formatMoney(revenue.last_period, 'USD') : '—'}
              sub={revenue ? `prev: ${formatMoney(revenue.prev_period, 'USD')}` : undefined}
              accent="text-green-400"
            />
          </div>

          {/* ── Conversion Velocity ───────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Median Time to CWI</p>
              <p className="text-xl font-semibold text-foreground">
                {formatHours(velocityStats.medianToBooking)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {velocityStats.bookingSampleSize} users converted
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Median Time to Opportunity</p>
              <p className="text-xl font-semibold text-foreground">
                {formatHours(velocityStats.medianToOpp)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {velocityStats.oppSampleSize} users reached
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Active Users</p>
              <p className="text-xl font-semibold text-foreground">
                {activeUsers?.last_period?.toLocaleString() ?? '—'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                prev: {activeUsers?.prev_period?.toLocaleString() ?? '—'}
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">At-Risk (No CWI &gt;3d)</p>
              <p className={cn('text-xl font-semibold', atRiskUsers.length > 0 ? 'text-orange-400' : 'text-green-400')}>
                {atRiskUsers.length}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {summary ? pct(atRiskUsers.length, summary.signed_up) : '—'} of registrations
              </p>
            </div>
          </div>

          {/* ── Funnel Chart ──────────────────────────────── */}
          <div className="bg-card border border-border rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold mb-1">Conversion Funnel</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Last {days} days — click a bar to filter the user table below
            </p>

            {funnelChartData.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelChartData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_AXIS }} tickLine={false} axisLine={{ stroke: CHART_GRID }} />
                    <YAxis tick={{ fontSize: 11, fill: CHART_AXIS }} tickLine={false} axisLine={{ stroke: CHART_GRID }} allowDecimals={false} />
                    <Tooltip content={<FunnelTooltip />} cursor={{ fill: '#ffffff08' }} />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]} cursor="pointer"
                      onClick={(data) => {
                        const key = data?.key as FunnelStageKey | undefined;
                        if (key) setSelectedStage(prev => prev === key ? null : key);
                      }}
                    >
                      {funnelChartData.map((entry) => (
                        <Cell
                          key={entry.key}
                          fill={entry.color}
                          opacity={selectedStage && selectedStage !== entry.key ? 0.3 : 0.85}
                          stroke={selectedStage === entry.key ? '#ffffff' : 'transparent'}
                          strokeWidth={selectedStage === entry.key ? 2 : 0}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">No funnel data available</div>
            )}

            {/* Stage cards */}
            {funnelChartData.length > 0 && (
              <div className="grid grid-cols-5 gap-2 mt-4">
                {funnelChartData.map((stage, i) => (
                  <button
                    key={stage.key}
                    onClick={() => setSelectedStage(prev => prev === stage.key ? null : (stage.key as FunnelStageKey))}
                    className={cn(
                      'rounded-lg p-3 text-left transition-all border',
                      selectedStage === stage.key ? 'border-white/30 bg-accent/50' : 'border-border hover:border-border/80 hover:bg-accent/20',
                    )}
                  >
                    <div className="text-2xl font-bold" style={{ color: stage.color }}>{stage.count.toLocaleString()}</div>
                    <div className="text-xs font-medium text-foreground mt-0.5">{stage.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {stage.pctOfTotal}
                      {i > 0 && stage.dropOff && <span className="text-red-400 ml-1">({stage.dropOff} drop)</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── User Drill-Down Table ─────────────────────── */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">
                  {selectedStage ? `Users: ${FUNNEL_STAGES.find(s => s.key === selectedStage)?.label}` : 'All Funnel Users'}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sortedUsers.length} user{sortedUsers.length !== 1 ? 's' : ''}
                  {enriching && ' · loading names...'}
                  {selectedStage && (
                    <button onClick={() => setSelectedStage(null)} className="ml-2 text-primary hover:underline">Clear filter</button>
                  )}
                </p>
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search email, name, phone..."
                className="max-w-xs px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border bg-accent/30">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">User</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Stage</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Signed Up</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">Flights</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">Hotels</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">Watches</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">Opps</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Time to CWI</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Time to Opp</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.slice(0, 100).map(user => {
                    const info = userInfoMap.get(user.user_id);
                    const stage = getUserFunnelStage(user);
                    return (
                      <tr key={user.user_id} className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors">
                        <td className="px-3 py-2.5">
                          <Link href={`/users-list/${user.user_id}`} className="text-sm text-primary hover:underline block truncate max-w-[200px]">
                            {info?.name || user.email}
                          </Link>
                          {info?.name && <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">{user.email}</div>}
                        </td>
                        <td className="px-3 py-2.5"><StageBadge stage={stage} /></td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(user.signed_up)}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={cn('text-sm font-mono', user.flight_bookings > 0 ? 'text-foreground' : 'text-muted-foreground/50')}>
                            {user.flight_bookings}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={cn('text-sm font-mono', user.hotel_bookings > 0 ? 'text-foreground' : 'text-muted-foreground/50')}>
                            {user.hotel_bookings}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={cn('text-sm font-mono', (user.flight_watches + user.hotel_watches) > 0 ? 'text-foreground' : 'text-muted-foreground/50')}>
                            {user.flight_watches + user.hotel_watches}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={cn('text-sm font-mono', (user.flight_opps + user.hotel_opps) > 0 ? 'text-foreground font-medium' : 'text-muted-foreground/50')}>
                            {user.flight_opps + user.hotel_opps}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatHours(user.hours_to_first_booking)}</td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatHours(user.hours_to_first_opp)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {sortedUsers.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                {search ? 'No users match your search' : 'No users in this funnel stage'}
              </div>
            )}
            {sortedUsers.length > 100 && (
              <p className="text-xs text-muted-foreground mt-2">Showing first 100 of {sortedUsers.length} users</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
