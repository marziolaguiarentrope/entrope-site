'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  Platform,
  DailyMetrics,
  AggregatedMetrics,
  TimeSeriesPoint,
  PlatformBreakdownRow,
  CampaignBreakdownRow,
  MarketingFilters,
  MarketingDataResult,
  DateRange,
  DateRangePreset,
} from './types';
import { PLATFORMS } from './types';
import { getAllPlatformsData } from './services';
import { generateCampaignBreakdown } from './mock-data';

function getPresetDateRange(preset: DateRangePreset): DateRange {
  const end = new Date();
  const start = new Date();
  switch (preset) {
    case '7d':
      start.setDate(end.getDate() - 7);
      break;
    case '14d':
      start.setDate(end.getDate() - 14);
      break;
    case '30d':
      start.setDate(end.getDate() - 30);
      break;
    case '60d':
      start.setDate(end.getDate() - 60);
      break;
    case '90d':
      start.setDate(end.getDate() - 90);
      break;
    default:
      start.setDate(end.getDate() - 30);
  }
  return { start, end };
}

function aggregateMetrics(data: DailyMetrics[]): AggregatedMetrics {
  const spend = data.reduce((s, d) => s + d.spend, 0);
  const impressions = data.reduce((s, d) => s + d.impressions, 0);
  const clicks = data.reduce((s, d) => s + d.clicks, 0);
  const conversions = data.reduce((s, d) => s + d.conversions, 0);

  return {
    spend: Math.round(spend * 100) / 100,
    impressions,
    clicks,
    conversions,
    cpr: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : 0,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
    cpm: impressions > 0 ? Math.round((spend / impressions) * 1000 * 100) / 100 : 0,
  };
}

function buildTimeSeries(data: DailyMetrics[]): TimeSeriesPoint[] {
  const byDate = new Map<string, TimeSeriesPoint>();

  for (const d of data) {
    const existing = byDate.get(d.date);
    if (existing) {
      existing.spend += d.spend;
      existing.impressions += d.impressions;
      existing.clicks += d.clicks;
      existing.conversions += d.conversions;
    } else {
      byDate.set(d.date, {
        date: d.date,
        spend: d.spend,
        impressions: d.impressions,
        clicks: d.clicks,
        conversions: d.conversions,
        ctr: 0,
      });
    }
  }

  const series = Array.from(byDate.values()).sort(
    (a, b) => a.date.localeCompare(b.date)
  );

  for (const point of series) {
    point.spend = Math.round(point.spend * 100) / 100;
    point.ctr =
      point.impressions > 0
        ? Math.round((point.clicks / point.impressions) * 10000) / 100
        : 0;
  }

  return series;
}

function buildPlatformBreakdown(data: DailyMetrics[]): PlatformBreakdownRow[] {
  const byPlatform = new Map<Platform, DailyMetrics[]>();

  for (const d of data) {
    const arr = byPlatform.get(d.platform) || [];
    arr.push(d);
    byPlatform.set(d.platform, arr);
  }

  return Array.from(byPlatform.entries()).map(([platform, records]) => {
    const agg = aggregateMetrics(records);
    const info = PLATFORMS.find((p) => p.id === platform)!;
    return {
      platform,
      platformName: info.name,
      color: info.color,
      ...agg,
    };
  }).sort((a, b) => b.spend - a.spend);
}

export function useMarketingData(): MarketingDataResult & {
  filters: MarketingFilters;
  setDateRangePreset: (preset: DateRangePreset) => void;
  setCustomDateRange: (range: DateRange) => void;
  setPlatforms: (platforms: Platform[]) => void;
  togglePlatform: (platform: Platform) => void;
  refresh: () => void;
} {
  const [filters, setFilters] = useState<MarketingFilters>(() => ({
    dateRangePreset: '30d',
    dateRange: getPresetDateRange('30d'),
    platforms: ['meta', 'google', 'tiktok', 'spotify', 'vibe'],
  }));

  const [rawData, setRawData] = useState<DailyMetrics[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getAllPlatformsData(
        filters.platforms,
        filters.dateRange.start,
        filters.dateRange.end
      );
      setRawData(data);
    } catch (err) {
      console.error('Failed to fetch marketing data:', err);
      setRawData([]);
    } finally {
      setIsLoading(false);
    }
  }, [filters.platforms, filters.dateRange.start, filters.dateRange.end]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const aggregated = useMemo(() => aggregateMetrics(rawData), [rawData]);
  const timeSeries = useMemo(() => buildTimeSeries(rawData), [rawData]);
  const platformBreakdown = useMemo(() => buildPlatformBreakdown(rawData), [rawData]);
  const campaignBreakdown = useMemo(
    () => generateCampaignBreakdown(filters.platforms, filters.dateRange.start, filters.dateRange.end),
    [filters.platforms, filters.dateRange.start, filters.dateRange.end]
  );

  const setDateRangePreset = useCallback((preset: DateRangePreset) => {
    setFilters((prev) => ({
      ...prev,
      dateRangePreset: preset,
      dateRange: getPresetDateRange(preset),
    }));
  }, []);

  const setCustomDateRange = useCallback((range: DateRange) => {
    setFilters((prev) => ({
      ...prev,
      dateRangePreset: 'custom' as DateRangePreset,
      dateRange: range,
    }));
  }, []);

  const setPlatforms = useCallback((platforms: Platform[]) => {
    setFilters((prev) => ({ ...prev, platforms }));
  }, []);

  const togglePlatform = useCallback((platform: Platform) => {
    setFilters((prev) => {
      const has = prev.platforms.includes(platform);
      const next = has
        ? prev.platforms.filter((p) => p !== platform)
        : [...prev.platforms, platform];
      return { ...prev, platforms: next.length > 0 ? next : prev.platforms };
    });
  }, []);

  return {
    aggregated,
    timeSeries,
    platformBreakdown,
    campaignBreakdown,
    isLoading,
    filters,
    setDateRangePreset,
    setCustomDateRange,
    setPlatforms,
    togglePlatform,
    refresh: fetchData,
  };
}
