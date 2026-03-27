'use client';

import type { AggregatedMetrics } from '@/lib/marketing-hub/types';
import { DollarSign, Eye, MousePointerClick, UserPlus, Target, BarChart3, Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface MetricsCardsProps {
  metrics: AggregatedMetrics;
  isLoading: boolean;
}

interface MetricCardDef {
  key: keyof AggregatedMetrics;
  label: string;
  icon: LucideIcon;
  format: (v: number) => string;
  color: string;
}

const METRIC_CARDS: MetricCardDef[] = [
  {
    key: 'spend',
    label: 'Total Spend',
    icon: DollarSign,
    format: (v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    color: '#f97316',
  },
  {
    key: 'impressions',
    label: 'Impressions',
    icon: Eye,
    format: (v) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(1)}K` : v.toLocaleString(),
    color: '#3b82f6',
  },
  {
    key: 'clicks',
    label: 'Clicks',
    icon: MousePointerClick,
    format: (v) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(1)}K` : v.toLocaleString(),
    color: '#06b6d4',
  },
  {
    key: 'conversions',
    label: 'Conversions',
    icon: UserPlus,
    format: (v) => v.toLocaleString(),
    color: '#10b981',
  },
  {
    key: 'cpr',
    label: 'CPR',
    icon: Target,
    format: (v) => `$${v.toFixed(2)}`,
    color: '#f59e0b',
  },
  {
    key: 'ctr',
    label: 'CTR',
    icon: BarChart3,
    format: (v) => `${v.toFixed(2)}%`,
    color: '#8b5cf6',
  },
  {
    key: 'cpm',
    label: 'CPM',
    icon: Layers,
    format: (v) => `$${v.toFixed(2)}`,
    color: '#ec4899',
  },
];

export function MetricsCards({ metrics, isLoading }: MetricsCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {METRIC_CARDS.map((card) => {
        const Icon = card.icon;
        const value = metrics[card.key];
        return (
          <div
            key={card.key}
            className="group relative rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:border-muted-foreground/30 hover:shadow-lg hover:shadow-black/5"
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${card.color}18` }}
              >
                <Icon className="h-3.5 w-3.5" style={{ color: card.color }} />
              </div>
              <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
            </div>
            {isLoading ? (
              <div className="h-7 w-24 animate-pulse rounded-md bg-secondary" />
            ) : (
              <p className="text-lg font-semibold tracking-tight text-foreground">
                {card.format(value)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
