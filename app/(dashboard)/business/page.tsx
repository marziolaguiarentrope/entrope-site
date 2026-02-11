'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import type { BusinessDashboardResponse, MetricPoint, PeriodOnly, OnboardingFunnelUser } from '@/lib/api';
import { cn, exportCSV, exportJSON } from '@/lib/utils';
import { RefreshCw, Download, ChevronDown, ChevronRight } from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function ChangeIndicator({ current, previous }: { current: number; previous: number }) {
  const pct = pctChange(current, previous);
  if (pct === null) return <span className="text-xs text-zinc-600">&mdash;</span>;
  const positive = pct >= 0;
  return (
    <span className={cn('text-xs font-medium', positive ? 'text-emerald-400' : 'text-red-400')}>
      {positive ? '+' : ''}{pct.toFixed(0)}% vs prev 7d
    </span>
  );
}

// ── Stat Card ────────────────────────────────────────────

function StatCard({
  label,
  value,
  subValue,
  change,
  highlight,
}: {
  label: string;
  value: string;
  subValue?: string;
  change?: { current: number; previous: number };
  highlight?: boolean;
}) {
  return (
    <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className={cn('text-2xl font-semibold', highlight ? 'text-emerald-400' : 'text-zinc-200')}>
        {value}
      </p>
      {subValue && <p className="text-xs text-zinc-500 mt-0.5">{subValue}</p>}
      {change && (
        <div className="mt-1">
          <ChangeIndicator current={change.current} previous={change.previous} />
        </div>
      )}
    </div>
  );
}

// ── Metric Row ───────────────────────────────────────────

function MetricRow({ label, point, format }: { label: string; point: MetricPoint; format?: (n: number) => string }) {
  const fmt = format ?? ((n: number) => n.toLocaleString());
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#1a1f2e] last:border-0">
      <span className="text-sm text-zinc-400">{label}</span>
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-zinc-200 w-20 text-right">{fmt(point.current)}</span>
        <span className="text-xs text-zinc-500 w-16 text-right">+{fmt(point.last_7)} 7d</span>
        <div className="w-24 text-right">
          <ChangeIndicator current={point.last_7} previous={point.prev_7} />
        </div>
      </div>
    </div>
  );
}

function PeriodRow({ label, period, format }: { label: string; period: PeriodOnly; format?: (n: number) => string }) {
  const fmt = format ?? ((n: number) => n.toLocaleString());
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#1a1f2e] last:border-0">
      <span className="text-sm text-zinc-400">{label}</span>
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-zinc-200 w-20 text-right">{fmt(period.last_7)}</span>
        <div className="w-24 text-right">
          <ChangeIndicator current={period.last_7} previous={period.prev_7} />
        </div>
      </div>
    </div>
  );
}

// ── Section Card ─────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-5">
      <h2 className="text-sm font-semibold text-zinc-300 mb-3">{title}</h2>
      {children}
    </div>
  );
}

// ── Funnel Bar ──────────────────────────────────────────

function FunnelBar({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-sm text-zinc-400 w-40 shrink-0">{label}</span>
      <div className="flex-1 h-6 bg-[#1a1f2e] rounded overflow-hidden">
        <div
          className="h-full bg-emerald-500/70 rounded transition-all duration-300"
          style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
        />
      </div>
      <span className="text-sm font-medium text-zinc-200 w-12 text-right">{count}</span>
      <span className="text-xs text-zinc-500 w-12 text-right">{pct.toFixed(0)}%</span>
    </div>
  );
}

function formatHours(h: number | null): string {
  if (h === null) return '-';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function FunnelUserRow({ user }: { user: OnboardingFunnelUser }) {
  const bookings = user.flight_bookings + user.hotel_bookings;
  const watches = user.flight_watches + user.hotel_watches;
  const opps = user.flight_opps + user.hotel_opps;
  return (
    <div className="flex items-center gap-2 py-2 border-b border-[#1a1f2e] last:border-0 text-xs">
      <span className="text-zinc-300 w-48 truncate" title={user.email}>{user.email}</span>
      <span className="text-zinc-500 w-20 text-right" title="Bookings">{bookings > 0 ? `${bookings} bk` : '-'}</span>
      <span className="text-zinc-500 w-20 text-right" title="Watches">{watches > 0 ? `${watches} w` : '-'}</span>
      <span className="text-zinc-500 w-20 text-right" title="Opportunities">{opps > 0 ? `${opps} opp` : '-'}</span>
      <span className="text-zinc-500 w-20 text-right" title="Time to first booking">{formatHours(user.hours_to_first_booking)}</span>
      <span className="text-zinc-500 w-20 text-right" title="Time to first opportunity">{formatHours(user.hours_to_first_opp)}</span>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────

function flattenBusinessData(data: BusinessDashboardResponse): Record<string, unknown>[] {
  const ts = new Date().toISOString();
  const fmtCents = (c: number) => (c / 100).toFixed(2);
  const mp = (prefix: string, p: MetricPoint) => ({
    [`${prefix}_current`]: p.current,
    [`${prefix}_last_7d`]: p.last_7,
    [`${prefix}_prev_7d`]: p.prev_7,
  });
  const pp = (prefix: string, p: PeriodOnly) => ({
    [`${prefix}_last_7d`]: p.last_7,
    [`${prefix}_prev_7d`]: p.prev_7,
  });

  return [{
    exported_at: ts,
    ...(data.users ? {
      ...mp('users_total', data.users.total),
      ...mp('users_paid', data.users.paid),
      ...mp('users_referred', data.users.referred),
      ...mp('users_free', data.users.free),
    } : {}),
    ...(data.bookings ? {
      ...mp('bookings_total', data.bookings.total),
      ...mp('bookings_flights', data.bookings.flights),
      ...mp('bookings_hotels', data.bookings.hotels),
      ...mp('bookings_monitored', data.bookings.monitored),
    } : {}),
    ...(data.opportunities ? {
      ...mp('opportunities_total', data.opportunities.total),
      ...mp('opportunities_flights', data.opportunities.flights),
      ...mp('opportunities_hotels', data.opportunities.hotels),
      ...pp('opportunities_completed', data.opportunities.completed),
    } : {}),
    ...(data.value ? {
      mrr_usd: fmtCents(data.value.mrr_usd_cents.current),
      mrr_usd_last_7d: fmtCents(data.value.mrr_usd_cents.last_7),
      mrr_usd_prev_7d: fmtCents(data.value.mrr_usd_cents.prev_7),
      money_rescued_usd_last_7d: fmtCents(data.value.money_rescued_usd_cents.last_7),
      money_rescued_usd_prev_7d: fmtCents(data.value.money_rescued_usd_cents.prev_7),
      hotel_revenue_usd_last_7d: fmtCents(data.value.hotel_revenue_usd_cents.last_7),
      hotel_revenue_usd_prev_7d: fmtCents(data.value.hotel_revenue_usd_cents.prev_7),
    } : {}),
    pipeline_issues_count: data.pipeline_issues?.length ?? 0,
  }];
}

export default function BusinessPage() {
  const [data, setData] = useState<BusinessDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [funnelExpanded, setFunnelExpanded] = useState(false);
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

  function handleExport(format: 'csv' | 'json') {
    if (!data) return;
    setShowExportMenu(false);
    const date = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      exportCSV(flattenBusinessData(data), `business-metrics-${date}.csv`);
    } else {
      exportJSON(data, `business-metrics-${date}.json`);
    }
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getBusinessDashboard();
      setData(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load dashboard';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Business</h1>
          <p className="text-sm text-muted-foreground mt-1">Snapshot of key metrics</p>
        </div>
        <div className="flex items-center gap-2">
          {data && !loading && (
            <div ref={exportRef} className="relative">
              <button
                onClick={() => setShowExportMenu(v => !v)}
                className="px-3 py-2 text-sm font-medium bg-accent/50 rounded-lg hover:bg-accent transition-colors flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-[#0d1117] border border-[#1a1f2e] rounded-lg shadow-xl overflow-hidden min-w-[140px]">
                  <button onClick={() => handleExport('csv')} className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-accent/50 transition-colors">
                    Export as CSV
                  </button>
                  <button onClick={() => handleExport('json')} className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-accent/50 transition-colors border-t border-[#1a1f2e]">
                    Export as JSON
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
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="text-center py-16">
          <p className="text-red-400 mb-2">{error}</p>
          <button
            onClick={fetchData}
            className="mt-3 px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="text-center py-16">
          <div className="inline-block animate-spin w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full mb-3" />
          <p className="text-zinc-400 text-sm">Loading metrics...</p>
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Top-level KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {data.users && (
              <StatCard
                label="Total Users"
                value={data.users.total.current.toLocaleString()}
                subValue={`+${data.users.total.last_7} last 7d`}
                change={{ current: data.users.total.last_7, previous: data.users.total.prev_7 }}
              />
            )}
            {data.users && (
              <StatCard
                label="Paid Users"
                value={data.users.paid.current.toLocaleString()}
                subValue={`+${data.users.paid.last_7} last 7d`}
                change={{ current: data.users.paid.last_7, previous: data.users.paid.prev_7 }}
                highlight
              />
            )}
            {data.value && (
              <StatCard
                label="MRR"
                value={formatCents(data.value.mrr_usd_cents.current)}
                subValue={`+${formatCents(data.value.mrr_usd_cents.last_7)} last 7d`}
                change={{ current: data.value.mrr_usd_cents.last_7, previous: data.value.mrr_usd_cents.prev_7 }}
                highlight
              />
            )}
            {data.bookings && (
              <StatCard
                label="Total Bookings"
                value={data.bookings.total.current.toLocaleString()}
                subValue={`+${data.bookings.total.last_7} last 7d`}
                change={{ current: data.bookings.total.last_7, previous: data.bookings.total.prev_7 }}
              />
            )}
          </div>

          {/* Detail sections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Users */}
            {data.users && (
              <Section title="Users">
                <MetricRow label="Total" point={data.users.total} />
                <MetricRow label="Paid" point={data.users.paid} />
                <MetricRow label="Referred" point={data.users.referred} />
                <MetricRow label="Free" point={data.users.free} />
              </Section>
            )}

            {/* Bookings */}
            {data.bookings && (
              <Section title="Bookings">
                <MetricRow label="Total" point={data.bookings.total} />
                <MetricRow label="Flights" point={data.bookings.flights} />
                <MetricRow label="Hotels" point={data.bookings.hotels} />
                <MetricRow label="Monitored" point={data.bookings.monitored} />
              </Section>
            )}

            {/* Opportunities */}
            {data.opportunities && (
              <Section title="Opportunities">
                <MetricRow label="Total" point={data.opportunities.total} />
                <MetricRow label="Flights" point={data.opportunities.flights} />
                <MetricRow label="Hotels" point={data.opportunities.hotels} />
                <PeriodRow label="Completed (7d)" period={data.opportunities.completed} />
              </Section>
            )}

            {/* Value */}
            {data.value && (
              <Section title="Value">
                <MetricRow label="MRR" point={data.value.mrr_usd_cents} format={formatCents} />
                <PeriodRow label="Money Rescued (7d)" period={data.value.money_rescued_usd_cents} format={formatCents} />
                <PeriodRow label="Hotel Revenue (7d)" period={data.value.hotel_revenue_usd_cents} format={formatCents} />
              </Section>
            )}
          </div>

          {/* Pipeline Issues */}
          {data.pipeline_issues && data.pipeline_issues.length > 0 && (
            <Section title="Pipeline Issues">
              <div className="space-y-0">
                {data.pipeline_issues.map((issue) => (
                  <div key={issue.type} className="flex items-center justify-between py-2 border-b border-[#1a1f2e] last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'w-2 h-2 rounded-full',
                        issue.priority <= 3 ? 'bg-red-400' :
                        issue.priority <= 6 ? 'bg-amber-400' :
                        'bg-zinc-500'
                      )} />
                      <span className="text-sm text-zinc-400">{issue.label}</span>
                    </div>
                    <span className={cn(
                      'text-sm font-medium',
                      issue.count > 0 ? 'text-zinc-200' : 'text-zinc-600'
                    )}>
                      {issue.count}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Onboarding Funnel */}
          {data.onboarding_funnel && (
            <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-5">
              <h2 className="text-sm font-semibold text-zinc-300 mb-1">Onboarding Funnel</h2>
              <p className="text-xs text-zinc-500 mb-4">Last 7 days &mdash; signups through opportunity progression</p>

              <div className="space-y-0">
                <FunnelBar label="Signed up" count={data.onboarding_funnel.summary.signed_up} total={data.onboarding_funnel.summary.signed_up} />
                <FunnelBar label="Has booking" count={data.onboarding_funnel.summary.has_booking} total={data.onboarding_funnel.summary.signed_up} />
                <FunnelBar label="Has watch" count={data.onboarding_funnel.summary.has_watch} total={data.onboarding_funnel.summary.signed_up} />
                <FunnelBar label="Has opportunity" count={data.onboarding_funnel.summary.has_opportunity} total={data.onboarding_funnel.summary.signed_up} />
                <FunnelBar label="Opp progressed" count={data.onboarding_funnel.summary.has_opportunity_progressed} total={data.onboarding_funnel.summary.signed_up} />
              </div>

              {data.onboarding_funnel.users.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[#1a1f2e]">
                  <button
                    onClick={() => setFunnelExpanded(v => !v)}
                    className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
                  >
                    {funnelExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    {funnelExpanded ? 'Hide' : 'Show'} per-user breakdown ({data.onboarding_funnel.users.length})
                  </button>
                  {funnelExpanded && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2 pb-2 border-b border-[#1a1f2e] text-xs text-zinc-500">
                        <span className="w-48">Email</span>
                        <span className="w-20 text-right">Bookings</span>
                        <span className="w-20 text-right">Watches</span>
                        <span className="w-20 text-right">Opps</span>
                        <span className="w-20 text-right">To 1st bk</span>
                        <span className="w-20 text-right">To 1st opp</span>
                      </div>
                      {data.onboarding_funnel.users.map((user) => (
                        <FunnelUserRow key={user.user_id} user={user} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
