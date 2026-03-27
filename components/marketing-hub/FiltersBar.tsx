'use client';

import { cn } from '@/lib/utils';
import type { Platform, DateRangePreset, MarketingFilters } from '@/lib/marketing-hub/types';
import { PLATFORMS } from '@/lib/marketing-hub/types';
import { Calendar, RefreshCw } from 'lucide-react';

interface FiltersBarProps {
  filters: MarketingFilters;
  onDateRangePreset: (preset: DateRangePreset) => void;
  onTogglePlatform: (platform: Platform) => void;
  onRefresh: () => void;
  isLoading: boolean;
}

const DATE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '14d', label: '14D' },
  { value: '30d', label: '30D' },
  { value: '60d', label: '60D' },
  { value: '90d', label: '90D' },
];

export function FiltersBar({
  filters,
  onDateRangePreset,
  onTogglePlatform,
  onRefresh,
  isLoading,
}: FiltersBarProps) {
  const formatDate = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 rounded-lg bg-secondary/50 p-1">
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              onClick={() => onDateRangePreset(preset.value)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150',
                filters.dateRangePreset === preset.value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          <span>
            {formatDate(filters.dateRange.start)} – {formatDate(filters.dateRange.end)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          {PLATFORMS.map((p) => {
            const active = filters.platforms.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => onTogglePlatform(p.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-150',
                  active
                    ? 'border-transparent text-white shadow-sm'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 bg-transparent'
                )}
                style={active ? { backgroundColor: p.color } : undefined}
              >
                {p.name}
              </button>
            );
          })}
        </div>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg border border-border hover:border-muted-foreground/50 transition-all duration-150 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          Refresh
        </button>
      </div>
    </div>
  );
}
