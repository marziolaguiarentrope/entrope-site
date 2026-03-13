'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  api,
  InboundSms,
  PendingSms,
  PendingSmsApprovalStatus,
  PendingSmsDetail as PendingSmsDetailData,
} from '@/lib/api';
import { PendingSmsDetail } from '@/components/pending-sms-detail';
import { cn } from '@/lib/utils';

type SectionTab = 'outbound' | 'inbound';
type QueueTab = 'pending' | 'approved' | 'rejected' | 'all';
type SortKey = 'created' | 'member' | 'message' | 'delivery';
type SortDir = 'asc' | 'desc';

const STATUS_PAGE_LIMIT = 500;
const INBOUND_PAGE_LIMIT = 500;
const EMPTY_STATUS_TOTALS: Record<PendingSmsApprovalStatus, number> = {
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

function previewText(text: string | null): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function matchesOutboundSearch(message: PendingSms, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const bodyPreview = previewText(message.body);

  return !!(
    bodyPreview.toLowerCase().includes(q) ||
    message.to_name?.toLowerCase().includes(q) ||
    message.to_phone?.toLowerCase().includes(q) ||
    message.user_id?.toLowerCase().includes(q) ||
    message.decided_by?.toLowerCase().includes(q) ||
    message.rejection_reason?.toLowerCase().includes(q)
  );
}

function matchesInboundSearch(message: InboundSms, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const bodyPreview = previewText(message.body);

  return !!(
    bodyPreview.toLowerCase().includes(q) ||
    message.from_name?.toLowerCase().includes(q) ||
    message.from_phone?.toLowerCase().includes(q) ||
    message.user_id?.toLowerCase().includes(q)
  );
}

function sortPendingSms(items: PendingSms[], key: SortKey, dir: SortDir): PendingSms[] {
  return [...items].sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;

    switch (key) {
      case 'created':
        aVal = new Date(a.created_at).getTime();
        bVal = new Date(b.created_at).getTime();
        break;
      case 'member':
        aVal = (a.to_name || a.to_phone || '').toLowerCase();
        bVal = (b.to_name || b.to_phone || '').toLowerCase();
        break;
      case 'message':
        aVal = previewText(a.body).toLowerCase();
        bVal = previewText(b.body).toLowerCase();
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

function PendingSmsRow({
  message,
  selected,
  onClick,
}: {
  message: PendingSms;
  selected: boolean;
  onClick: () => void;
}) {
  const preview = previewText(message.body);

  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer',
        selected && 'bg-accent/40',
      )}
    >
      <td className="px-3 py-3"><ApprovalBadge status={message.approval_status} /></td>
      <td className="px-3 py-3"><DeliveryBadge status={message.status} /></td>
      <td className="px-3 py-3 text-sm whitespace-nowrap">
        <div className="font-medium">{message.to_name || 'Unknown'}</div>
        <div className="text-xs text-muted-foreground">{message.to_phone || '—'}</div>
      </td>
      <td className="px-3 py-3 text-sm">
        <div className="font-medium truncate max-w-[420px]">{preview || '—'}</div>
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(message.created_at)}</td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{message.decided_by || '—'}</td>
      <td className="px-3 py-3">
        <Link
          href={`/users-list/${message.user_id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-primary hover:underline whitespace-nowrap"
        >
          Profile →
        </Link>
      </td>
    </tr>
  );
}

function InboundSmsRow({ message }: { message: InboundSms }) {
  return (
    <tr className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors">
      <td className="px-3 py-3 text-sm whitespace-nowrap">
        <div className="font-medium">{message.from_phone || 'Unknown'}</div>
      </td>
      <td className="px-3 py-3 text-sm whitespace-nowrap">
        <div className="font-medium">{message.from_name || 'Unknown'}</div>
        <Link
          href={`/users-list/${message.user_id}`}
          className="text-xs text-primary hover:underline whitespace-nowrap"
        >
          View profile →
        </Link>
      </td>
      <td className="px-3 py-3 text-sm">
        <div className="truncate max-w-[520px]">{previewText(message.body) || '—'}</div>
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(message.created_at)}</td>
    </tr>
  );
}

export default function TextMessagesPage() {
  const [section, setSection] = useState<SectionTab>('outbound');
  const [tab, setTab] = useState<QueueTab>('pending');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [messages, setMessages] = useState<PendingSms[]>([]);
  const [statusTotals, setStatusTotals] = useState<Record<PendingSmsApprovalStatus, number>>(EMPTY_STATUS_TOTALS);
  const [inboundMessages, setInboundMessages] = useState<InboundSms[]>([]);
  const [inboundTotal, setInboundTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);

  const [selectedSmsId, setSelectedSmsId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<PendingSmsDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [pending, approved, rejected, inbound] = await Promise.all([
        api.listPendingSms({ status: 'PENDING', limit: STATUS_PAGE_LIMIT, offset: 0 }),
        api.listPendingSms({ status: 'APPROVED', limit: STATUS_PAGE_LIMIT, offset: 0 }),
        api.listPendingSms({ status: 'REJECTED', limit: STATUS_PAGE_LIMIT, offset: 0 }),
        api.listInboundSms({ limit: INBOUND_PAGE_LIMIT, offset: 0 }),
      ]);

      setStatusTotals({
        PENDING: pending.total,
        APPROVED: approved.total,
        REJECTED: rejected.total,
      });

      const byId = new Map<string, PendingSms>();
      [...pending.items, ...approved.items, ...rejected.items].forEach((item) => {
        byId.set(item.id, item);
      });

      setMessages(Array.from(byId.values()));
      setInboundMessages(inbound.items);
      setInboundTotal(inbound.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch text messages');
      setStatusTotals(EMPTY_STATUS_TOTALS);
      setMessages([]);
      setInboundMessages([]);
      setInboundTotal(0);
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
    if (!selectedSmsId) return;
    const latest = messages.find((item) => item.id === selectedSmsId);
    if (!latest) return;
    setSelectedDetail((prev) => {
      if (!prev) return prev;
      return { ...prev, message: { ...prev.message, ...latest } };
    });
  }, [messages, selectedSmsId]);

  const loadedPendingCount = messages.filter((message) => message.approval_status === 'PENDING').length;
  const loadedApprovedCount = messages.filter((message) => message.approval_status === 'APPROVED').length;
  const loadedRejectedCount = messages.filter((message) => message.approval_status === 'REJECTED').length;

  const pendingCount = statusTotals.PENDING;
  const approvedCount = statusTotals.APPROVED;
  const rejectedCount = statusTotals.REJECTED;
  const hasTruncatedOutbound =
    pendingCount > loadedPendingCount ||
    approvedCount > loadedApprovedCount ||
    rejectedCount > loadedRejectedCount;
  const hasTruncatedInbound = inboundTotal > inboundMessages.length;

  const tabFiltered = useMemo(() => {
    if (tab === 'pending') return messages.filter((message) => message.approval_status === 'PENDING');
    if (tab === 'approved') return messages.filter((message) => message.approval_status === 'APPROVED');
    if (tab === 'rejected') return messages.filter((message) => message.approval_status === 'REJECTED');
    return messages;
  }, [messages, tab]);

  const outboundSearched = useMemo(
    () => tabFiltered.filter((message) => matchesOutboundSearch(message, search)),
    [tabFiltered, search],
  );

  const outboundSorted = useMemo(
    () => sortPendingSms(outboundSearched, sortKey, sortDir),
    [outboundSearched, sortKey, sortDir],
  );

  const inboundFiltered = useMemo(
    () => [...inboundMessages]
      .filter((message) => matchesInboundSearch(message, search))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [inboundMessages, search],
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
    setSelectedSmsId(id);
    setSelectedDetail(null);
    setDetailError(null);
    setDetailLoading(true);

    try {
      const detail = await api.getPendingSmsDetail(id);
      setSelectedDetail(detail);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load SMS detail');
      const fallback = messages.find((item) => item.id === id);
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
    setSelectedSmsId(null);
    setSelectedDetail(null);
    setDetailLoading(false);
    setDetailError(null);
  }

  function handleMessageUpdate(updated: PendingSms) {
    setMessages((prev) => {
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
        <h1 className="text-2xl font-semibold">Text Messages</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review outbound SMS drafts and monitor inbound member replies
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground mb-4">
        <span>
          <span className="font-medium text-yellow-400">{pendingCount}</span> pending
          <span className="mx-1">·</span>
          <span className="font-medium text-green-400">{approvedCount}</span> approved
          <span className="mx-1">·</span>
          <span className="font-medium text-red-400">{rejectedCount}</span> rejected
        </span>
        <span>
          <span className="font-medium text-orange-400">{inboundTotal}</span> inbound
        </span>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="flex gap-1 bg-accent/30 rounded-lg p-1">
          <button
            onClick={() => {
              setSection('outbound');
              setSearch('');
            }}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              section === 'outbound' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Outbound
          </button>
          <button
            onClick={() => {
              setSection('inbound');
              setSearch('');
              closeDetail();
            }}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              section === 'inbound' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Inbound {inboundTotal > 0 && <span className="ml-1 text-xs opacity-70">({inboundTotal})</span>}
          </button>
        </div>

        {section === 'outbound' && (
          <>
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
                <option value="member">Sort: Member</option>
                <option value="message">Sort: Message</option>
                <option value="delivery">Sort: Delivery</option>
              </select>
              <button
                onClick={() => setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                className="px-3 py-1.5 text-xs font-medium bg-accent/50 text-muted-foreground rounded-lg border border-border hover:bg-accent transition-colors"
              >
                {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
              </button>
            </div>
          </>
        )}

        <div className="flex-1 max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={section === 'outbound' ? 'Search member, phone, message...' : 'Search sender, phone, message...'}
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

      {section === 'outbound' && hasTruncatedOutbound && (
        <p className="text-xs text-muted-foreground mb-4">
          Loaded up to {STATUS_PAGE_LIMIT} outbound SMS drafts per status from the latest queue.
        </p>
      )}

      {section === 'inbound' && hasTruncatedInbound && (
        <p className="text-xs text-muted-foreground mb-4">
          Loaded up to {INBOUND_PAGE_LIMIT} inbound SMS replies from the latest activity.
        </p>
      )}

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
        ) : loading && messages.length === 0 && inboundMessages.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">Loading text messages...</div>
        ) : section === 'outbound' ? (
          outboundSorted.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              {search
                ? 'No text messages match your search'
                : tab === 'pending'
                  ? 'No pending text messages'
                  : tab === 'approved'
                    ? 'No approved text messages'
                    : tab === 'rejected'
                      ? 'No rejected text messages'
                      : 'No text messages'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border bg-accent/30">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Approval</th>
                    <SortHeader label="Delivery" sortKey="delivery" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Member" sortKey="member" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Message" sortKey="message" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Drafted" sortKey="created" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Decided By</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Profile</th>
                  </tr>
                </thead>
                <tbody>
                  {outboundSorted.map((message) => (
                    <PendingSmsRow
                      key={message.id}
                      message={message}
                      selected={selectedSmsId === message.id}
                      onClick={() => openDetail(message.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : inboundFiltered.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            {search ? 'No inbound text messages match your search' : 'No inbound text messages'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-accent/30">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">From</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">User</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Message</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Received</th>
                </tr>
              </thead>
              <tbody>
                {inboundFiltered.map((message) => (
                  <InboundSmsRow key={message.id} message={message} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && section === 'outbound' && outboundSorted.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <span>
            Showing {outboundSorted.length}
            {search ? ` of ${tabFiltered.length}` : ''} outbound messages
          </span>
        </div>
      )}

      {!loading && section === 'inbound' && inboundFiltered.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <span>
            Showing {inboundFiltered.length}
            {search ? ` of ${inboundMessages.length}` : ''} inbound messages
          </span>
        </div>
      )}

      {selectedSmsId && detailLoading && !selectedDetail && (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
          <div className="w-full max-w-2xl bg-card border-l border-border h-full overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-semibold">Pending SMS</h2>
              <button onClick={closeDetail} className="p-2 hover:bg-accent rounded-md transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 text-sm text-muted-foreground">Loading SMS detail...</div>
          </div>
        </div>
      )}

      {selectedSmsId && !detailLoading && detailError && !selectedDetail && (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
          <div className="w-full max-w-2xl bg-card border-l border-border h-full overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-semibold">Pending SMS</h2>
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
        <PendingSmsDetail
          detail={selectedDetail}
          onClose={closeDetail}
          onMessageUpdate={handleMessageUpdate}
        />
      )}
    </div>
  );
}
