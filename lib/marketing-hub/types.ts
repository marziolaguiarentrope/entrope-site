export type Platform = 'meta' | 'google' | 'tiktok' | 'spotify' | 'vibe';

export interface PlatformInfo {
  id: Platform;
  name: string;
  color: string;
  icon: string;
}

export const PLATFORMS: PlatformInfo[] = [
  { id: 'meta', name: 'Meta Ads', color: '#1877F2', icon: '◉' },
  { id: 'google', name: 'Google Ads', color: '#34A853', icon: '▲' },
  { id: 'tiktok', name: 'TikTok Ads', color: '#EE1D52', icon: '♪' },
  { id: 'spotify', name: 'Spotify Ads', color: '#1DB954', icon: '●' },
  { id: 'vibe', name: 'Vibe', color: '#8B5CF6', icon: '◆' },
];

export interface DailyMetrics {
  platform: Platform;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface AggregatedMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpr: number;
  ctr: number;
  cpm: number;
}

export interface TimeSeriesPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
}

export interface PlatformBreakdownRow {
  platform: Platform;
  platformName: string;
  color: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpr: number;
  ctr: number;
  cpm: number;
}

export interface CampaignBreakdownRow {
  campaign: string;
  platform: Platform;
  platformName: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpr: number;
  ctr: number;
}

export type DateRangePreset = '7d' | '14d' | '30d' | '60d' | '90d' | 'custom';

export interface DateRange {
  start: Date;
  end: Date;
}

export interface MarketingFilters {
  dateRange: DateRange;
  dateRangePreset: DateRangePreset;
  platforms: Platform[];
}

export interface MarketingDataResult {
  aggregated: AggregatedMetrics;
  timeSeries: TimeSeriesPoint[];
  platformBreakdown: PlatformBreakdownRow[];
  campaignBreakdown: CampaignBreakdownRow[];
  isLoading: boolean;
}
