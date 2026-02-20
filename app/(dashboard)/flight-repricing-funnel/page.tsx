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
  RepricingPipelineIssue,
  RepricingPipelineResponse,
  UserBasicInfo,
} from '@/lib/api';

// ── Constants ────────────────────────────────────────────

const FUNNEL_STAGES = [
  { key: 'signed_up', label: 'Signed Up', description: 'Users who created an account', color: '#6366f1' },
  { key: 'has_booking', label: 'Has Flight Booking', description: 'Forwarded a flight confirmation email', color: '#8b5cf6' },
  { key: 'has_watch', label: 'Being Monitored', description: 'Active price watch running', color: '#a78bfa' },
  { key: 'has_opportunity', label: 'Opportunity Found', description: 'Price drop detected, user notified', color: '#c084fc' },
  { key: 'has_opportunity_progressed', label: 'Progressed', description: 'User approved or repricing completed', color: '#00C805' },
] as const;

type FunnelStageKey = typeof FUNNEL_STAGES[number]['key'];

// Opportunity status groupings for the detail breakdown
const OPP_STATUS_GROUPS = {
  awaiting_action: { label: 'Awaiting User Action', statuses: ['active'], color: 'text-blue-400', bg: 'bg-blue-500/20' },
  approved: { label: 'Approved / In Progress', statuses: ['accepted', 'executing', 'awaiting_customer', 'awaiting_cancellation'], color: 'text-purple-400', bg: 'bg-purple-500/20' },
  completed: { label: 'Completed', statuses: ['completed'], color: 'text-green-400', bg: 'bg-green-500/20' },
  needs_attention: { label: 'Needs Attention', statuses: ['needs_intervention', 'failed'], color: 'text-orange-400', bg: 'bg-orange-500/20' },
  terminal: { label: 'Declined / Expired / Other', statuses: ['declined', 'expired', 'withdrawn', 'cancelled'], color: 'text-zinc-400', bg: 'bg-zinc-500/20' },
} as const;

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
  }).format(fromMinorUnits(amountCents, currency));
}

function pct(num: number, denom: number): string {
  if (denom === 0) return '0%';
  return `${((num / denom) * 100).toFixed(1)}%`;
}

/** Get which funnel stage a user is currently at (furthest reached) */
function getUserFunnelStage(user: OnboardingFunnelUser): FunnelStageKey {
  if (user.flight_opps > 0) {
    // Check if any opp has progressed beyond 'active'
    const progressedStatuses = ['accepted', 'executing', 'awaiting_customer', 'awaiting_cancellation', 'completed', 'needs_intervention'];
    const hasProgressed = progressedStatuses.some(s => (user.flight_opp_statuses[s] || 0) > 0);
    if (hasProgressed) return 'has_opportunity_progressed';
    return 'has_opportunity';
  }
  if (user.flight_watches > 0) return 'has_watch';
  if (user.flight_bookings > 0) return 'has_booking';
  return 'signed_up';
}

/** Get all flight opportunity statuses for a user as a sorted array */
function getOppStatusBreakdown(user: OnboardingFunnelUser): { status: string; count: number }[] {
  return Object.entries(user.flight_opp_statuses || {})
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}

// ── StatusBadge ──────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-blue-500/20 text-blue-400',
    accepted: 'bg-indigo-500/20 text-indigo-400',
    executing: 'bg-purple-500/20 text-purple-400',
    awaiting_customer: 'bg-yellow-500/20 text-yellow-400',
    awaiting_cancellation: 'bg-amber-500/20 text-amber-400',
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

// ── Pipeline Issue Row ───────────────────────────────────

function IssueTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    no_watch: 'bg-yellow-500/20 text-yellow-400',
    watch_stale: 'bg-orange-500/20 text-orange-400',
    watch_failing: 'bg-red-500/20 text-red-400',
    opp_stuck: 'bg-purple-500/20 text-purple-400',
    opp_expired: 'bg-zinc-500/20 text-zinc-400',
    booking_unverified: 'bg-blue-500/20 text-blue-400',
    booking_pending: 'bg-amber-500/20 text-amber-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap', colors[type] || 'bg-zinc-500/20 text-zinc-400')}>
      {type.replace(/_/g, ' ')}
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
        <span className="text-zinc-400">{d.pctOfTotal} of signups</span>
        {d.dropOff && <span className="text-red-400">{d.dropOff} drop-off</span>}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────

export default function FlightRepricingFunnelPage() {
  // Data
  const [dashboard, setDashboard] = useState<BusinessDashboardResponse | null>(null);
  const [pipelineData, setPipelineData] = useState<RepricingPipelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);

  // Drill-down state
  const [selectedStage, setSelectedStage] = useState<FunnelStageKey | null>(null);
  const [selectedIssueType, setSelectedIssueType] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // User info enrichment
  const [userInfoMap, setUserInfoMap] = useState<Map<string, UserBasicInfo>>(new Map());
  const [enriching, setEnriching] = useState(false);

  // Auto-refresh
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);

  // Fetch all data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [dashboardRes, pipelineRes] = await Promise.all([
        api.getBusinessDashboard(days),
        api.getRepricingPipelineIssues().catch(() => null),
      ]);

      setDashboard(dashboardRes);
      setPipelineData(pipelineRes);

      // Enrich user info for funnel users (non-blocking)
      const funnelUsers = dashboardRes.onboarding_funnel?.users || [];
      if (funnelUsers.length > 0) {
        setEnriching(true);
        const userIds = funnelUsers.map(u => u.user_id);
        api.batchGetUserBasicInfo(userIds)
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

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(fetchData, 60_000);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [fetchData]);

  // Reset drill-down when days changes
  useEffect(() => {
    setSelectedStage(null);
    setSelectedIssueType(null);
    setSearch('');
  }, [days]);

  // ── Derived data ───────────────────────────────────────

  const funnel = dashboard?.onboarding_funnel;
  const funnelSummary = funnel?.summary;
  const funnelUsers = funnel?.users || [];

  // Build funnel chart data
  const funnelChartData = useMemo(() => {
    if (!funnelSummary) return [];
    return FUNNEL_STAGES.map((stage, i) => {
      const count = funnelSummary[stage.key as keyof typeof funnelSummary] ?? 0;
      const total = funnelSummary.signed_up || 1;
      const prevCount = i > 0 ? (funnelSummary[FUNNEL_STAGES[i - 1].key as keyof typeof funnelSummary] ?? 0) : 0;
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
  }, [funnelSummary]);

  // Aggregate opportunity status breakdown across all funnel users
  const oppStatusAggregates = useMemo(() => {
    const agg: Record<string, number> = {};
    for (const user of funnelUsers) {
      for (const [status, count] of Object.entries(user.flight_opp_statuses || {})) {
        agg[status] = (agg[status] || 0) + count;
      }
    }
    return Object.entries(agg)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }, [funnelUsers]);

  // Total flight opportunities across all users
  const totalFlightOpps = useMemo(() => {
    return funnelUsers.reduce((sum, u) => sum + u.flight_opps, 0);
  }, [funnelUsers]);

  // Filter users for drill-down table
  const filteredUsers = useMemo(() => {
    let users = [...funnelUsers];

    // Filter by selected funnel stage
    if (selectedStage) {
      users = users.filter(u => getUserFunnelStage(u) === selectedStage);
    }

    // Filter by search
    if (search) {
      const q = search.toLowerCase();
      users = users.filter(u => {
        const info = userInfoMap.get(u.user_id);
        return (
          u.email.toLowerCase().includes(q) ||
          u.user_id.toLowerCase().includes(q) ||
          info?.name?.toLowerCase().includes(q) ||
          info?.phone?.toLowerCase().includes(q)
        );
      });
    }

    return users;
  }, [funnelUsers, selectedStage, search, userInfoMap]);

  // Sort users: those with most progression issues first
  const sortedUsers = useMemo(() => {
    return [...filteredUsers].sort((a, b) => {
      // Sort by funnel stage (higher = better)
      const stageOrder: Record<FunnelStageKey, number> = {
        signed_up: 0,
        has_booking: 1,
        has_watch: 2,
        has_opportunity: 3,
        has_opportunity_progressed: 4,
      };
      const aStage = stageOrder[getUserFunnelStage(a)] ?? 0;
      const bStage = stageOrder[getUserFunnelStage(b)] ?? 0;
      if (aStage !== bStage) return bStage - aStage; // Higher stage first

      // Then by recency
      return new Date(b.signed_up).getTime() - new Date(a.signed_up).getTime();
    });
  }, [filteredUsers]);

  // Pipeline issues filtered to flight-related
  const flightPipelineIssues = useMemo(() => {
    if (!pipelineData) return [];
    return pipelineData.issues.filter(i => i.booking_type === 'flight' || i.booking_type === null);
  }, [pipelineData]);

  // Pipeline issues filtered by selected type
  const filteredIssues = useMemo(() => {
    if (!selectedIssueType) return flightPipelineIssues;
    return flightPipelineIssues.filter(i => i.issue_type === selectedIssueType);
  }, [flightPipelineIssues, selectedIssueType]);

  // Pipeline issue type counts
  const issueTypeCounts = useMemo(() => {
    const counts: Record<string, { count: number; label: string }> = {};
    for (const issue of flightPipelineIssues) {
      if (!counts[issue.issue_type]) {
        counts[issue.issue_type] = { count: 0, label: issue.label };
      }
      counts[issue.issue_type].count++;
    }
    return Object.entries(counts)
      .map(([type, { count, label }]) => ({ type, count, label }))
      .sort((a, b) => b.count - a.count);
  }, [flightPipelineIssues]);

  // ── Render ─────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Flight Repricing Funnel</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visualize the full flight repricing pipeline from email forwarding to completion
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Days selector */}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-3 py-2 text-sm font-medium bg-accent/50 rounded-lg hover:bg-accent disabled:opacity-30 transition-colors"
          >
            {loading ? 'Loading...' : '↻ Refresh'}
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
          Loading flight repricing funnel...
        </div>
      ) : (
        <>
          {/* ── Summary Stats Row ─────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
            {/* Bookings */}
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Flight Bookings</p>
              <p className="text-2xl font-semibold text-foreground">
                {dashboard?.bookings?.flights.current.toLocaleString() ?? '—'}
              </p>
              {dashboard?.bookings?.flights && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  +{dashboard.bookings.flights.last_7} last 7d
                </p>
              )}
            </div>

            {/* Monitored */}
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Being Monitored</p>
              <p className="text-2xl font-semibold text-foreground">
                {dashboard?.bookings?.monitored.current.toLocaleString() ?? '—'}
              </p>
              {dashboard?.bookings?.monitored && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  +{dashboard.bookings.monitored.last_7} last 7d
                </p>
              )}
            </div>

            {/* Flight Opps */}
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Flight Opportunities</p>
              <p className="text-2xl font-semibold text-foreground">
                {dashboard?.opportunities?.flights.current.toLocaleString() ?? '—'}
              </p>
              {dashboard?.opportunities?.flights && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  +{dashboard.opportunities.flights.last_7} last 7d
                </p>
              )}
            </div>

            {/* Completed */}
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Completed</p>
              <p className="text-2xl font-semibold text-green-400">
                {dashboard?.opportunities?.completed.last_7.toLocaleString() ?? '—'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">last 7d</p>
            </div>

            {/* Money Rescued */}
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Money Rescued</p>
              <p className="text-2xl font-semibold text-green-400">
                {dashboard?.value?.money_rescued_usd_cents
                  ? formatMoney(dashboard.value.money_rescued_usd_cents.last_7, 'USD')
                  : '—'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">last 7d</p>
            </div>

            {/* Pipeline Issues */}
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Pipeline Issues</p>
              <p className="text-2xl font-semibold text-orange-400">
                {flightPipelineIssues.length}
              </p>
              {pipelineData && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {pipelineData.healthy_bookings} healthy
                </p>
              )}
            </div>
          </div>

          {/* ── Funnel Chart ──────────────────────────────── */}
          <div className="bg-card border border-border rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold mb-1">User Conversion Funnel</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Users in the last {days} days — click a bar to drill down
            </p>

            {funnelChartData.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={funnelChartData}
                    margin={{ top: 10, right: 30, left: 10, bottom: 0 }}
                    barCategoryGap="20%"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: CHART_AXIS }}
                      tickLine={false}
                      axisLine={{ stroke: CHART_GRID }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: CHART_AXIS }}
                      tickLine={false}
                      axisLine={{ stroke: CHART_GRID }}
                      allowDecimals={false}
                    />
                    <Tooltip content={<FunnelTooltip />} cursor={{ fill: '#ffffff08' }} />
                    <Bar
                      dataKey="count"
                      radius={[6, 6, 0, 0]}
                      cursor="pointer"
                      onClick={(data) => {
                        const key = data?.key as FunnelStageKey | undefined;
                        if (key) {
                          setSelectedStage(prev => prev === key ? null : key);
                          setSelectedIssueType(null);
                        }
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
              <div className="text-center py-12 text-muted-foreground">
                No funnel data available for this time period
              </div>
            )}

            {/* Funnel stage cards below chart */}
            {funnelChartData.length > 0 && (
              <div className="grid grid-cols-5 gap-2 mt-4">
                {funnelChartData.map((stage, i) => (
                  <button
                    key={stage.key}
                    onClick={() => {
                      setSelectedStage(prev => prev === stage.key ? null : (stage.key as FunnelStageKey));
                      setSelectedIssueType(null);
                    }}
                    className={cn(
                      'rounded-lg p-3 text-left transition-all border',
                      selectedStage === stage.key
                        ? 'border-white/30 bg-accent/50'
                        : 'border-border hover:border-border/80 hover:bg-accent/20',
                    )}
                  >
                    <div className="text-2xl font-bold" style={{ color: stage.color }}>
                      {stage.count.toLocaleString()}
                    </div>
                    <div className="text-xs font-medium text-foreground mt-0.5">{stage.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {stage.pctOfTotal}
                      {i > 0 && stage.dropOff && (
                        <span className="text-red-400 ml-1">({stage.dropOff} drop)</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Opportunity Status Breakdown ──────────────── */}
          {totalFlightOpps > 0 && (
            <div className="bg-card border border-border rounded-lg p-6 mb-6">
              <h2 className="text-lg font-semibold mb-1">Opportunity Status Breakdown</h2>
              <p className="text-xs text-muted-foreground mb-4">
                {totalFlightOpps} total flight opportunities across {funnelUsers.filter(u => u.flight_opps > 0).length} users
              </p>

              {/* Status group cards */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
                {Object.entries(OPP_STATUS_GROUPS).map(([groupKey, group]) => {
                  const count = group.statuses.reduce((sum, s) => {
                    return sum + (oppStatusAggregates.find(a => a.status === s)?.count || 0);
                  }, 0);
                  return (
                    <div key={groupKey} className="bg-accent/20 rounded-lg p-3">
                      <div className={cn('text-xl font-bold', group.color)}>{count}</div>
                      <div className="text-xs font-medium text-foreground mt-0.5">{group.label}</div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {group.statuses.map(s => {
                          const c = oppStatusAggregates.find(a => a.status === s)?.count || 0;
                          if (c === 0) return null;
                          return (
                            <span key={s} className={cn('text-[10px] px-1.5 py-0.5 rounded', group.bg, group.color)}>
                              {s.replace(/_/g, ' ')} ({c})
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* All statuses bar */}
              {oppStatusAggregates.length > 0 && (
                <div className="flex gap-1 h-3 rounded-full overflow-hidden">
                  {oppStatusAggregates.map(({ status, count }) => {
                    const statusColors: Record<string, string> = {
                      active: '#3b82f6', accepted: '#6366f1', executing: '#a855f7',
                      awaiting_customer: '#eab308', awaiting_cancellation: '#f59e0b',
                      completed: '#22c55e', failed: '#ef4444', needs_intervention: '#f97316',
                      declined: '#71717a', expired: '#71717a', withdrawn: '#71717a', cancelled: '#ef4444',
                    };
                    return (
                      <div
                        key={status}
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${(count / totalFlightOpps) * 100}%`,
                          backgroundColor: statusColors[status] || '#71717a',
                          minWidth: count > 0 ? '4px' : '0px',
                        }}
                        title={`${status.replace(/_/g, ' ')}: ${count} (${pct(count, totalFlightOpps)})`}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Pipeline Issues ────────────────────────────── */}
          {flightPipelineIssues.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-6 mb-6">
              <h2 className="text-lg font-semibold mb-1">Pipeline Issues</h2>
              <p className="text-xs text-muted-foreground mb-4">
                Bookings and opportunities that need attention — {flightPipelineIssues.length} issue{flightPipelineIssues.length !== 1 ? 's' : ''}
              </p>

              {/* Issue type filter chips */}
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={() => setSelectedIssueType(null)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                    selectedIssueType === null
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-accent/50 text-muted-foreground hover:bg-accent',
                  )}
                >
                  All ({flightPipelineIssues.length})
                </button>
                {issueTypeCounts.map(({ type, count, label }) => (
                  <button
                    key={type}
                    onClick={() => setSelectedIssueType(prev => prev === type ? null : type)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                      selectedIssueType === type
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-accent/50 text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {label} ({count})
                  </button>
                ))}
              </div>

              {/* Issues table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-border bg-accent/30">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Issue</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">User</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Booking</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Reason</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIssues.slice(0, 50).map((issue, i) => (
                      <tr key={`${issue.issue_type}-${issue.booking_id}-${i}`} className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors">
                        <td className="px-3 py-2.5">
                          <IssueTypeBadge type={issue.issue_type} />
                        </td>
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/users-list/${issue.user_id}`}
                            className="text-xs text-primary hover:underline"
                          >
                            {userInfoMap.get(issue.user_id)?.email || issue.user_id.slice(0, 8) + '...'}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">
                          {issue.booking_id ? issue.booking_id.slice(0, 12) + '...' : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[300px] truncate">
                          {issue.reason || '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          {issue.status ? <StatusBadge status={issue.status} /> : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {issue.created_at ? timeAgo(issue.created_at) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredIssues.length > 50 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Showing 50 of {filteredIssues.length} issues
                </p>
              )}
            </div>
          )}

          {/* ── User Drill-Down Table ─────────────────────── */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">
                  {selectedStage
                    ? `Users at: ${FUNNEL_STAGES.find(s => s.key === selectedStage)?.label}`
                    : 'All Users in Funnel'}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sortedUsers.length} user{sortedUsers.length !== 1 ? 's' : ''}
                  {selectedStage && (
                    <button
                      onClick={() => setSelectedStage(null)}
                      className="ml-2 text-primary hover:underline"
                    >
                      Clear filter
                    </button>
                  )}
                </p>
              </div>
              <div className="max-w-xs">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search email, name, phone..."
                  className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border bg-accent/30">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">User</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Stage</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Signed Up</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">Bookings</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">Watches</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">Opportunities</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Opp Statuses</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Time to Booking</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Time to Opp</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.slice(0, 100).map(user => {
                    const info = userInfoMap.get(user.user_id);
                    const stage = getUserFunnelStage(user);
                    const statuses = getOppStatusBreakdown(user);

                    return (
                      <tr
                        key={user.user_id}
                        className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors"
                      >
                        {/* User */}
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/users-list/${user.user_id}`}
                            className="text-sm text-primary hover:underline block truncate max-w-[200px]"
                          >
                            {info?.name || user.email}
                          </Link>
                          <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                            {info?.name ? user.email : ''}
                          </div>
                        </td>

                        {/* Stage */}
                        <td className="px-3 py-2.5">
                          <StageBadge stage={stage} />
                        </td>

                        {/* Signed Up */}
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {timeAgo(user.signed_up)}
                        </td>

                        {/* Bookings */}
                        <td className="px-3 py-2.5 text-center">
                          <span className={cn(
                            'text-sm font-mono',
                            user.flight_bookings > 0 ? 'text-foreground' : 'text-muted-foreground/50',
                          )}>
                            {user.flight_bookings}
                          </span>
                        </td>

                        {/* Watches */}
                        <td className="px-3 py-2.5 text-center">
                          <span className={cn(
                            'text-sm font-mono',
                            user.flight_watches > 0 ? 'text-foreground' : 'text-muted-foreground/50',
                          )}>
                            {user.flight_watches}
                          </span>
                        </td>

                        {/* Opportunities */}
                        <td className="px-3 py-2.5 text-center">
                          <span className={cn(
                            'text-sm font-mono',
                            user.flight_opps > 0 ? 'text-foreground font-medium' : 'text-muted-foreground/50',
                          )}>
                            {user.flight_opps}
                          </span>
                        </td>

                        {/* Opp Statuses */}
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {statuses.length > 0 ? statuses.map(({ status, count }) => (
                              <span key={status} className="inline-flex items-center">
                                <StatusBadge status={status} />
                                {count > 1 && <span className="text-[10px] text-muted-foreground ml-0.5">x{count}</span>}
                              </span>
                            )) : (
                              <span className="text-xs text-muted-foreground/50">—</span>
                            )}
                          </div>
                        </td>

                        {/* Time to Booking */}
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {user.hours_to_first_booking !== null
                            ? user.hours_to_first_booking < 1
                              ? '<1h'
                              : user.hours_to_first_booking < 24
                                ? `${Math.round(user.hours_to_first_booking)}h`
                                : `${Math.round(user.hours_to_first_booking / 24)}d`
                            : '—'}
                        </td>

                        {/* Time to Opp */}
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {user.hours_to_first_opp !== null
                            ? user.hours_to_first_opp < 1
                              ? '<1h'
                              : user.hours_to_first_opp < 24
                                ? `${Math.round(user.hours_to_first_opp)}h`
                                : `${Math.round(user.hours_to_first_opp / 24)}d`
                            : '—'}
                        </td>
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
              <p className="text-xs text-muted-foreground mt-2">
                Showing first 100 of {sortedUsers.length} users
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
