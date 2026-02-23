'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, PendingEmail, PendingEmailApprovalStatus, PendingEmailDetail as PendingEmailDetailData } from '@/lib/api';
import { PendingEmailDetail } from '@/components/pending-email-detail';
import { cn } from '@/lib/utils';

type TabFilter = 'pending' | 'approved' | 'rejected' | 'all';
type SortKey = 'created' | 'subject' | 'member' | 'delivery';
type SortDir = 'asc' | 'desc';

const STATUS_PAGE_LIMIT = 500;
const EMPTY_STATUS_TOTALS: Record<PendingEmailApprovalStatus, number> = {
  PENDING: 0,
  APPROVED: 0,
  REJECTED: 0,
};

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

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchesSearch(email: PendingEmail, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const bodyPreview = stripHtml(email.body || '');

  return !!(
    email.subject?.toLowerCase().includes(q) ||
    bodyPreview.toLowerCase().includes(q) ||
    email.to_name?.toLowerCase().includes(q) ||
    email.to_email?.toLowerCase().includes(q) ||
    email.user_id?.toLowerCase().includes(q) ||
    email.decided_by?.toLowerCase().includes(q) ||
    email.rejection_reason?.toLowerCase().includes(q)
  );
}

function sortPendingEmails(items: PendingEmail[], key: SortKey, dir: SortDir): PendingEmail[] {
  return [...items].sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;

    switch (key) {
      case 'created':
        aVal = new Date(a.created_at).getTime();
        bVal = new Date(b.created_at).getTime();
        break;
      case 'subject':
        aVal = (a.subject || '').toLowerCase();
        bVal = (b.subject || '').toLowerCase();
        break;
      case 'member':
        aVal = (a.to_name || a.to_email || '').toLowerCase();
        bVal = (b.to_name || b.to_email || '').toLowerCase();
        break;
      case 'delivery':
        aVal = `${a.approval_status}:${a.status}`;
        bVal = `${b.approval_status}:${b.status}`;
        break;
      default:
        return 0;
    }

    if (aVal < bVal) return dir === 'asc' ? -1 : 1;
    if (aVal > bVal) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function ApprovalBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: 'bg-yellow-500/20 text-yellow-400',
    APPROVED: 'bg-green-500/20 text-green-400',
    REJECTED: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap', colors[status] || 'bg-zinc-500/20 text-zinc-300')}>
      {status}
    </span>
  );
}

function DeliveryBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: 'bg-zinc-500/20 text-zinc-300',
    SENT: 'bg-blue-500/20 text-blue-400',
    DELIVERED: 'bg-green-500/20 text-green-400',
    FAILED: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap', colors[status] || 'bg-zinc-500/20 text-zinc-300')}>
      {status}
    </span>
  );
}

function SortHeader({
  label,
  sortKey,
  currentKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
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

function PendingEmailRow({
  email,
  selected,
  onClick,
}: {
  email: PendingEmail;
  selected: boolean;
  onClick: () => void;
}) {
  const subject = email.subject || '(No subject)';
  const preview = stripHtml(email.body || '');

  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer',
        selected && 'bg-accent/40',
      )}
    >
      <td className="px-3 py-3"><ApprovalBadge status={email.approval_status} /></td>
      <td className="px-3 py-3"><DeliveryBadge status={email.status} /></td>
      <td className="px-3 py-3 text-sm whitespace-nowrap">
        <div className="font-medium">{email.to_name || 'Unknown'}</div>
        <div className="text-xs text-muted-foreground">{email.to_email || '—'}</div>
      </td>
      <td className="px-3 py-3 text-sm">
        <div className="font-medium truncate max-w-[360px]">{subject}</div>
        <div className="text-xs text-muted-foreground truncate max-w-[420px]">{preview || '—'}</div>
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(email.created_at)}</td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{email.decided_by || '—'}</td>
      <td className="px-3 py-3">
        <Link
          href={`/users-list/${email.user_id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-primary hover:underline whitespace-nowrap"
        >
          Profile →
        </Link>
      </td>
    </tr>
  );
}

export default function PendingEmailsPage() {
  const [tab, setTab] = useState<TabFilter>('pending');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [emails, setEmails] = useState<PendingEmail[]>([]);
  const [statusTotals, setStatusTotals] = useState<Record<PendingEmailApprovalStatus, number>>(EMPTY_STATUS_TOTALS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);

  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<PendingEmailDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [pending, approved, rejected] = await Promise.all([
        api.listPendingEmails({ status: 'PENDING', limit: STATUS_PAGE_LIMIT, offset: 0 }),
        api.listPendingEmails({ status: 'APPROVED', limit: STATUS_PAGE_LIMIT, offset: 0 }),
        api.listPendingEmails({ status: 'REJECTED', limit: STATUS_PAGE_LIMIT, offset: 0 }),
      ]);

      setStatusTotals({
        PENDING: pending.total,
        APPROVED: approved.total,
        REJECTED: rejected.total,
      });

      const byId = new Map<string, PendingEmail>();
      [...pending.items, ...approved.items, ...rejected.items].forEach((item) => {
        byId.set(item.id, item);
      });

      setEmails(Array.from(byId.values()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch pending emails');
      setStatusTotals(EMPTY_STATUS_TOTALS);
      setEmails([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(() => {
      fetchData();
    }, 30_000);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [fetchData]);

  useEffect(() => {
    if (!selectedEmailId) return;
    const latest = emails.find((item) => item.id === selectedEmailId);
    if (!latest) return;
    setSelectedDetail((prev) => {
      if (!prev) return prev;
      return { ...prev, message: { ...prev.message, ...latest } };
    });
  }, [emails, selectedEmailId]);

  const loadedPendingCount = emails.filter((e) => e.approval_status === 'PENDING').length;
  const loadedApprovedCount = emails.filter((e) => e.approval_status === 'APPROVED').length;
  const loadedRejectedCount = emails.filter((e) => e.approval_status === 'REJECTED').length;

  const pendingCount = statusTotals.PENDING;
  const approvedCount = statusTotals.APPROVED;
  const rejectedCount = statusTotals.REJECTED;
  const hasTruncatedStatus =
    pendingCount > loadedPendingCount ||
    approvedCount > loadedApprovedCount ||
    rejectedCount > loadedRejectedCount;

  const tabFiltered = useMemo(() => {
    if (tab === 'pending') return emails.filter((e) => e.approval_status === 'PENDING');
    if (tab === 'approved') return emails.filter((e) => e.approval_status === 'APPROVED');
    if (tab === 'rejected') return emails.filter((e) => e.approval_status === 'REJECTED');
    return emails;
  }, [emails, tab]);

  const searched = useMemo(
    () => tabFiltered.filter((email) => matchesSearch(email, search)),
    [tabFiltered, search],
  );

  const sorted = useMemo(
    () => sortPendingEmails(searched, sortKey, sortDir),
    [searched, sortKey, sortDir],
  );

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortKey(key);
    setSortDir(key === 'created' ? 'desc' : 'asc');
  }

  async function openDetail(id: string) {
    setSelectedEmailId(id);
    setSelectedDetail(null);
    setDetailError(null);
    setDetailLoading(true);

    try {
      const detail = await api.getPendingEmailDetail(id);
      setSelectedDetail(detail);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load email detail');
      const fallback = emails.find((item) => item.id === id);
      if (fallback) {
        setSelectedDetail({
          message: fallback,
          brain_reasoning: null,
          recent_communications: [],
          member_url: `/users-list/${fallback.user_id}`,
        });
      }
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setSelectedEmailId(null);
    setSelectedDetail(null);
    setDetailLoading(false);
    setDetailError(null);
  }

  function handleMessageUpdate(updated: PendingEmail) {
    setEmails((prev) => {
      const exists = prev.some((item) => item.id === updated.id);
      if (exists) {
        return prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item));
      }
      return [updated, ...prev];
    });
    setSelectedDetail((prev) => {
      if (!prev) return prev;
      return { ...prev, message: { ...prev.message, ...updated } };
    });
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Pending Emails</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Brain-drafted emails waiting for operator approval
        </p>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
        <span>
          <span className="font-medium text-yellow-400">{pendingCount}</span> pending
          <span className="mx-1">·</span>
          <span className="font-medium text-green-400">{approvedCount}</span> approved
          <span className="mx-1">·</span>
          <span className="font-medium text-red-400">{rejectedCount}</span> rejected
        </span>
      </div>

      {hasTruncatedStatus && (
        <p className="text-xs text-muted-foreground mb-4">
          Loaded up to {STATUS_PAGE_LIMIT} emails per status from the latest queue.
        </p>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="flex gap-1 bg-accent/30 rounded-lg p-1">
          <button
            onClick={() => setTab('pending')}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === 'pending' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Pending {pendingCount > 0 && <span className="ml-1 text-xs opacity-70">({pendingCount})</span>}
          </button>
          <button
            onClick={() => setTab('approved')}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === 'approved' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Approved {approvedCount > 0 && <span className="ml-1 text-xs opacity-70">({approvedCount})</span>}
          </button>
          <button
            onClick={() => setTab('rejected')}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === 'rejected' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Rejected {rejectedCount > 0 && <span className="ml-1 text-xs opacity-70">({rejectedCount})</span>}
          </button>
          <button
            onClick={() => setTab('all')}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            All
          </button>
        </div>

        <div className="flex items-center gap-1">
          <select
            value={sortKey}
            onChange={(e) => {
              const key = e.target.value as SortKey;
              setSortKey(key);
              setSortDir(key === 'created' ? 'desc' : 'asc');
            }}
            className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="created">Sort: Drafted</option>
            <option value="subject">Sort: Subject</option>
            <option value="member">Sort: Member</option>
            <option value="delivery">Sort: Delivery</option>
          </select>
          <button
            onClick={() => setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
            className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-muted-foreground rounded-lg border border-border hover:bg-accent transition-colors"
          >
            {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
          </button>
        </div>

        <div className="flex-1 max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject, recipient, body..."
            className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <button
          onClick={() => fetchData()}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-muted-foreground rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
          title="Refresh"
        >
          {loading ? 'Loading...' : '↻ Refresh'}
        </button>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {error ? (
          <div className="p-6 text-center">
            <p className="text-red-400 mb-2">{error}</p>
            <button
              onClick={() => fetchData()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : loading && emails.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">Loading pending emails...</div>
        ) : sorted.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            {search
              ? 'No pending emails match your search'
              : tab === 'pending'
                ? 'No pending emails'
                : tab === 'approved'
                  ? 'No approved emails'
                  : tab === 'rejected'
                    ? 'No rejected emails'
                    : 'No emails'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-accent/30">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Approval</th>
                  <SortHeader label="Delivery" sortKey="delivery" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Member" sortKey="member" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Subject" sortKey="subject" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Drafted" sortKey="created" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Decided By</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Profile</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((email) => (
                  <PendingEmailRow
                    key={email.id}
                    email={email}
                    selected={selectedEmailId === email.id}
                    onClick={() => openDetail(email.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && sorted.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <span>
            Showing {sorted.length}
            {search ? ` of ${tabFiltered.length}` : ''} emails
          </span>
        </div>
      )}

      {selectedEmailId && detailLoading && !selectedDetail && (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
          <div className="w-full max-w-2xl bg-card border-l border-border h-full overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-semibold">Pending Email</h2>
              <button onClick={closeDetail} className="p-2 hover:bg-accent rounded-md transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 text-sm text-muted-foreground">Loading email detail...</div>
          </div>
        </div>
      )}

      {selectedEmailId && !detailLoading && detailError && !selectedDetail && (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
          <div className="w-full max-w-2xl bg-card border-l border-border h-full overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-semibold">Pending Email</h2>
              <button onClick={closeDetail} className="p-2 hover:bg-accent rounded-md transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 text-sm text-red-400">{detailError}</div>
          </div>
        </div>
      )}

      {selectedDetail && (
        <PendingEmailDetail
          detail={selectedDetail}
          onClose={closeDetail}
          onMessageUpdate={handleMessageUpdate}
        />
      )}
    </div>
  );
}
