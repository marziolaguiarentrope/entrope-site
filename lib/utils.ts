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
