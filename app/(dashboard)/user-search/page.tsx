'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api, MemberSummary } from '@/lib/api';
import { cn } from '@/lib/utils';

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

// ── Badges ───────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-500/20 text-green-400',
    suspended: 'bg-yellow-500/20 text-yellow-400',
    banned: 'bg-red-500/20 text-red-400',
    deactivated: 'bg-zinc-500/20 text-zinc-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium', colors[status] || 'bg-zinc-500/20 text-zinc-400')}>
      {status}
    </span>
  );
}

function MembershipBadge({ membershipStatus, plan }: { membershipStatus: string | null; plan: string | null }) {
  if (!membershipStatus) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const label = plan || membershipStatus;
  const color = membershipStatus === 'active'
    ? 'bg-blue-500/20 text-blue-400'
    : 'bg-zinc-500/20 text-zinc-400';
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium', color)}>
      {label}
    </span>
  );
}

// ── Sort ─────────────────────────────────────────────────

type SortKey = 'name' | 'email' | 'phone' | 'status' | 'membership' | 'joined';
type SortDir = 'asc' | 'desc';

function sortMembers(members: MemberSummary[], key: SortKey, dir: SortDir): MemberSummary[] {
  return [...members].sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;

    switch (key) {
      case 'name':     aVal = (a.name || '').toLowerCase(); bVal = (b.name || '').toLowerCase(); break;
      case 'email':    aVal = (a.email || '').toLowerCase(); bVal = (b.email || '').toLowerCase(); break;
      case 'phone':    aVal = a.phone_number || ''; bVal = b.phone_number || ''; break;
      case 'status':   aVal = a.status; bVal = b.status; break;
      case 'membership': aVal = a.membership_status || ''; bVal = b.membership_status || ''; break;
      case 'joined':   aVal = new Date(a.created_at).getTime(); bVal = new Date(b.created_at).getTime(); break;
      default: return 0;
    }
    if (aVal < bVal) return dir === 'asc' ? -1 : 1;
    if (aVal > bVal) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ── Column Header ────────────────────────────────────────

function SortHeader({ label, sortKey, currentKey, dir, onSort }: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = currentKey === sortKey;
  return (
    <th
      className="px-4 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
      onClick={() => onSort(sortKey)}
    >
      {label}
      {isActive && (
        <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>
      )}
    </th>
  );
}

// ── Main Page ────────────────────────────────────────────

export default function UserSearchPage() {
  const router = useRouter();

  // Search state
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Accumulated results
  const [results, setResults] = useState<MemberSummary[]>([]);

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('joined');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => sortMembers(results, sortKey, sortDir), [results, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const result = await api.searchMember(search.trim());
      if (result) {
        // Deduplicate by id
        setResults((prev) => {
          const exists = prev.some((m) => m.id === result.id);
          return exists ? prev : [result, ...prev];
        });
      } else {
        setError(`No user found for "${search.trim()}"`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
      setSearch('');
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">User Search</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search by email or phone — results accumulate in the table below
        </p>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email or phone number..."
            className="flex-1 max-w-lg px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={!search.trim() || loading}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
          {results.length > 0 && (
            <button
              type="button"
              onClick={() => setResults([])}
              className="px-4 py-2 bg-accent/50 text-muted-foreground rounded-lg font-medium hover:bg-accent transition-colors"
            >
              Clear All ({results.length})
            </button>
          )}
        </div>
      </form>

      {/* Error message */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Results Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {results.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            Search for users by email or phone number. Results will accumulate here.
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-border bg-accent/30">
              <tr>
                <SortHeader label="Name"       sortKey="name"       currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Email"      sortKey="email"      currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Phone"      sortKey="phone"      currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Status"     sortKey="status"     currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Membership" sortKey="membership" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Joined"     sortKey="joined"     currentKey={sortKey} dir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((member) => (
                <tr
                  key={member.id}
                  onClick={() => router.push(`/users-list/${member.id}`)}
                  className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 text-sm font-medium">
                    {member.name || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {member.email || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {member.phone_number || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={member.status} />
                  </td>
                  <td className="px-4 py-3">
                    <MembershipBadge membershipStatus={member.membership_status} plan={member.membership_plan} />
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {timeAgo(member.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
