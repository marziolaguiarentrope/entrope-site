import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Safely parse a date string, handling date-only strings (YYYY-MM-DD) correctly.
 * Date-only strings are parsed as UTC by JavaScript, which causes off-by-one errors
 * when displayed in local time. This appends T00:00:00 to force local time parsing.
 */
export function parseLocalDate(dateStr: string): Date {
  // Date-only format: YYYY-MM-DD (exactly 10 chars, matches pattern)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(dateStr + 'T00:00:00');
  }
  return new Date(dateStr);
}

/**
 * Format a date string for display. Handles date-only strings without timezone shift.
 */
export function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  return parseLocalDate(dateStr).toLocaleDateString();
}

// ── Currency / Money Utilities ────────────────────────────

/**
 * Minor-unit multipliers per currency (ISO 4217).
 * Most currencies use 100 (2 decimal places).
 * Notable exceptions: JPY/KRW = 1, BHD/KWD/OMR = 1000.
 */
const CURRENCY_SUB_UNITS: Record<string, number> = {
  BHD: 1000, KWD: 1000, OMR: 1000,           // 3 decimal places
  JPY: 1, KRW: 1, VND: 1, CLP: 1, ISK: 1,    // 0 decimal places
};
const DEFAULT_SUB_UNIT = 100; // 2 decimal places (USD, EUR, GBP, etc.)

/**
 * Convert a display amount to integer minor units for the given currency.
 *
 * Examples:
 *   toMinorUnits(19.99, "USD") → 1999
 *   toMinorUnits(1000, "JPY")  → 1000
 *   toMinorUnits(5.123, "BHD") → 5123
 */
export function toMinorUnits(amount: number, currency: string): number {
  const subUnit = CURRENCY_SUB_UNITS[currency.toUpperCase()] ?? DEFAULT_SUB_UNIT;
  return Math.round(amount * subUnit);
}

/**
 * Convert integer minor units to a display amount for the given currency.
 *
 * Examples:
 *   fromMinorUnits(1999, "USD") → 19.99
 *   fromMinorUnits(1000, "JPY") → 1000
 */
export function fromMinorUnits(amount: number, currency: string): number {
  const subUnit = CURRENCY_SUB_UNITS[currency.toUpperCase()] ?? DEFAULT_SUB_UNIT;
  return amount / subUnit;
}

// ── Export Utilities ─────────────────────────────────────

/**
 * Convert an array of flat objects to a CSV string.
 * Handles commas, quotes, and newlines in values.
 */
export function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (val: unknown): string => {
    const str = val === null || val === undefined ? '' : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(h => escape(row[h])).join(',')),
  ];
  return lines.join('\n');
}

/**
 * Trigger a file download in the browser.
 */
export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Download data as CSV.
 */
export function exportCSV(rows: Record<string, unknown>[], filename: string) {
  downloadFile(toCSV(rows), filename, 'text/csv;charset=utf-8;');
}

/**
 * Download data as JSON.
 */
export function exportJSON(data: unknown, filename: string) {
  downloadFile(JSON.stringify(data, null, 2), filename, 'application/json');
}

/**
 * Relative time string ("just now", "5m ago", "3d ago", etc.).
 * Falls back to locale date string for anything older than a week.
 */
export function timeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}
