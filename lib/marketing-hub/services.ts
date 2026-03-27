import type { Platform, DailyMetrics } from './types';
import { generateDailyMetrics } from './mock-data';

/**
 * Service layer for marketing platform data.
 *
 * Each function currently returns mock data.
 * To integrate real APIs, replace the body of each function
 * with actual API calls using the respective platform SDKs.
 *
 * API Key Configuration (future):
 *   Store keys in environment variables:
 *     NEXT_PUBLIC_META_ADS_TOKEN
 *     NEXT_PUBLIC_GOOGLE_ADS_API_KEY
 *     NEXT_PUBLIC_TIKTOK_ADS_TOKEN
 *     NEXT_PUBLIC_SPOTIFY_ADS_TOKEN
 *     NEXT_PUBLIC_VIBE_API_KEY
 *
 *   For server-side-only keys (recommended), use without NEXT_PUBLIC_ prefix
 *   and fetch via API routes instead.
 */

export async function getMetaAdsData(
  startDate: Date,
  endDate: Date
): Promise<DailyMetrics[]> {
  // TODO: Replace with Meta Marketing API call
  // https://developers.facebook.com/docs/marketing-api/
  // Required: access_token, ad_account_id
  await simulateLatency();
  return generateDailyMetrics('meta', startDate, endDate);
}

export async function getGoogleAdsData(
  startDate: Date,
  endDate: Date
): Promise<DailyMetrics[]> {
  // TODO: Replace with Google Ads API call
  // https://developers.google.com/google-ads/api/docs/start
  // Required: developer_token, client_id, client_secret, refresh_token, customer_id
  await simulateLatency();
  return generateDailyMetrics('google', startDate, endDate);
}

export async function getTikTokAdsData(
  startDate: Date,
  endDate: Date
): Promise<DailyMetrics[]> {
  // TODO: Replace with TikTok Marketing API call
  // https://business-api.tiktok.com/portal/docs
  // Required: access_token, advertiser_id
  await simulateLatency();
  return generateDailyMetrics('tiktok', startDate, endDate);
}

export async function getSpotifyAdsData(
  startDate: Date,
  endDate: Date
): Promise<DailyMetrics[]> {
  // TODO: Replace with Spotify Ad Studio API call
  // Required: client_id, client_secret
  await simulateLatency();
  return generateDailyMetrics('spotify', startDate, endDate);
}

export async function getVibeAdsData(
  startDate: Date,
  endDate: Date
): Promise<DailyMetrics[]> {
  // TODO: Replace with Vibe DSP API call
  // Required: api_key
  await simulateLatency();
  return generateDailyMetrics('vibe', startDate, endDate);
}

const platformFetchers: Record<Platform, (start: Date, end: Date) => Promise<DailyMetrics[]>> = {
  meta: getMetaAdsData,
  google: getGoogleAdsData,
  tiktok: getTikTokAdsData,
  spotify: getSpotifyAdsData,
  vibe: getVibeAdsData,
};

export async function getPlatformData(
  platform: Platform,
  startDate: Date,
  endDate: Date
): Promise<DailyMetrics[]> {
  const fetcher = platformFetchers[platform];
  return fetcher(startDate, endDate);
}

export async function getAllPlatformsData(
  platforms: Platform[],
  startDate: Date,
  endDate: Date
): Promise<DailyMetrics[]> {
  const results = await Promise.all(
    platforms.map((p) => getPlatformData(p, startDate, endDate))
  );
  return results.flat();
}

function simulateLatency(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));
}
