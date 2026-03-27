import type { Platform, DailyMetrics, CampaignBreakdownRow } from './types';

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const PLATFORM_PROFILES: Record<Platform, {
  dailySpendBase: number;
  ctrBase: number;
  convRateBase: number;
  cpmBase: number;
  volatility: number;
  trend: number;
}> = {
  meta: {
    dailySpendBase: 2400,
    ctrBase: 0.018,
    convRateBase: 0.035,
    cpmBase: 9.5,
    volatility: 0.2,
    trend: 0.008,
  },
  google: {
    dailySpendBase: 3200,
    ctrBase: 0.032,
    convRateBase: 0.045,
    cpmBase: 7.2,
    volatility: 0.15,
    trend: 0.005,
  },
  tiktok: {
    dailySpendBase: 1600,
    ctrBase: 0.012,
    convRateBase: 0.022,
    cpmBase: 5.8,
    volatility: 0.3,
    trend: 0.015,
  },
  spotify: {
    dailySpendBase: 800,
    ctrBase: 0.008,
    convRateBase: 0.015,
    cpmBase: 12.0,
    volatility: 0.25,
    trend: 0.01,
  },
  vibe: {
    dailySpendBase: 500,
    ctrBase: 0.01,
    convRateBase: 0.02,
    cpmBase: 8.0,
    volatility: 0.35,
    trend: 0.02,
  },
};

export function generateDailyMetrics(
  platform: Platform,
  startDate: Date,
  endDate: Date
): DailyMetrics[] {
  const profile = PLATFORM_PROFILES[platform];
  const rand = seededRandom(platform.charCodeAt(0) * 1000 + startDate.getTime() % 10000);
  const metrics: DailyMetrics[] = [];

  const current = new Date(startDate);
  let dayIndex = 0;

  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0];
    const dayOfWeek = current.getDay();
    const weekendFactor = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.75 : 1.0;
    const trendFactor = 1 + profile.trend * dayIndex;
    const noise = 1 + (rand() - 0.5) * profile.volatility * 2;

    const spend = Math.round(profile.dailySpendBase * weekendFactor * trendFactor * noise * 100) / 100;
    const impressions = Math.round((spend / profile.cpmBase) * 1000 * (1 + (rand() - 0.5) * 0.1));
    const clicks = Math.round(impressions * profile.ctrBase * (1 + (rand() - 0.5) * 0.2));
    const conversions = Math.round(clicks * profile.convRateBase * (1 + (rand() - 0.5) * 0.3));

    metrics.push({
      platform,
      date: dateStr,
      spend: Math.max(spend, 0),
      impressions: Math.max(impressions, 0),
      clicks: Math.max(clicks, 0),
      conversions: Math.max(conversions, 0),
    });

    current.setDate(current.getDate() + 1);
    dayIndex++;
  }

  return metrics;
}

const MOCK_CAMPAIGNS: Record<Platform, string[]> = {
  meta: ['Brand Awareness - US', 'Retargeting - Lookalike', 'App Install - iOS', 'Lead Gen - Travel'],
  google: ['Search - Brand', 'Search - Non-Brand', 'Performance Max', 'Display - Remarketing'],
  tiktok: ['Spark Ads - UGC', 'TopView - Launch', 'In-Feed - Conversion'],
  spotify: ['Audio - Podcast', 'Audio - Music', 'Display - Playlist'],
  vibe: ['CTV - Awareness', 'CTV - Retargeting'],
};

export function generateCampaignBreakdown(
  platforms: Platform[],
  startDate: Date,
  endDate: Date
): CampaignBreakdownRow[] {
  const rows: CampaignBreakdownRow[] = [];
  const platformNames: Record<Platform, string> = {
    meta: 'Meta Ads',
    google: 'Google Ads',
    tiktok: 'TikTok Ads',
    spotify: 'Spotify Ads',
    vibe: 'Vibe',
  };

  for (const platform of platforms) {
    const campaigns = MOCK_CAMPAIGNS[platform];
    const dailyData = generateDailyMetrics(platform, startDate, endDate);
    const totalSpend = dailyData.reduce((s, d) => s + d.spend, 0);
    const totalImpressions = dailyData.reduce((s, d) => s + d.impressions, 0);
    const totalClicks = dailyData.reduce((s, d) => s + d.clicks, 0);
    const totalConversions = dailyData.reduce((s, d) => s + d.conversions, 0);

    const rand = seededRandom(platform.charCodeAt(0) * 777);
    const weights = campaigns.map(() => rand() + 0.2);
    const weightSum = weights.reduce((a, b) => a + b, 0);

    campaigns.forEach((campaign, i) => {
      const share = weights[i] / weightSum;
      const spend = Math.round(totalSpend * share * 100) / 100;
      const impressions = Math.round(totalImpressions * share);
      const clicks = Math.round(totalClicks * share);
      const conversions = Math.round(totalConversions * share);
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      const cpr = conversions > 0 ? spend / conversions : 0;

      rows.push({
        campaign,
        platform,
        platformName: platformNames[platform],
        spend,
        impressions,
        clicks,
        conversions,
        cpr: Math.round(cpr * 100) / 100,
        ctr: Math.round(ctr * 1000) / 1000,
      });
    });
  }

  return rows.sort((a, b) => b.spend - a.spend);
}
