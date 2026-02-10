'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { api, Escalation } from '@/lib/api';
import { EscalationDetail } from '@/components/escalation-detail';

// ── Helpers ──────────────────────────────────────────────

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

// ── Types ────────────────────────────────────────────────

type TabFilter = 'open' | 'claimed' | 'all';
type SortKey = 'priority' | 'created' | 'type' | 'status';
type SortDir = 'asc' | 'desc';

const priorityOrder: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// ── Sort Logic ───────────────────────────────────────────

function sortEscalations(items: Escalation[], key: SortKey, dir: SortDir): Escalation[] {
  return [...items].sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;

    switch (key) {
      case 'priority':
        aVal = priorityOrder[a.priority] ?? 99;
        bVal = priorityOrder[b.priority] ?? 99;
        break;
      case 'created':
        aVal = new Date(a.created_at).getTime();
        bVal = new Date(b.created_at).getTime();
        break;
      case 'type':
        aVal = a.type.toLowerCase();
        bVal = b.type.toLowerCase();
        break;
      case 'status':
        aVal = a.status;
        bVal = b.status;
        break;
      default:
        return 0;
    }

    if (aVal < bVal) return dir === 'asc' ? -1 : 1;
    if (aVal > bVal) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ── Search Logic ─────────────────────────────────────────

function matchesSearch(e: Escalation, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return !!(
    e.type?.toLowerCase().includes(q) ||
    e.reason?.toLowerCase().includes(q) ||
    e.source_type?.toLowerCase().includes(q) ||
    e.priority?.toLowerCase().includes(q) ||
    e.claimed_by?.toLowerCase().includes(q) ||
    e.user_id?.toLowerCase().includes(q) ||
    e.source_id?.toLowerCase().includes(q)
  );
}

// ── Badge Components ─────────────────────────────────────

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    urgent: 'bg-red-500/20 text-red-400',
    high: 'bg-orange-500/20 text-orange-400',
    normal: 'bg-blue-500/20 text-blue-400',
    low: 'bg-zinc-500/20 text-zinc-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium uppercase whitespace-nowrap', colors[priority] || 'bg-zinc-500/20 text-zinc-400')}>
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: 'bg-yellow-500/20 text-yellow-400',
    claimed: 'bg-blue-500/20 text-blue-400',
    resolved: 'bg-green-500/20 text-green-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap', colors[status] || 'bg-zinc-500/20 text-zinc-400')}>
      {status}
    </span>
  );
}

function SourceTypeBadge({ sourceType }: { sourceType: string }) {
  const colors: Record<string, string> = {
    booking: 'bg-purple-500/20 text-purple-400',
    opportunity: 'bg-indigo-500/20 text-indigo-400',
    loop: 'bg-cyan-500/20 text-cyan-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap', colors[sourceType] || 'bg-zinc-500/20 text-zinc-400')}>
      {sourceType}
    </span>
  );
}

// ── Sort Header ──────────────────────────────────────────

function SortHeader({ label, sortKey, currentKey, dir, onSort }: {
  label: string; sortKey: SortKey; currentKey: SortKey; dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = currentKey === sortKey;
  return (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none whitespace-nowrap"
      onClick={() => onSort(sortKey)}
    >
      {label}
      {isActive && <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );
}

// ── Table Row ────────────────────────────────────────────

function EscalationRow({ escalation, onClick }: { escalation: Escalation; onClick: () => void }) {
  return (
    <tr onClick={onClick} className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer">
      <td className="px-3 py-3"><PriorityBadge priority={escalation.priority} /></td>
      <td className="px-3 py-3"><StatusBadge status={escalation.status} /></td>
      <td className="px-3 py-3 text-sm font-medium whitespace-nowrap">{escalation.type}</td>
      <td className="px-3 py-3"><SourceTypeBadge sourceType={escalation.source_type} /></td>
      <td className="px-3 py-3 text-sm max-w-[300px] truncate text-muted-foreground">
        {escalation.reason}
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {escalation.claimed_by || '—'}
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {timeAgo(escalation.created_at)}
      </td>
      <td className="px-3 py-3">
        <Link
          href={`/users-list/${escalation.user_id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-primary hover:underline whitespace-nowrap"
        >
          Profile →
        </Link>
      </td>
    </tr>
  );
}

// ── Main Page ────────────────────────────────────────────

export default function EscalationsPage() {
  // Filters & sorting
  const [tab, setTab] = useState<TabFilter>('open');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('priority');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Data
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Locally-claimed escalations that the backend won't return in list_open
  // We keep them in state so they persist when the operator navigates the page
  const claimedLocallyRef = useRef<Map<string, Escalation>>(new Map());

  // Detail panel
  const [selectedEscalation, setSelectedEscalation] = useState<Escalation | null>(null);

  // Auto-refresh
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.listEscalations({ limit: 100 });
      // The backend only returns open escalations.
      // Merge in locally-claimed ones so they don't vanish.
      const openFromServer = response.escalations;
      const localClaimed = Array.from(claimedLocallyRef.current.values());

      // Remove from local cache any that the server returned (means they were unclaimed/re-opened)
      const serverIds = new Set(openFromServer.map(e => e.id));
      localClaimed.forEach(e => {
        if (serverIds.has(e.id)) {
          claimedLocallyRef.current.delete(e.id);
        }
      });

      const merged = [
        ...openFromServer,
        ...Array.from(claimedLocallyRef.current.values()),
      ];

      setEscalations(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      setEscalations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(fetchData, 30_000);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [fetchData]);

  // Tab filter
  const tabFiltered = useMemo(() => {
    if (tab === 'open') return escalations.filter(e => e.status === 'open');
    if (tab === 'claimed') return escalations.filter(e => e.status === 'claimed');
    return escalations;
  }, [escalations, tab]);

  // Search + sort
  const searched = useMemo(
    () => tabFiltered.filter(e => matchesSearch(e, search)),
    [tabFiltered, search]
  );
  const sorted = useMemo(
    () => sortEscalations(searched, sortKey, sortDir),
    [searched, sortKey, sortDir]
  );

  // Sort handler
  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'priority' ? 'asc' : 'desc');
    }
  }

  // Counts
  const openCount = escalations.filter(e => e.status === 'open').length;
  const claimedCount = escalations.filter(e => e.status === 'claimed').length;

  // Handle escalation updates from the detail panel
  function handleUpdate(updated: Escalation) {
    // If it was just claimed, add to local cache so it persists
    if (updated.status === 'claimed') {
      claimedLocallyRef.current.set(updated.id, updated);
    }
    // If resolved, remove from local cache
    if (updated.status === 'resolved') {
      claimedLocallyRef.current.delete(updated.id);
    }

    setEscalations(prev => {
      const exists = prev.some(e => e.id === updated.id);
      if (exists) {
        return prev.map(e => e.id === updated.id ? updated : e);
      }
      return [...prev, updated];
    });
    setSelectedEscalation(updated);
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Escalations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Issues requiring operator attention
        </p>
      </div>

      {/* Summary Stats */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
        <span>
          <span className="font-medium text-yellow-400">{openCount}</span> open
          <span className="mx-1">·</span>
          <span className="font-medium text-blue-400">{claimedCount}</span> claimed
        </span>
      </div>

      {/* Tab Toggle + Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        {/* Tab toggle */}
        <div className="flex gap-1 bg-accent/30 rounded-lg p-1">
          <button
            onClick={() => setTab('open')}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === 'open' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Open {openCount > 0 && <span className="ml-1 text-xs opacity-70">({openCount})</span>}
          </button>
          <button
            onClick={() => setTab('claimed')}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === 'claimed' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Claimed {claimedCount > 0 && <span className="ml-1 text-xs opacity-70">({claimedCount})</span>}
          </button>
          <button
            onClick={() => setTab('all')}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            All
          </button>
        </div>

        {/* Sort controls */}
        <div className="flex items-center gap-1">
          <select
            value={sortKey}
            onChange={(e) => {
              const key = e.target.value as SortKey;
              setSortKey(key);
              setSortDir(key === 'priority' ? 'asc' : 'desc');
            }}
            className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="priority">Sort: Priority</option>
            <option value="created">Sort: Created</option>
            <option value="type">Sort: Type</option>
            <option value="status">Sort: Status</option>
          </select>
          <button
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-muted-foreground rounded-lg border border-border hover:bg-accent transition-colors"
          >
            {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
          </button>
        </div>

        {/* Search */}
        <div className="flex-1 max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search type, reason, user, source..."
            className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Refresh */}
        <button
          onClick={fetchData}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-muted-foreground rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
          title="Refresh"
        >
          {loading ? 'Loading...' : '↻ Refresh'}
        </button>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {error ? (
          <div className="p-6 text-center">
            <p className="text-red-400 mb-2">{error}</p>
            <button onClick={fetchData} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              Retry
            </button>
          </div>
        ) : loading && escalations.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">Loading escalations...</div>
        ) : sorted.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            {search ? 'No escalations match your search' : tab === 'claimed' ? 'No claimed escalations' : 'No open escalations'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-accent/30">
                <tr>
                  <SortHeader label="Priority" sortKey="priority" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Status" sortKey="status" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Type" sortKey="type" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Source</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Reason</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Claimed By</th>
                  <SortHeader label="Created" sortKey="created" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Profile</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(escalation => (
                  <EscalationRow
                    key={escalation.id}
                    escalation={escalation}
                    onClick={() => setSelectedEscalation(escalation)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Count info */}
      {!loading && sorted.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <span>
            Showing {sorted.length}{search ? ` of ${tabFiltered.length}` : ''} escalations
          </span>
        </div>
      )}

      {/* Detail Panel */}
      {selectedEscalation && (
        <EscalationDetail
          escalation={selectedEscalation}
          onClose={() => setSelectedEscalation(null)}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}
