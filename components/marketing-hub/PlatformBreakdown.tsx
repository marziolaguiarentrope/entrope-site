'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { PlatformBreakdownRow, CampaignBreakdownRow } from '@/lib/marketing-hub/types';

interface PlatformBreakdownProps {
  platformData: PlatformBreakdownRow[];
  campaignData: CampaignBreakdownRow[];
  isLoading: boolean;
}

type BreakdownView = 'platform' | 'campaign';

function formatCurrency(v: number): string {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

export function PlatformBreakdown({
  platformData,
  campaignData,
  isLoading,
}: PlatformBreakdownProps) {
  const [view, setView] = useState<BreakdownView>('platform');

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h3 className="text-sm font-medium text-foreground">Performance Breakdown</h3>
        <div className="flex items-center gap-1 rounded-lg bg-secondary/50 p-0.5">
          <button
            onClick={() => setView('platform')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-all duration-150',
              view === 'platform'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            By Platform
          </button>
          <button
            onClick={() => setView('campaign')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-all duration-150',
              view === 'campaign'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            By Campaign
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          </div>
        ) : view === 'platform' ? (
          <PlatformTable data={platformData} />
        ) : (
          <CampaignTable data={campaignData} />
        )}
      </div>
    </div>
  );
}

function PlatformTable({ data }: { data: PlatformBreakdownRow[] }) {
  const totalSpend = data.reduce((s, d) => s + d.spend, 0);

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border">
          <th className="px-5 py-3 text-left font-medium text-muted-foreground">Platform</th>
          <th className="px-3 py-3 text-right font-medium text-muted-foreground">Spend</th>
          <th className="px-3 py-3 text-right font-medium text-muted-foreground hidden sm:table-cell">Share</th>
          <th className="px-3 py-3 text-right font-medium text-muted-foreground">Impressions</th>
          <th className="px-3 py-3 text-right font-medium text-muted-foreground">Clicks</th>
          <th className="px-3 py-3 text-right font-medium text-muted-foreground">Conv.</th>
          <th className="px-3 py-3 text-right font-medium text-muted-foreground hidden md:table-cell">CPR</th>
          <th className="px-3 py-3 text-right font-medium text-muted-foreground hidden md:table-cell">CTR</th>
          <th className="px-5 py-3 text-right font-medium text-muted-foreground hidden lg:table-cell">CPM</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => {
          const share = totalSpend > 0 ? (row.spend / totalSpend) * 100 : 0;
          return (
            <tr
              key={row.platform}
              className="border-b border-border/50 transition-colors hover:bg-secondary/30"
            >
              <td className="px-5 py-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: row.color }}
                  />
                  <span className="font-medium text-foreground">{row.platformName}</span>
                </div>
              </td>
              <td className="px-3 py-3 text-right font-medium text-foreground tabular-nums">
                {formatCurrency(row.spend)}
              </td>
              <td className="px-3 py-3 text-right hidden sm:table-cell">
                <div className="flex items-center justify-end gap-2">
                  <div className="h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${share}%`, backgroundColor: row.color }}
                    />
                  </div>
                  <span className="text-muted-foreground tabular-nums w-10 text-right">
                    {share.toFixed(1)}%
                  </span>
                </div>
              </td>
              <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">
                {formatNumber(row.impressions)}
              </td>
              <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">
                {formatNumber(row.clicks)}
              </td>
              <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">
                {formatNumber(row.conversions)}
              </td>
              <td className="px-3 py-3 text-right text-muted-foreground tabular-nums hidden md:table-cell">
                {formatCurrency(row.cpr)}
              </td>
              <td className="px-3 py-3 text-right text-muted-foreground tabular-nums hidden md:table-cell">
                {row.ctr.toFixed(2)}%
              </td>
              <td className="px-5 py-3 text-right text-muted-foreground tabular-nums hidden lg:table-cell">
                {formatCurrency(row.cpm)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CampaignTable({ data }: { data: CampaignBreakdownRow[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border">
          <th className="px-5 py-3 text-left font-medium text-muted-foreground">Campaign</th>
          <th className="px-3 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Platform</th>
          <th className="px-3 py-3 text-right font-medium text-muted-foreground">Spend</th>
          <th className="px-3 py-3 text-right font-medium text-muted-foreground">Impressions</th>
          <th className="px-3 py-3 text-right font-medium text-muted-foreground">Clicks</th>
          <th className="px-3 py-3 text-right font-medium text-muted-foreground">Conv.</th>
          <th className="px-3 py-3 text-right font-medium text-muted-foreground hidden md:table-cell">CPR</th>
          <th className="px-5 py-3 text-right font-medium text-muted-foreground hidden md:table-cell">CTR</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr
            key={`${row.platform}-${row.campaign}-${i}`}
            className="border-b border-border/50 transition-colors hover:bg-secondary/30"
          >
            <td className="px-5 py-3 font-medium text-foreground max-w-[200px] truncate">
              {row.campaign}
            </td>
            <td className="px-3 py-3 text-muted-foreground hidden sm:table-cell">
              {row.platformName}
            </td>
            <td className="px-3 py-3 text-right font-medium text-foreground tabular-nums">
              {formatCurrency(row.spend)}
            </td>
            <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">
              {formatNumber(row.impressions)}
            </td>
            <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">
              {formatNumber(row.clicks)}
            </td>
            <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">
              {formatNumber(row.conversions)}
            </td>
            <td className="px-3 py-3 text-right text-muted-foreground tabular-nums hidden md:table-cell">
              {formatCurrency(row.cpr)}
            </td>
            <td className="px-5 py-3 text-right text-muted-foreground tabular-nums hidden md:table-cell">
              {row.ctr.toFixed(2)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
