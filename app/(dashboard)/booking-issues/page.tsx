'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { RefreshCw, ChevronDown, ChevronRight, ExternalLink, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, RepricingPipelineIssue, RepricingPipelineResponse, RepricingIssueTypeInfo } from '@/lib/api';

function timeAgo(dateString: string): string {
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

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function getPriorityFromType(issueTypes: RepricingIssueTypeInfo[], issueType: string): number {
  return issueTypes.find((t) => t.type === issueType)?.priority ?? 99;
}

function getPriorityColor(priority: number): string {
  if (priority <= 2) return 'text-red-400';
  if (priority <= 7) return 'text-orange-400';
  return 'text-blue-400';
}

function getPriorityBadgeBg(priority: number): string {
  if (priority <= 2) return 'bg-red-500/15 text-red-400 border-red-500/20';
  if (priority <= 7) return 'bg-orange-500/15 text-orange-400 border-orange-500/20';
  return 'bg-blue-500/15 text-blue-400 border-blue-500/20';
}

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…`;
}

function IssueRow({
  issue,
  priority,
  isExpanded,
  onToggle,
}: {
  issue: RepricingPipelineIssue;
  priority: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-border hover:bg-accent/50 transition-colors cursor-pointer"
      >
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="size-3.5 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 text-muted-foreground flex-shrink-0" />
            )}
            <span
              className={cn(
                'text-xs font-mono font-semibold px-1.5 py-0.5 rounded border',
                getPriorityBadgeBg(priority)
              )}
            >
              P{priority}
            </span>
            <span className="text-sm font-medium truncate">{issue.label}</span>
          </div>
        </td>
        <td className="py-3 px-4">
          <Link
            href={`/users-list/${issue.user_id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-sm font-mono text-primary hover:underline"
          >
            {truncateId(issue.user_id)}
          </Link>
        </td>
        <td className="py-3 px-4">
          {issue.booking_id ? (
            <span className="text-sm font-mono">
              <span className="text-muted-foreground">
                {issue.booking_type === 'hotel' ? 'H' : issue.booking_type === 'flight' ? 'F' : '?'}-
              </span>
              {truncateId(issue.booking_id)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </td>
        <td className="py-3 px-4">
          {issue.reason ? (
            <span className="text-sm truncate max-w-48 block" title={issue.reason}>
              {issue.reason}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </td>
        <td className="py-3 px-4 text-right">
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {issue.created_at ? timeAgo(issue.created_at) : '—'}
          </span>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-border bg-accent/30">
          <td colSpan={5} className="px-4 py-4">
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm max-w-3xl">
              <div>
                <span className="text-muted-foreground">Issue Type</span>
                <div className="font-medium mt-0.5">
                  {issue.label}{' '}
                  <span className={cn('font-mono text-xs', getPriorityColor(priority))}>
                    (P{priority})
                  </span>
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">User</span>
                <div className="font-mono mt-0.5 flex items-center gap-1.5">
                  <span className="select-all">{issue.user_id}</span>
                  <Link
                    href={`/users-list/${issue.user_id}`}
                    className="text-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    <ExternalLink className="size-3" />
                  </Link>
                </div>
              </div>
              {issue.booking_id && (
                <div>
                  <span className="text-muted-foreground">Booking</span>
                  <div className="font-mono mt-0.5">
                    <span className="select-all">{issue.booking_id}</span>
                    <span className="text-muted-foreground ml-1.5">
                      ({issue.booking_type ?? 'unknown'})
                    </span>
                  </div>
                </div>
              )}
              {issue.opportunity_id && (
                <div>
                  <span className="text-muted-foreground">Opportunity</span>
                  <div className="font-mono mt-0.5 select-all">{issue.opportunity_id}</div>
                </div>
              )}
              {issue.watch_id && (
                <div>
                  <span className="text-muted-foreground">Watch</span>
                  <div className="font-mono mt-0.5 select-all">{issue.watch_id}</div>
                </div>
              )}
              {issue.status && (
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <div className="mt-0.5">{issue.status}</div>
                </div>
              )}
              {issue.reason && (
                <div>
                  <span className="text-muted-foreground">Reason</span>
                  <div className="mt-0.5">{issue.reason}</div>
                </div>
              )}
              {issue.approved_at && (
                <div>
                  <span className="text-muted-foreground">Approved At</span>
                  <div className="mt-0.5">{formatDate(issue.approved_at)}</div>
                </div>
              )}
              {issue.created_at && (
                <div>
                  <span className="text-muted-foreground">Created At</span>
                  <div className="mt-0.5">{formatDate(issue.created_at)}</div>
                </div>
              )}
              {issue.parsed_result && Object.keys(issue.parsed_result).length > 0 && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Parsed Result</span>
                  <pre className="mt-1 p-2 bg-background rounded border border-border text-xs overflow-x-auto max-h-40 overflow-y-auto">
                    {JSON.stringify(issue.parsed_result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function BookingIssuesPage() {
  const [data, setData] = useState<RepricingPipelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [userIdInput, setUserIdInput] = useState('');
  const [activeUserId, setActiveUserId] = useState<string | undefined>(undefined);

  const fetchData = useCallback(async (userId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getRepricingPipelineIssues(userId);
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch pipeline issues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(activeUserId);
  }, [fetchData, activeUserId]);

  const handleUserSearch = () => {
    const trimmed = userIdInput.trim();
    if (trimmed) {
      // Basic UUID validation
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(trimmed)) {
        setError('Invalid UUID format. Expected: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
        return;
      }
      setActiveUserId(trimmed);
    } else {
      setActiveUserId(undefined);
    }
    setExpandedId(null);
  };

  const handleClearUser = () => {
    setUserIdInput('');
    setActiveUserId(undefined);
    setExpandedId(null);
  };

  const filteredIssues = useMemo(() => {
    if (!data) return [];
    if (filterType === 'all') return data.issues;
    return data.issues.filter((i) => i.issue_type === filterType);
  }, [data, filterType]);

  // Summary counts
  const summaryCounts = useMemo(() => {
    if (!data) return { total: 0, critical: 0, warning: 0, info: 0 };
    const issues = data.issues;
    const issueTypes = data.issue_types;
    let critical = 0;
    let warning = 0;
    let info = 0;
    for (const issue of issues) {
      const p = getPriorityFromType(issueTypes, issue.issue_type);
      if (p <= 2) critical++;
      else if (p <= 7) warning++;
      else info++;
    }
    return { total: issues.length, critical, warning, info };
  }, [data]);

  // Generate a unique key for expanding rows (some issues may not have booking_id)
  const getRowKey = (issue: RepricingPipelineIssue, index: number) => {
    return `${issue.issue_type}-${issue.user_id}-${issue.booking_id ?? ''}-${index}`;
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Booking Issues</h1>
          <p className="text-muted-foreground mt-1">
            Repricing pipeline health — bookings needing attention
          </p>
        </div>
        <button
          onClick={() => fetchData(activeUserId)}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {/* Issue type filter */}
        <select
          value={filterType}
          onChange={(e) => {
            setFilterType(e.target.value);
            setExpandedId(null);
          }}
          className="px-3 py-2 text-sm rounded-md border border-border bg-background hover:bg-accent transition-colors"
        >
          <option value="all">All Types ({data?.issues.length ?? 0})</option>
          {data?.issue_types.map((t) => {
            const count = data.issues.filter((i) => i.issue_type === t.type).length;
            if (count === 0) return null;
            return (
              <option key={t.type} value={t.type}>
                P{t.priority} {t.label} ({count})
              </option>
            );
          })}
        </select>

        {/* User ID search */}
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              value={userIdInput}
              onChange={(e) => setUserIdInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUserSearch()}
              placeholder="Filter by user ID..."
              className="pl-8 pr-3 py-2 text-sm rounded-md border border-border bg-background w-80 placeholder:text-muted-foreground"
            />
          </div>
          <button
            onClick={handleUserSearch}
            className="px-3 py-2 text-sm font-medium rounded-md border border-border hover:bg-accent transition-colors"
          >
            Search
          </button>
          {activeUserId && (
            <button
              onClick={handleClearUser}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Issue count */}
        <div className="ml-auto text-sm text-muted-foreground">
          {filteredIssues.length} issue{filteredIssues.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Active user filter banner */}
      {activeUserId && (
        <div className="mb-4 px-3 py-2 text-sm rounded-md border border-primary/30 bg-primary/5 flex items-center gap-2">
          <span className="text-muted-foreground">Filtering by user:</span>
          <span className="font-mono text-primary">{activeUserId}</span>
          <span className="text-muted-foreground">
            — includes cross-service checks (P4–P7, P10–P11)
          </span>
        </div>
      )}

      {/* Summary badges */}
      {!loading && data && (
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm px-2.5 py-1 rounded-md bg-card border border-border">
            Total: <strong>{summaryCounts.total}</strong>
          </span>
          {summaryCounts.critical > 0 && (
            <span className="text-sm px-2.5 py-1 rounded-md bg-red-500/10 border border-red-500/20 text-red-400">
              Critical: <strong>{summaryCounts.critical}</strong>
            </span>
          )}
          {summaryCounts.warning > 0 && (
            <span className="text-sm px-2.5 py-1 rounded-md bg-orange-500/10 border border-orange-500/20 text-orange-400">
              Warning: <strong>{summaryCounts.warning}</strong>
            </span>
          )}
          {summaryCounts.info > 0 && (
            <span className="text-sm px-2.5 py-1 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400">
              Info: <strong>{summaryCounts.info}</strong>
            </span>
          )}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="border border-border rounded-lg overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-3 px-4 border-b border-border last:border-0 animate-pulse">
              <div className="h-5 w-10 bg-accent rounded" />
              <div className="h-4 w-40 bg-accent rounded" />
              <div className="h-4 w-20 bg-accent rounded" />
              <div className="h-4 w-24 bg-accent rounded" />
              <div className="ml-auto h-4 w-16 bg-accent rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="border border-red-500/30 rounded-lg p-4 bg-red-500/5">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => fetchData(activeUserId)}
            className="mt-2 text-sm text-primary hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filteredIssues.length === 0 && (
        <div className="border border-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">
            {data?.issues.length === 0
              ? 'No pipeline issues found. Everything looks healthy!'
              : 'No issues match the selected filter.'}
          </p>
        </div>
      )}

      {/* Issues table */}
      {!loading && !error && filteredIssues.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-card">
                <th className="py-2.5 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Issue Type
                </th>
                <th className="py-2.5 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  User
                </th>
                <th className="py-2.5 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Booking
                </th>
                <th className="py-2.5 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Reason
                </th>
                <th className="py-2.5 px-4 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredIssues.map((issue, idx) => {
                const key = getRowKey(issue, idx);
                const priority = data
                  ? getPriorityFromType(data.issue_types, issue.issue_type)
                  : 99;
                return (
                  <IssueRow
                    key={key}
                    issue={issue}
                    priority={priority}
                    isExpanded={expandedId === key}
                    onToggle={() =>
                      setExpandedId((prev) => (prev === key ? null : key))
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
