'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, Mail, Send, User } from 'lucide-react';
import {
  api,
  ConversationalTrip,
  MemberSummary,
  PendingEmail,
  PendingEmailApprovalStatus,
  PendingEmailDetail as PendingEmailDetailData,
  UserBasicInfo,
  WakeResponse,
} from '@/lib/api';
import { PendingEmailDetail } from '@/components/pending-email-detail';
import { cn } from '@/lib/utils';

type QueueTab = 'pending' | 'approved' | 'rejected' | 'all';
type SortKey = 'created' | 'subject' | 'member' | 'delivery';
type SortDir = 'asc' | 'desc';

type LookupMember = {
  id: string;
  email: string | null;
  phone_number: string | null;
  name: string | null;
  created_at: string | null;
};

const STATUS_PAGE_LIMIT = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleString();
}

function formatDate(dateString: string | null | undefined): string | null {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString();
}

function formatStatusLabel(status: string | null | undefined): string {
  if (!status) return 'unknown';
  return status.replace(/_/g, ' ').toLowerCase();
}

function formatWakeModeLabel(mode: string | null | undefined): string {
  if (mode === 'wake_to_text') return 'Forced SMS draft';
  if (mode === 'wake') return 'Normal wake';
  return mode || 'Unknown';
}

function formatTripDateRange(startDate: string | null | undefined, endDate: string | null | undefined): string | null {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  if (start && end) return `${start} - ${end}`;
  return start || end;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function previewText(text: string | null | undefined): string {
  return stripHtml(text || '');
}

function createIdempotencyKey(): string | undefined {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : undefined;
}

function toLookupMember(member: MemberSummary): LookupMember {
  return {
    id: member.id,
    email: member.email,
    phone_number: member.phone_number,
    name: member.name,
    created_at: member.created_at,
  };
}

function toLookupMemberFromBasicInfo(user: UserBasicInfo): LookupMember {
  return {
    id: user.id,
    email: user.email,
    phone_number: user.phone,
    name: user.name,
    created_at: null,
  };
}

function getTripTitle(trip: ConversationalTrip): string {
  const name = typeof trip.name === 'string' ? trip.name.trim() : '';
  if (name) return name;
  const destination = typeof trip.destination === 'string' ? trip.destination.trim() : '';
  if (destination) return destination;
  return `Trip ${trip.id.slice(0, 8)}`;
}

function getTripBookingCount(trip: ConversationalTrip): number | null {
  if (typeof trip.bookings_count === 'number') return trip.bookings_count;
  if (Array.isArray(trip.bookings)) return trip.bookings.length;
  return null;
}

function getTripMeta(trip: ConversationalTrip): string {
  const parts: string[] = [];
  const destination = typeof trip.destination === 'string' ? trip.destination.trim() : '';
  const title = getTripTitle(trip);
  const dateRange = formatTripDateRange(trip.start_date, trip.end_date);
  const bookingCount = getTripBookingCount(trip);

  if (destination && destination !== title) parts.push(destination);
  if (dateRange) parts.push(dateRange);
  if (trip.archived) parts.push('archived');
  if (typeof trip.status === 'string' && trip.status.trim()) parts.push(formatStatusLabel(trip.status));
  if (bookingCount !== null) parts.push(`${bookingCount} booking${bookingCount === 1 ? '' : 's'}`);

  return parts.join(' · ');
}

function getTripOptionLabel(trip: ConversationalTrip): string {
  const meta = getTripMeta(trip);
  return meta ? `${getTripTitle(trip)} - ${meta}` : getTripTitle(trip);
}

function matchesEmailSearch(email: PendingEmail, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const bodyPreview = previewText(email.body);

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
  const preview = previewText(email.body);

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
        <div className="font-medium truncate max-w-[360px]">{email.subject || '(No subject)'}</div>
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

export default function SendEmailConvoPage() {
  const [tab, setTab] = useState<QueueTab>('pending');
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

  const [memberQuery, setMemberQuery] = useState('');
  const [memberLookupLoading, setMemberLookupLoading] = useState(false);
  const [memberLookupError, setMemberLookupError] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<LookupMember | null>(null);

  const [convTrips, setConvTrips] = useState<ConversationalTrip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState('');
  const [tripLoading, setTripLoading] = useState(false);
  const [tripError, setTripError] = useState<string | null>(null);

  const [guidance, setGuidance] = useState('');
  const [wakeLoading, setWakeLoading] = useState(false);
  const [wakeError, setWakeError] = useState<string | null>(null);
  const [wakeSuccess, setWakeSuccess] = useState<string | null>(null);
  const [wakeMessageId, setWakeMessageId] = useState<string | null>(null);
  const [wakeResult, setWakeResult] = useState<WakeResponse | null>(null);

  const [sendSubject, setSendSubject] = useState('');
  const [sendBody, setSendBody] = useState('');
  const [sendStep, setSendStep] = useState<'edit' | 'confirm'>('edit');
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [sendMessageId, setSendMessageId] = useState<string | null>(null);

  const selectedMemberId = selectedMember?.id ?? null;
  const selectedMemberEmail = selectedMember?.email?.trim() || null;
  const hasSelectedMemberEmail = !!selectedMemberEmail;

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

  const openDetail = useCallback(async (id: string) => {
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
  }, [emails]);

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

  const refreshConvTrips = useCallback(async () => {
    if (!selectedMemberId) {
      setConvTrips([]);
      setSelectedTripId('');
      setTripError(null);
      setTripLoading(false);
      return;
    }

    setTripLoading(true);
    setTripError(null);

    try {
      const trips = await api.listMemberConvTrips(selectedMemberId);
      setConvTrips(trips);
      setSelectedTripId((prev) => (trips.some((trip) => trip.id === prev) ? prev : (trips[0]?.id ?? '')));
    } catch (err) {
      setConvTrips([]);
      setSelectedTripId('');
      setTripError(err instanceof Error ? err.message : 'Failed to load conversational trips');
    } finally {
      setTripLoading(false);
    }
  }, [selectedMemberId]);

  useEffect(() => {
    setGuidance('');
    setWakeError(null);
    setWakeSuccess(null);
    setWakeMessageId(null);
    setWakeResult(null);
    setSendError(null);
    setSendSuccess(null);
    setSendMessageId(null);
    setSendSubject('');
    setSendBody('');
    setSendStep('edit');

    if (!selectedMemberId) {
      setConvTrips([]);
      setSelectedTripId('');
      setTripLoading(false);
      setTripError(null);
      return;
    }

    refreshConvTrips();
  }, [refreshConvTrips, selectedMemberId]);

  const loadedPendingCount = emails.filter((email) => email.approval_status === 'PENDING').length;
  const loadedApprovedCount = emails.filter((email) => email.approval_status === 'APPROVED').length;
  const loadedRejectedCount = emails.filter((email) => email.approval_status === 'REJECTED').length;

  const pendingCount = statusTotals.PENDING;
  const approvedCount = statusTotals.APPROVED;
  const rejectedCount = statusTotals.REJECTED;
  const hasTruncatedStatus =
    pendingCount > loadedPendingCount ||
    approvedCount > loadedApprovedCount ||
    rejectedCount > loadedRejectedCount;

  const tabFiltered = useMemo(() => {
    if (tab === 'pending') return emails.filter((email) => email.approval_status === 'PENDING');
    if (tab === 'approved') return emails.filter((email) => email.approval_status === 'APPROVED');
    if (tab === 'rejected') return emails.filter((email) => email.approval_status === 'REJECTED');
    return emails;
  }, [emails, tab]);

  const searched = useMemo(
    () => tabFiltered.filter((email) => matchesEmailSearch(email, search)),
    [tabFiltered, search],
  );

  const sorted = useMemo(
    () => sortPendingEmails(searched, sortKey, sortDir),
    [searched, sortKey, sortDir],
  );

  const selectedTrip = useMemo(
    () => convTrips.find((trip) => trip.id === selectedTripId) ?? null,
    [convTrips, selectedTripId],
  );

  const canWake = !!selectedMemberId && !!selectedTripId && !tripLoading && !wakeLoading;
  const canReviewSend =
    !!selectedMemberId && hasSelectedMemberEmail && !!sendSubject.trim() && !!sendBody.trim() && !sendLoading;
  const canSendNow = sendStep === 'confirm' && canReviewSend;

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortKey(key);
    setSortDir(key === 'created' ? 'desc' : 'asc');
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

  async function handleMemberLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = memberQuery.trim();
    if (!query || memberLookupLoading) return;

    setMemberLookupLoading(true);
    setMemberLookupError(null);
    setSelectedMember(null);

    try {
      let lookupMember: LookupMember | null = null;

      if (UUID_RE.test(query)) {
        lookupMember = toLookupMemberFromBasicInfo(await api.getUserBasicInfo(query));
      } else {
        const member = await api.searchMember(query);
        lookupMember = member ? toLookupMember(member) : null;
      }

      if (!lookupMember) {
        setMemberLookupError(`No user found for "${query}"`);
        return;
      }

      setSelectedMember(lookupMember);
      setMemberQuery('');
    } catch (err) {
      setMemberLookupError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setMemberLookupLoading(false);
    }
  }

  async function handleWakeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMemberId || !selectedTripId || wakeLoading) return;

    setWakeLoading(true);
    setWakeError(null);
    setWakeSuccess(null);
    setWakeMessageId(null);
    setWakeResult(null);

    try {
      const response = await api.wakeTrip(selectedMemberId, selectedTripId, {
        feedback: guidance.trim() || undefined,
        idempotencyKey: createIdempotencyKey(),
      });
      const draftMessageId = response.pending_email_draft?.message_id ?? response.send_email_result?.message_id ?? null;
      const reusedPending = response.send_email_result?.status === 'existing_pending';

      setWakeResult(response);
      setWakeMessageId(draftMessageId);

      if (draftMessageId) {
        setWakeSuccess(
          reusedPending
            ? 'Wake completed and re-used the existing pending email draft.'
            : 'Wake completed and created an email draft in the pending email queue.',
        );

        setTab('pending');
        setSearch('');

        await fetchData();
        await openDetail(draftMessageId);
      } else {
        const reason = response.send_email_result?.reason ? ` (${formatStatusLabel(response.send_email_result.reason)})` : '';
        setWakeSuccess(`Wake completed without creating an email draft${reason}.`);
      }
    } catch (err) {
      setWakeError(err instanceof Error ? err.message : 'Failed to wake Axel');
    } finally {
      setWakeLoading(false);
    }
  }

  function handleReviewSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canReviewSend) return;

    setSendError(null);
    setSendSuccess(null);
    setSendMessageId(null);
    setSendStep('confirm');
  }

  async function handleSendSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMemberId || !hasSelectedMemberEmail || !sendSubject.trim() || !sendBody.trim() || sendLoading) return;

    setSendLoading(true);
    setSendError(null);
    setSendSuccess(null);
    setSendMessageId(null);

    try {
      const response = await api.sendMemberAxelMessage(selectedMemberId, {
        subject: sendSubject.trim(),
        body: sendBody.trim(),
        idempotency_key: createIdempotencyKey(),
      });

      if (response.error || response.status.toUpperCase() === 'FAILED') {
        setSendError(response.error || `Email request returned status ${response.status}`);
        return;
      }

      setSendMessageId(response.message_id ?? null);
      setSendSuccess(
        response.status === 'SENT'
          ? 'Email sent immediately as Axel and stored in communications history.'
          : `Email request completed with status ${response.status}.`,
      );
      setSendSubject('');
      setSendBody('');
      setSendStep('edit');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send Axel email');
    } finally {
      setSendLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Send Email Convo</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review pending email drafts, wake Axel on a conversational trip to decide whether an email is warranted, or send an immediate email as Axel.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Select User</h2>
            <p className="text-xs text-muted-foreground">
              Search by email, phone, or user ID. The selected member is used for both email workflows.
            </p>
          </div>

          <form onSubmit={handleMemberLookup} className="space-y-2">
            <input
              type="text"
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              placeholder="user@example.com, +15555555555, or user ID"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={!memberQuery.trim() || memberLookupLoading}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {memberLookupLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                {memberLookupLoading ? 'Looking up...' : 'Find User'}
              </button>
              {selectedMember && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMember(null);
                    setMemberLookupError(null);
                    setMemberQuery('');
                  }}
                  className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </form>

          {memberLookupError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {memberLookupError}
            </div>
          )}

          {selectedMember ? (
            <div className="rounded-md border border-border bg-background/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <User className="size-4 text-muted-foreground" />
                  <span>{selectedMember.name || 'Unnamed user'}</span>
                </div>
                <Link href={`/users-list/${selectedMember.id}`} className="text-xs text-primary hover:underline">
                  Open user profile
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Mail className="size-3.5" />
                  <span>{selectedMemberEmail || 'No email on file'}</span>
                </div>
                <div>Phone: {selectedMember.phone_number || 'No phone on file'}</div>
                <div>User ID: <span className="font-mono break-all">{selectedMember.id}</span></div>
                {selectedMember.created_at && <div>Joined: {formatDateTime(selectedMember.created_at)}</div>}
              </div>
              {!hasSelectedMemberEmail && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  This user has no email address on file. Normal wake can still run, but Axel cannot create or send email messages until an email is added.
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm text-muted-foreground">
              Select a user to draft or send an Axel email.
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Wake Axel</h2>
            <p className="text-xs text-muted-foreground">
              Wake Axel on a specific conversational trip. This runs the normal single-trip <span className="font-mono">wake</span> flow, so Axel can review the trip, decide what to do, and draft an email only if it thinks outreach is warranted.
            </p>
          </div>

          {!selectedMember ? (
            <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm text-muted-foreground">
              Select a user first to load conversational trips.
            </div>
          ) : (
            <form onSubmit={handleWakeSubmit} className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs text-muted-foreground">
                  {tripLoading
                    ? 'Loading conversational trips...'
                    : `${convTrips.length} conversational trip${convTrips.length === 1 ? '' : 's'} loaded`}
                </div>
                <button
                  type="button"
                  onClick={() => refreshConvTrips()}
                  disabled={!selectedMemberId || tripLoading || wakeLoading}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {tripLoading ? 'Refreshing...' : 'Refresh trips'}
                </button>
              </div>

              {tripError && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {tripError}
                </div>
              )}

              {!tripError && tripLoading && convTrips.length === 0 && (
                <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm text-muted-foreground">
                  Loading conversational trips for the selected user...
                </div>
              )}

              {!tripLoading && !tripError && convTrips.length === 0 && (
                <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm text-muted-foreground">
                  No conversational trips are available for this user.
                </div>
              )}

              {convTrips.length > 0 && (
                <>
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-muted-foreground">Conversational trip</label>
                    <select
                      value={selectedTripId}
                      onChange={(e) => {
                        setSelectedTripId(e.target.value);
                        setWakeError(null);
                        setWakeSuccess(null);
                        setWakeMessageId(null);
                        setWakeResult(null);
                      }}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      disabled={tripLoading || wakeLoading}
                    >
                      {convTrips.map((trip) => (
                        <option key={trip.id} value={trip.id}>
                          {getTripOptionLabel(trip)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedTrip && (
                    <div className="rounded-md border border-border bg-background/40 p-3">
                      <div className="text-sm font-medium">{getTripTitle(selectedTrip)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {getTripMeta(selectedTrip) || `Trip ID ${selectedTrip.id}`}
                      </div>
                      <div className="mt-2 text-[11px] font-mono text-muted-foreground break-all">
                        Trip ID: {selectedTrip.id}
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-muted-foreground">Guidance (optional)</label>
                    <textarea
                      value={guidance}
                      onChange={(e) => {
                        setGuidance(e.target.value);
                        setWakeError(null);
                        setWakeSuccess(null);
                        setWakeMessageId(null);
                        setWakeResult(null);
                      }}
                      rows={4}
                      placeholder="Optional steer for Axel, such as what changed, what to focus on, or why you think an email may or may not be warranted..."
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      disabled={wakeLoading}
                    />
                  </div>
                </>
              )}

              {!hasSelectedMemberEmail && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  The selected member has no email address on file. Wake can still run, but any email drafting attempt will fail until an email is added.
                </div>
              )}

              {wakeError && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {wakeError}
                </div>
              )}
              {wakeSuccess && (
                <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-400">
                  {wakeSuccess}
                </div>
              )}
              {wakeMessageId && (
                <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                  Draft message ID: <span className="font-mono break-all">{wakeMessageId}</span>
                </div>
              )}
              {wakeResult && (
                <div className="rounded-md border border-border bg-background/40 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Wake Result</div>
                      <div className="text-sm font-medium">{formatWakeModeLabel(wakeResult.mode)}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium">send_email:</span>{' '}
                      {wakeResult.send_email_called ? 'called' : 'not called'}
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-background p-3 text-sm whitespace-pre-wrap break-words">
                    {wakeResult.response || 'No wake response returned.'}
                  </div>

                  {(wakeResult.tools_used?.length || wakeResult.send_email_result || wakeResult.pending_email_draft) && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tools Used</div>
                        <div className="text-sm">
                          {wakeResult.tools_used?.length ? wakeResult.tools_used.join(', ') : 'None'}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email Outcome</div>
                        <div className="text-sm">
                          {wakeResult.pending_email_draft?.message_id ? 'Draft available' : 'No draft created'}
                        </div>
                        {wakeResult.send_email_result?.status && (
                          <div className="text-xs text-muted-foreground">
                            Status: {formatStatusLabel(wakeResult.send_email_result.status)}
                          </div>
                        )}
                        {wakeResult.send_email_result?.reason && (
                          <div className="text-xs text-muted-foreground">
                            Reason: {formatStatusLabel(wakeResult.send_email_result.reason)}
                          </div>
                        )}
                        {wakeResult.send_email_result?.error && (
                          <div className="text-xs text-red-400">
                            Error: {wakeResult.send_email_result.error}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs text-muted-foreground">
                  {selectedMemberEmail
                    ? `If Axel decides to draft an email, it will target ${selectedMemberEmail}`
                    : 'No email address on file — wake can still run, but email drafting is unavailable'}
                </div>
                <button
                  type="submit"
                  disabled={!canWake}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {wakeLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                  {wakeLoading ? 'Axel is reviewing the trip...' : 'Wake Axel'}
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Send as Axel</h2>
            <p className="text-xs text-muted-foreground">
              Write an email on behalf of Axel and send it directly. Unlike the wake flow above, where Axel decides what to do and may draft an email for review, here you are the author. The email is sent immediately and becomes part of Axel&apos;s communication history.
            </p>
          </div>

          {!selectedMember ? (
            <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm text-muted-foreground">
              Select a user first to compose an Axel email.
            </div>
          ) : (
            <form onSubmit={sendStep === 'confirm' ? handleSendSubmit : handleReviewSend} className="space-y-3">
              {selectedTrip && (
                <div className="rounded-md border border-border bg-background/40 p-3 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current Trip Context</div>
                  <div className="text-sm font-medium text-foreground">{getTripTitle(selectedTrip)}</div>
                  <div className="text-xs text-muted-foreground">
                    {getTripMeta(selectedTrip) || `Trip ID ${selectedTrip.id}`}
                  </div>
                </div>
              )}

              {sendStep === 'confirm' ? (
                <div className="rounded-md border border-border bg-background/40 p-3 space-y-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Confirmation</div>
                  <div className="text-sm text-foreground">
                    Are you sure you want to send this email immediately as Axel?
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Sending to {selectedMember.name || selectedMemberEmail || 'selected user'}
                    {selectedMemberEmail ? ` · ${selectedMemberEmail}` : ''}
                  </div>
                  <div className="rounded-md border border-border bg-background p-3 space-y-2">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</div>
                      <div className="text-sm">{sendSubject.trim()}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Body</div>
                      <div className="text-sm whitespace-pre-wrap break-words">{sendBody.trim()}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-muted-foreground">Subject</label>
                    <input
                      type="text"
                      value={sendSubject}
                      onChange={(e) => {
                        setSendSubject(e.target.value);
                        setSendError(null);
                        setSendSuccess(null);
                        setSendMessageId(null);
                      }}
                      placeholder="Write the email subject..."
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      disabled={sendLoading}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-muted-foreground">Email body</label>
                    <textarea
                      value={sendBody}
                      onChange={(e) => {
                        setSendBody(e.target.value);
                        setSendError(null);
                        setSendSuccess(null);
                        setSendMessageId(null);
                      }}
                      rows={8}
                      placeholder="Write the email the user should receive from Axel..."
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      disabled={sendLoading}
                    />
                    <div className="text-xs text-muted-foreground">
                      {sendBody.trim().length} characters
                    </div>
                  </div>
                </>
              )}

              {!hasSelectedMemberEmail && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  The selected member needs an email address on file before Axel can send an email.
                </div>
              )}

              {sendError && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {sendError}
                </div>
              )}
              {sendSuccess && (
                <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-400">
                  {sendSuccess}
                </div>
              )}
              {sendMessageId && (
                <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                  Message ID: <span className="font-mono break-all">{sendMessageId}</span>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs text-muted-foreground">
                  {sendStep === 'confirm'
                    ? 'This sends immediately as Axel and will appear in communications history.'
                    : selectedMemberEmail
                      ? `Will send to ${selectedMemberEmail}`
                      : 'Selected user has no email address on file'}
                </div>
                <div className="flex items-center gap-2">
                  {sendStep === 'confirm' && (
                    <button
                      type="button"
                      onClick={() => setSendStep('edit')}
                      disabled={sendLoading}
                      className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      Back
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={sendStep === 'confirm' ? !canSendNow : !canReviewSend}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sendLoading ? <Loader2 className="size-4 animate-spin" /> : sendStep === 'confirm' ? <Send className="size-4" /> : null}
                    {sendLoading ? 'Sending...' : sendStep === 'confirm' ? 'Send as Axel' : 'Review Email'}
                  </button>
                </div>
              </div>
            </form>
          )}
        </section>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-yellow-400">{pendingCount}</span> pending
          <span className="mx-1">·</span>
          <span className="font-medium text-green-400">{approvedCount}</span> approved
          <span className="mx-1">·</span>
          <span className="font-medium text-red-400">{rejectedCount}</span> rejected
        </span>
      </div>

      {hasTruncatedStatus && (
        <p className="text-xs text-muted-foreground">
          Loaded up to {STATUS_PAGE_LIMIT} emails per status from the latest queue.
        </p>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
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
