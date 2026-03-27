'use client';

import { useMarketingData } from '@/lib/marketing-hub/hooks';
import { FiltersBar } from '@/components/marketing-hub/FiltersBar';
import { MetricsCards } from '@/components/marketing-hub/MetricsCards';
import { ChartsSection } from '@/components/marketing-hub/ChartsSection';
import { PlatformBreakdown } from '@/components/marketing-hub/PlatformBreakdown';
import { Megaphone } from 'lucide-react';

export default function MarketingHubPage() {
  const {
    aggregated,
    timeSeries,
    platformBreakdown,
    campaignBreakdown,
    isLoading,
    filters,
    setDateRangePreset,
    togglePlatform,
    refresh,
  } = useMarketingData();

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
          <Megaphone className="h-4.5 w-4.5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Marketing Hub
          </h1>
          <p className="text-xs text-muted-foreground">
            Paid media performance across all platforms
          </p>
        </div>
      </div>

      <FiltersBar
        filters={filters}
        onDateRangePreset={setDateRangePreset}
        onTogglePlatform={togglePlatform}
        onRefresh={refresh}
        isLoading={isLoading}
      />

      <MetricsCards metrics={aggregated} isLoading={isLoading} />

      <ChartsSection timeSeries={timeSeries} isLoading={isLoading} />

      <PlatformBreakdown
        platformData={platformBreakdown}
        campaignData={campaignBreakdown}
        isLoading={isLoading}
      />
    </div>
  );
}
