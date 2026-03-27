'use client';

import { useState } from 'react';
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
  Legend,
} from 'recharts';
import { cn } from '@/lib/utils';
import type { TimeSeriesPoint } from '@/lib/marketing-hub/types';

interface ChartsSectionProps {
  timeSeries: TimeSeriesPoint[];
  isLoading: boolean;
}

type ChartTab = 'spend' | 'conversions' | 'ctr' | 'impressions-clicks';

const CHART_TABS: { value: ChartTab; label: string }[] = [
  { value: 'spend', label: 'Spend' },
  { value: 'conversions', label: 'Conversions' },
  { value: 'ctr', label: 'CTR' },
  { value: 'impressions-clicks', label: 'Impressions vs Clicks' },
];

const GRID_COLOR = '#ffffff08';
const AXIS_COLOR = '#6b7280';

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ChartTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-xl">
      <p className="text-xs font-medium text-muted-foreground mb-1.5">
        {formatDateLabel(label)}
      </p>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-xs">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground capitalize">{entry.name}:</span>
          <span className="font-medium text-foreground">
            {entry.dataKey === 'ctr'
              ? `${Number(entry.value).toFixed(2)}%`
              : entry.dataKey === 'spend'
                ? `$${Number(entry.value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                : Number(entry.value).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function SpendChart({ data }: { data: TimeSeriesPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={350}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="mh-spend-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f97316" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID_COLOR} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDateLabel}
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
          width={52}
        />
        <Tooltip content={<ChartTooltipContent />} />
        <Area
          type="monotone"
          dataKey="spend"
          name="Spend"
          stroke="#f97316"
          strokeWidth={2}
          fill="url(#mh-spend-grad)"
          animationDuration={800}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ConversionsChart({ data }: { data: TimeSeriesPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID_COLOR} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDateLabel}
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
          width={42}
        />
        <Tooltip content={<ChartTooltipContent />} />
        <Bar
          dataKey="conversions"
          name="Conversions"
          fill="#10b981"
          radius={[3, 3, 0, 0]}
          animationDuration={800}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function CtrChart({ data }: { data: TimeSeriesPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={350}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="mh-ctr-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID_COLOR} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDateLabel}
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={(v: number) => `${v.toFixed(1)}%`}
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip content={<ChartTooltipContent />} />
        <Area
          type="monotone"
          dataKey="ctr"
          name="CTR"
          stroke="#8b5cf6"
          strokeWidth={2}
          fill="url(#mh-ctr-grad)"
          animationDuration={800}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ImpressionsClicksChart({ data }: { data: TimeSeriesPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={350}>
      <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="mh-imp-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID_COLOR} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDateLabel}
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          yAxisId="impressions"
          tickFormatter={(v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
          width={52}
        />
        <YAxis
          yAxisId="clicks"
          orientation="right"
          tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
          tick={{ fontSize: 11, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
          width={42}
        />
        <Tooltip content={<ChartTooltipContent />} />
        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          iconType="circle"
          iconSize={8}
        />
        <Area
          yAxisId="impressions"
          type="monotone"
          dataKey="impressions"
          name="Impressions"
          stroke="#3b82f6"
          strokeWidth={2}
          fill="url(#mh-imp-grad)"
          animationDuration={800}
        />
        <Line
          yAxisId="clicks"
          type="monotone"
          dataKey="clicks"
          name="Clicks"
          stroke="#06b6d4"
          strokeWidth={2}
          dot={false}
          animationDuration={800}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function ChartsSection({ timeSeries, isLoading }: ChartsSectionProps) {
  const [activeTab, setActiveTab] = useState<ChartTab>('spend');

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-1">
          {CHART_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150',
                activeTab === tab.value
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-5">
        {isLoading ? (
          <div className="flex h-[350px] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          </div>
        ) : timeSeries.length === 0 ? (
          <div className="flex h-[350px] items-center justify-center text-sm text-muted-foreground">
            No data available for the selected filters.
          </div>
        ) : (
          <>
            {activeTab === 'spend' && <SpendChart data={timeSeries} />}
            {activeTab === 'conversions' && <ConversionsChart data={timeSeries} />}
            {activeTab === 'ctr' && <CtrChart data={timeSeries} />}
            {activeTab === 'impressions-clicks' && <ImpressionsClicksChart data={timeSeries} />}
          </>
        )}
      </div>
    </div>
  );
}
