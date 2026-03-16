'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, Phone, Send, User } from 'lucide-react';
import {
  api,
  ConversationalTrip,
  InboundSms,
  MemberSummary,
  PendingSms,
  PendingSmsApprovalStatus,
  PendingSmsDetail as PendingSmsDetailData,
  UserBasicInfo,
  WakeResponse,
} from '@/lib/api';
import { PendingSmsDetail } from '@/components/pending-sms-detail';
import { cn } from '@/lib/utils';

type SectionTab = 'outbound' | 'inbound';
type QueueTab = 'pending' | 'approved' | 'rejected' | 'all';
type SortKey = 'created' | 'member' | 'message' | 'delivery';
type SortDir = 'asc' | 'desc';

type LookupMember = {
  id: string;
  email: string | null;
  phone_number: string | null;
  name: string | null;
  created_at: string | null;
};

const STATUS_PAGE_LIMIT = 500;
const INBOUND_PAGE_LIMIT = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

function previewText(text: string | null): string {
  return (text || '').replace(/\s+/g, ' ').trim();
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

  const [memberQuery, setMemberQuery] = useState('');
  const [memberLookupLoading, setMemberLookupLoading] = useState(false);
  const [memberLookupError, setMemberLookupError] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<LookupMember | null>(null);

  const [convTrips, setConvTrips] = useState<ConversationalTrip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState('');
  const [tripLoading, setTripLoading] = useState(false);
  const [tripError, setTripError] = useState<string | null>(null);

  const [guidance, setGuidance] = useState('');
  const [forceWakeToText, setForceWakeToText] = useState(false);
  const [wakeLoading, setWakeLoading] = useState(false);
  const [wakeError, setWakeError] = useState<string | null>(null);
  const [wakeSuccess, setWakeSuccess] = useState<string | null>(null);
  const [wakeMessageId, setWakeMessageId] = useState<string | null>(null);
  const [wakeResult, setWakeResult] = useState<WakeResponse | null>(null);

  const [sendBody, setSendBody] = useState('');
  const [sendStep, setSendStep] = useState<'edit' | 'confirm'>('edit');
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [sendMessageId, setSendMessageId] = useState<string | null>(null);

  const selectedMemberId = selectedMember?.id ?? null;
  const selectedMemberPhone = selectedMember?.phone_number?.trim() || null;
  const hasSelectedMemberPhone = !!selectedMemberPhone;

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

  const openDetail = useCallback(async (id: string) => {
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
  }, [messages]);

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
    setForceWakeToText(false);
    setWakeError(null);
    setWakeSuccess(null);
    setWakeMessageId(null);
    setWakeResult(null);
    setSendError(null);
    setSendSuccess(null);
    setSendMessageId(null);
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

  const selectedTrip = useMemo(
    () => convTrips.find((trip) => trip.id === selectedTripId) ?? null,
    [convTrips, selectedTripId],
  );

  const canWake = !!selectedMemberId && !!selectedTripId && !tripLoading && !wakeLoading;
  const canReviewSend =
    !!selectedMemberId && !!selectedTripId && hasSelectedMemberPhone && !!sendBody.trim() && !sendLoading;
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
        forceText: forceWakeToText,
        idempotencyKey: createIdempotencyKey(),
      });
      const draftMessageId = response.pending_sms_draft?.message_id ?? response.send_text_result?.message_id ?? null;

      setWakeResult(response);
      setWakeMessageId(draftMessageId);

      if (draftMessageId) {
        setWakeSuccess('Wake completed and created an SMS draft in the outbound approval queue.');

        setSection('outbound');
        setTab('pending');
        setSearch('');

        await fetchData();
        await openDetail(draftMessageId);
      } else {
        const reason = response.send_text_result?.reason ? ` (${formatStatusLabel(response.send_text_result.reason)})` : '';
        setWakeSuccess(
          forceWakeToText
            ? `Wake completed without creating an SMS draft${reason}.`
            : 'Wake completed without creating an SMS draft.',
        );
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
    if (!selectedMemberId || !selectedTripId || !hasSelectedMemberPhone || !sendBody.trim() || sendLoading) return;

    setSendLoading(true);
    setSendError(null);
    setSendSuccess(null);
    setSendMessageId(null);

    try {
      const response = await api.sendMemberAxelSms(selectedMemberId, selectedTripId, {
        body: sendBody.trim(),
        idempotency_key: createIdempotencyKey(),
      });

      if (response.error || response.status.toUpperCase() === 'FAILED') {
        setSendError(response.error || `SMS request returned status ${response.status}`);
        return;
      }

      setSendMessageId(response.message_id ?? null);
      setSendSuccess(
        response.status === 'SENT'
          ? 'SMS sent immediately as Axel and stored against the selected trip.'
          : `SMS request completed with status ${response.status}.`,
      );
      setSendBody('');
      setSendStep('edit');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send Axel SMS');
    } finally {
      setSendLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Text Messages</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review outbound SMS drafts, monitor inbound member replies, wake Axel on a conversational trip, or send an immediate SMS as Axel.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Select User</h2>
            <p className="text-xs text-muted-foreground">
              Search by email, phone, or user ID. The selected member is used for both SMS workflows.
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
                  <Phone className="size-3.5" />
                  <span>{selectedMemberPhone || 'No phone on file'}</span>
                </div>
                <div className="break-all">Email: {selectedMember.email || 'No email on file'}</div>
                <div>User ID: <span className="font-mono break-all">{selectedMember.id}</span></div>
                {selectedMember.created_at && <div>Joined: {formatDateTime(selectedMember.created_at)}</div>}
              </div>
              {!hasSelectedMemberPhone && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  This user has no phone number on file. Normal wake can still run, but Axel cannot create or send SMS messages until a phone number is added.
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm text-muted-foreground">
              Select a user to draft or send an Axel text message.
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Wake Axel</h2>
            <p className="text-xs text-muted-foreground">
              Wake Axel on a specific conversational trip. By default this runs the normal single-trip wake, so Axel can review the trip and decide whether an SMS is warranted. Turn on Force SMS Draft to route this run through the narrower <span className="font-mono">wake_to_text</span> path instead.
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
                      placeholder="Optional steer for Axel, such as what changed, what to focus on, or why you think a text may or may not be warranted..."
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      disabled={wakeLoading}
                    />
                  </div>

                  <label className="flex items-start gap-3 rounded-md border border-border bg-background/40 px-3 py-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={forceWakeToText}
                      onChange={(e) => {
                        setForceWakeToText(e.target.checked);
                        setWakeError(null);
                        setWakeSuccess(null);
                        setWakeMessageId(null);
                        setWakeResult(null);
                      }}
                      className="mt-0.5 rounded border-border"
                      disabled={wakeLoading}
                    />
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Force SMS Draft</div>
                      <div className="text-xs text-muted-foreground">
                        When checked, this run uses <span className="font-mono">wake_to_text</span> and constrains Axel to the SMS-draft lane. When unchecked, Axel uses normal <span className="font-mono">wake</span> and can decide for itself whether to draft a text.
                      </div>
                    </div>
                  </label>
                </>
              )}

              {!hasSelectedMemberPhone && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  The selected member has no phone number on file. Wake can still run, but any SMS drafting attempt will fail until a phone number is added.
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
                      <span className="font-medium">send_text:</span>{' '}
                      {wakeResult.send_text_called ? 'called' : 'not called'}
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-background p-3 text-sm whitespace-pre-wrap break-words">
                    {wakeResult.response || 'No wake response returned.'}
                  </div>

                  {(wakeResult.tools_used?.length || wakeResult.send_text_result || wakeResult.pending_sms_draft) && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tools Used</div>
                        <div className="text-sm">
                          {wakeResult.tools_used?.length ? wakeResult.tools_used.join(', ') : 'None'}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">SMS Outcome</div>
                        <div className="text-sm">
                          {wakeResult.pending_sms_draft?.message_id ? 'Draft created' : 'No draft created'}
                        </div>
                        {wakeResult.send_text_result?.status && (
                          <div className="text-xs text-muted-foreground">
                            Status: {formatStatusLabel(wakeResult.send_text_result.status)}
                          </div>
                        )}
                        {wakeResult.send_text_result?.reason && (
                          <div className="text-xs text-muted-foreground">
                            Reason: {formatStatusLabel(wakeResult.send_text_result.reason)}
                          </div>
                        )}
                        {wakeResult.send_text_result?.error && (
                          <div className="text-xs text-red-400">
                            Error: {wakeResult.send_text_result.error}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs text-muted-foreground">
                  {selectedMemberPhone
                    ? `${forceWakeToText ? 'Forced draft' : 'If Axel decides to text, the draft'} will target ${selectedMemberPhone}`
                    : 'No phone number on file — wake can still run, but SMS drafting is unavailable'}
                </div>
                <button
                  type="submit"
                  disabled={!canWake}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {wakeLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                  {wakeLoading
                    ? forceWakeToText
                      ? 'Axel is drafting a text...'
                      : 'Axel is reviewing the trip...'
                    : forceWakeToText
                    ? 'Wake Axel to Draft a Text'
                    : 'Wake Axel'}
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Send as Axel</h2>
            <p className="text-xs text-muted-foreground">
              Write a message on behalf of Axel and send it directly — you write the words, not Axel. Unlike the wake flow above, where Axel decides what to do and may draft an SMS for approval, here you are the author. You&apos;ll review the full message before confirming. The message is sent immediately (no approval queue) and becomes part of Axel&apos;s conversation history, so the brain will treat it as something Axel said in future interactions.
            </p>
          </div>

          {!selectedMember ? (
            <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm text-muted-foreground">
              Select a user first to compose an Axel SMS.
            </div>
          ) : (
            <form onSubmit={sendStep === 'confirm' ? handleSendSubmit : handleReviewSend} className="space-y-3">
              {!selectedTrip && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  Select a conversational trip above before sending an SMS as Axel.
                </div>
              )}

              {selectedTrip && (
                <div className="rounded-md border border-border bg-background/40 p-3 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Trip Context</div>
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
                    Are you sure you want to send this text immediately as Axel?
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Sending to {selectedMember.name || selectedMemberPhone || 'selected user'}
                    {selectedMemberPhone ? ` · ${selectedMemberPhone}` : ''}
                  </div>
                  {selectedTrip && (
                    <div className="text-xs text-muted-foreground">
                      Trip: {getTripTitle(selectedTrip)}
                    </div>
                  )}
                  <div className="rounded-md border border-border bg-background p-3 text-sm whitespace-pre-wrap break-words">
                    {sendBody.trim()}
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-muted-foreground">SMS body</label>
                  <textarea
                    value={sendBody}
                    onChange={(e) => {
                      setSendBody(e.target.value);
                      setSendError(null);
                      setSendSuccess(null);
                      setSendMessageId(null);
                    }}
                    rows={8}
                    placeholder="Write the text message the user should receive from Axel..."
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    disabled={sendLoading}
                  />
                  <div className="text-xs text-muted-foreground">
                    {sendBody.trim().length} characters
                  </div>
                </div>
              )}

              {!hasSelectedMemberPhone && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  The selected member needs a phone number on file before Axel can send an SMS.
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
                    ? 'This sends immediately as Axel and will appear in Trip SMS History.'
                    : !selectedTrip
                      ? 'Select a conversational trip before sending.'
                      : selectedMemberPhone
                      ? `Will send to ${selectedMemberPhone}`
                      : 'Selected user has no phone number on file'}
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
                    {sendLoading ? 'Sending...' : sendStep === 'confirm' ? 'Send as Axel' : 'Review SMS'}
                  </button>
                </div>
              </div>
            </form>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
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

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
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
        <p className="text-xs text-muted-foreground">
          Loaded up to {STATUS_PAGE_LIMIT} outbound SMS drafts per status from the latest queue.
        </p>
      )}

      {section === 'inbound' && hasTruncatedInbound && (
        <p className="text-xs text-muted-foreground">
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
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {outboundSorted.length}
            {search ? ` of ${tabFiltered.length}` : ''} outbound messages
          </span>
        </div>
      )}

      {!loading && section === 'inbound' && inboundFiltered.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
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
