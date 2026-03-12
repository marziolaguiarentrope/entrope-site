'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { api } from '@/lib/api';
import type { BusinessDashboardResponse, BusinessPeriodPair } from '@/lib/api';
import { cn, exportCSV, exportJSON } from '@/lib/utils';
import { RefreshCw, Download } from 'lucide-react';

const CHART_GREEN = '#00C805';
const CHART_RED = '#f87171';
const CHART_GRID = '#1a1f2e';
const CHART_AXIS = '#6b7280';

// ── Helpers ──────────────────────────────────────────────

function formatCents(cents: number): string {
  const abs = Math.abs(cents / 100);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return cents < 0 ? `-$${formatted}` : `$${formatted}`;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function ChangeIndicator({ current, previous, label }: { current: number; previous: number; label: string }) {
  const pct = pctChange(current, previous);
  if (pct === null) return <span className="text-xs text-zinc-600">&mdash;</span>;
  const positive = pct >= 0;
  return (
    <span className={cn('text-xs font-medium', positive ? 'text-emerald-400' : 'text-red-400')}>
      {positive ? '+' : ''}{pct.toFixed(0)}% vs prev {label}
    </span>
  );
}

// ── Stat Card ────────────────────────────────────────────

function StatCard({
  label,
  value,
  rawValue,
  pair,
  periodLabel,
  highlight,
  format,
}: {
  label: string;
  value: string;
  rawValue?: number;
  pair: BusinessPeriodPair;
  periodLabel: string;
  highlight?: boolean;
  format?: (n: number) => string;
}) {
  const fmt = format ?? ((n: number) => n.toLocaleString());
  const isNegative = rawValue !== undefined && rawValue < 0;
  const valueColor = isNegative ? 'text-red-400' : highlight ? 'text-emerald-400' : 'text-zinc-200';
  return (
    <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className={cn('text-2xl font-semibold', valueColor)}>
        {value}
      </p>
      <p className="text-xs text-zinc-500 mt-0.5">{fmt(pair.last_period)} last {periodLabel}</p>
      <div className="mt-1">
        <ChangeIndicator current={pair.last_period} previous={pair.prev_period} label={periodLabel} />
      </div>
    </div>
  );
}

// ── Trend Chart ─────────────────────────────────────────

function TrendChart({
  label,
  pair,
  periodLabel,
  format,
}: {
  label: string;
  pair: BusinessPeriodPair;
  periodLabel: string;
  format?: (n: number) => string;
}) {
  const fmt = format ?? ((n: number) => n.toLocaleString());
  const chartData = [
    { name: `Prev ${periodLabel}`, value: pair.prev_period },
    { name: `Last ${periodLabel}`, value: pair.last_period },
  ];
  const pct = pctChange(pair.last_period, pair.prev_period);
  const positive = pct !== null && pct >= 0;

  return (
    <div className="bg-[#0d1117] border border-[#1a1f2e] rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-zinc-500">{label}</p>
        {pct !== null && (
          <span className={cn('text-xs font-medium', positive ? 'text-emerald-400' : 'text-red-400')}>
            {positive ? '+' : ''}{pct.toFixed(0)}%
          </span>
        )}
      </div>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fill: CHART_AXIS, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: CHART_AXIS, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => fmt(v)}
              width={60}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#0d1117', border: '1px solid #1a1f2e', borderRadius: 8 }}
              labelStyle={{ color: '#a1a1aa', fontSize: 12 }}
              formatter={(value: number) => [fmt(value), label]}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={entry.value < 0 ? CHART_RED : CHART_GREEN} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── M$R Breakdown Row ───────────────────────────────────

function MsrRow({ label, pair, periodLabel }: { label: string; pair: BusinessPeriodPair; periodLabel: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#1a1f2e] last:border-0">
      <span className="text-sm text-zinc-400">{label}</span>
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-zinc-200 w-24 text-right">{formatCents(pair.last_period)}</span>
        <div className="w-28 text-right">
          <ChangeIndicator current={pair.last_period} previous={pair.prev_period} label={periodLabel} />
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

// ── Export helpers ───────────────────────────────────────

function flattenBusinessData(data: BusinessDashboardResponse): Record<string, unknown>[] {
  const ts = new Date().toISOString();
  const fmtCents = (c: number) => (c / 100).toFixed(2);
  const pp = (prefix: string, p: BusinessPeriodPair) => ({
    [`${prefix}_last_period`]: p.last_period,
    [`${prefix}_prev_period`]: p.prev_period,
  });

  return [{
    exported_at: ts,
    gmv_usd_last: fmtCents(data.gmv_usd_cents.last_period),
    gmv_usd_prev: fmtCents(data.gmv_usd_cents.prev_period),
    revenue_usd_last: fmtCents(data.revenue_usd_cents.last_period),
    revenue_usd_prev: fmtCents(data.revenue_usd_cents.prev_period),
    ...pp('msr_total', data.msr.total),
    ...pp('msr_flight_reprice', data.msr.flight_reprice),
    ...pp('msr_flight_upgrade', data.msr.flight_upgrade),
    ...pp('msr_hotel_reprice', data.msr.hotel_reprice),
    ...pp('msr_hotel_better', data.msr.hotel_better),
    active_users_last: data.active_users.last_period,
    active_users_prev: data.active_users.prev_period,
  }];
}

// ── Period selector ─────────────────────────────────────

const PERIOD_OPTIONS = [
  { days: 7, label: '7d' },
  { days: 14, label: '14d' },
  { days: 30, label: '30d' },
];

// ── Main Page ────────────────────────────────────────────

export default function BusinessPage() {
  const [data, setData] = useState<BusinessDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

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

  const fetchData = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getBusinessDashboard(d);
      setData(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load dashboard';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(days);
  }, [fetchData, days]);

  const periodLabel = `${days}d`;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Business</h1>
          <p className="text-sm text-muted-foreground mt-1">GMV, Revenue, M$R, Active Users</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex items-center gap-1 bg-[#0d1117] border border-[#1a1f2e] rounded-lg px-1 py-0.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => setDays(opt.days)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded transition-colors',
                  days === opt.days
                    ? 'bg-emerald-500/20 text-emerald-400 font-medium'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

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
            onClick={() => fetchData(days)}
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
            onClick={() => fetchData(days)}
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="GMV"
              value={formatCents(data.gmv_usd_cents.last_period)}
              pair={data.gmv_usd_cents}
              periodLabel={periodLabel}
              format={formatCents}
            />
            <StatCard
              label="Revenue"
              value={formatCents(data.revenue_usd_cents.last_period)}
              rawValue={data.revenue_usd_cents.last_period}
              pair={data.revenue_usd_cents}
              periodLabel={periodLabel}
              highlight
              format={formatCents}
            />
            <StatCard
              label="M$R"
              value={formatCents(data.msr.total.last_period)}
              rawValue={data.msr.total.last_period}
              pair={data.msr.total}
              periodLabel={periodLabel}
              highlight
              format={formatCents}
            />
            <StatCard
              label="Active Users"
              value={data.active_users.last_period.toLocaleString()}
              pair={data.active_users}
              periodLabel={periodLabel}
            />
          </div>

          {/* Trend Charts */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <TrendChart label="GMV" pair={data.gmv_usd_cents} periodLabel={periodLabel} format={formatCents} />
            <TrendChart label="Revenue" pair={data.revenue_usd_cents} periodLabel={periodLabel} format={formatCents} />
            <TrendChart label="M$R" pair={data.msr.total} periodLabel={periodLabel} format={formatCents} />
            <TrendChart label="Active Users" pair={data.active_users} periodLabel={periodLabel} />
          </div>

          {/* M$R Breakdown */}
          <Section title="M$R Breakdown">
            <MsrRow label="Flight Reprice" pair={data.msr.flight_reprice} periodLabel={periodLabel} />
            <MsrRow label="Better Flight" pair={data.msr.flight_upgrade} periodLabel={periodLabel} />
            <MsrRow label="Hotel Reprice" pair={data.msr.hotel_reprice} periodLabel={periodLabel} />
            <MsrRow label="Better Hotel" pair={data.msr.hotel_better} periodLabel={periodLabel} />
          </Section>

          {/* Ratio */}
          {data.revenue_usd_cents.last_period > 0 && (
            <Section title="Health">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-zinc-400">M$R / Revenue Ratio</span>
                <span className="text-sm font-medium text-emerald-400">
                  {(data.msr.total.last_period / data.revenue_usd_cents.last_period).toFixed(1)}x
                </span>
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                Higher ratio = users getting outsized value relative to what Axel earns
              </p>
            </Section>
          )}
        </div>
      ) : null}
    </div>
  );
}
