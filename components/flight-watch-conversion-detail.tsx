'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Ban,
  Calendar,
  CheckCircle2,
  Hand,
  Loader2,
  Mail,
  Phone,
  Plane,
  Send,
  Undo2,
  User,
} from 'lucide-react';
import {
  api,
  CommunicationView,
  FlightConversionDetail,
  FlightResultLegSnapshot,
  FlightResultSnapshot,
  Task,
} from '@/lib/api';
import { cn } from '@/lib/utils';

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

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMoneyCents(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(0)}`;
  }
}

function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function stopLabel(stops: number | null | undefined): string {
  if (stops === null || stops === undefined) return '—';
  if (stops <= 0) return 'Nonstop';
  if (stops === 1) return '1 stop';
  return `${stops} stops`;
}

function routeLabel(origin?: string | null, destination?: string | null): string {
  if (origin && destination) return `${origin} → ${destination}`;
  if (origin) return origin;
  if (destination) return destination;
  return 'Route unavailable';
}

function passengerLabel(count: number | null | undefined): string {
  if (!count || count <= 0) return 'Passengers unknown';
  return `${count} passenger${count === 1 ? '' : 's'}`;
}

function userDisplayName(user: FlightConversionDetail['user']): string {
  if (!user) return 'Unknown user';
  const first = typeof user.first_name === 'string' ? user.first_name : null;
  const last = typeof user.last_name === 'string' ? user.last_name : null;
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (typeof user.name === 'string' && user.name.trim()) return user.name;
  if (typeof user.email === 'string' && user.email.trim()) return user.email;
  return user.id;
}

function taskRequestString(task: Task, key: string): string | null {
  const value = task.request_data?.[key];
  return typeof value === 'string' && value ? value : null;
}

function taskRequestNumber(task: Task, key: string): number | null {
  const value = task.request_data?.[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
    claimed: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    blocked: 'bg-red-500/15 text-red-400 border-red-500/20',
    completed: 'bg-green-500/15 text-green-400 border-green-500/20',
  };
  return (
    <span className={cn('inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium', colors[status] || 'bg-zinc-500/15 text-zinc-300 border-zinc-500/20')}>
      {status}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return null;
  const colors: Record<string, string> = {
    success: 'bg-green-500/15 text-green-400 border-green-500/20',
    partial: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
    failure: 'bg-red-500/15 text-red-400 border-red-500/20',
  };
  return (
    <span className={cn('inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium', colors[outcome] || 'bg-zinc-500/15 text-zinc-300 border-zinc-500/20')}>
      {outcome}
    </span>
  );
}

function CommunicationBubble({ comm }: { comm: CommunicationView }) {
  return (
    <div className={cn('rounded-lg p-3 text-sm border max-w-[90%]', comm.direction === 'OUTBOUND' ? 'ml-auto bg-primary/10 border-primary/20' : 'bg-accent/40 border-border')}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <span>{comm.channel}</span>
        <span>{comm.direction}</span>
        <span>{timeAgo(comm.created_at)}</span>
      </div>
      <div className="whitespace-pre-wrap break-words">{comm.content || '—'}</div>
    </div>
  );
}

function carrierLabel(result: FlightResultSnapshot): string {
  const values = Object.values(result.carrier_names || {}).filter(Boolean);
  if (values.length > 0) return values.join(', ');
  if (Array.isArray(result.carriers) && result.carriers.length > 0) return result.carriers.join(', ');
  const candidate = [...(result.outbound?.flight_numbers || []), ...(result.return?.flight_numbers || [])]
    .map((f) => (typeof f === 'string' ? f.trim() : ''))
    .find(Boolean);
  if (candidate) {
    const code = candidate.split(/\s+/)[0];
    if (code) return code;
  }
  return 'Flight';
}

function LegLine({ label, leg }: { label: string; leg: FlightResultLegSnapshot | null }) {
  if (!leg) {
    return (
      <div className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
        {label}: unavailable
      </div>
    );
  }

  const stops = stopLabel(leg.stops);
  const duration = formatDuration(leg.duration_minutes);
  const timePart = leg.departure_time && leg.arrival_time ? `${leg.departure_time} → ${leg.arrival_time}` : 'Time unavailable';
  const stopsPart = leg.stop_cities && leg.stop_cities.length > 0 ? `via ${leg.stop_cities.join(', ')}` : null;
  const flightNos = leg.flight_numbers && leg.flight_numbers.length > 0 ? leg.flight_numbers.join(' · ') : null;

  return (
    <div className="rounded-md border border-border bg-background/40 p-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{timePart}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {stops} · {duration}
        {stopsPart ? ` · ${stopsPart}` : ''}
      </div>
      {flightNos && <div className="mt-1 text-[11px] text-muted-foreground break-words">{flightNos}</div>}
    </div>
  );
}

function SnapshotCard({
  result,
  index,
  isRoundTrip,
  isSelected = false,
}: {
  result: FlightResultSnapshot;
  index: number;
  isRoundTrip: boolean;
  isSelected?: boolean;
}) {
  const currency = result.currency || 'USD';
  const airlinePrice = formatMoneyCents(result.price_cents, currency);
  const axelPrice = formatMoneyCents(result.axel_price_cents, currency);
  const savings = formatMoneyCents(result.axel_savings_cents, currency);

  return (
    <div
      className={cn(
        'rounded-lg border p-3 space-y-2',
        isSelected ? 'border-primary/60 bg-primary/10' : 'border-border bg-accent/20',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold flex items-center gap-2">
            <span>{carrierLabel(result)}</span>
            {isSelected && (
              <span className="inline-flex items-center rounded border border-primary/40 bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                Selected
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            Result #{index + 1} · {stopLabel(result.outbound?.stops)} · {formatDuration(result.outbound?.duration_minutes)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground line-through">{airlinePrice}</div>
          <div className="text-sm font-semibold text-green-400">Axel {axelPrice}</div>
          <div className="text-xs text-green-400">Save {savings}</div>
        </div>
      </div>

      <LegLine label="Outbound" leg={result.outbound} />
      {isRoundTrip && <LegLine label="Return" leg={result.return} />}
    </div>
  );
}

interface FlightWatchConversionDetailProps {
  detail: FlightConversionDetail;
  onClose: () => void;
  onTaskUpdate: (task: Task) => void;
  onRefreshDetail: () => Promise<void>;
}

export function FlightWatchConversionDetail({
  detail,
  onClose,
  onTaskUpdate,
  onRefreshDetail,
}: FlightWatchConversionDetailProps) {
  const [replySubject, setReplySubject] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [completionOutcome, setCompletionOutcome] = useState<'success' | 'partial' | 'failure'>('success');
  const [fulfillmentOutcome, setFulfillmentOutcome] = useState('');
  const [completionNotes, setCompletionNotes] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [sentMessageIds, setSentMessageIds] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const task = detail.task;
  const context = detail.fulfillment_context;
  const route = routeLabel(
    context?.origin || taskRequestString(task, 'origin'),
    context?.destination || taskRequestString(task, 'destination'),
  );
  const departureDate = context?.departure_date || taskRequestString(task, 'departure_date');
  const returnDate = context?.return_date || taskRequestString(task, 'return_date');
  const cabin = context?.cabin || taskRequestString(task, 'cabin');
  const passengers = context?.passengers ?? taskRequestNumber(task, 'passengers');
  const convertedAt = taskRequestString(task, 'converted_at');
  const bestSavings = taskRequestNumber(task, 'best_axel_savings_cents');
  const isRoundTrip = Boolean(returnDate);
  const resultsSnapshot = context?.results_snapshot || [];
  const insightsSnapshot = context?.price_insights_snapshot || null;
  const userTargetPriceCents = insightsSnapshot?.user_target_price_cents ?? null;
  const userTargetCurrency = insightsSnapshot?.user_target_currency || 'USD';
  const userTargetSetAt = insightsSnapshot?.user_target_set_at ?? null;
  const selectedResultIndex = insightsSnapshot?.selected_result_index ?? null;
  const selectedResultSetAt = insightsSnapshot?.selected_result_set_at ?? null;
  const selectedResultSource = insightsSnapshot?.selected_result_source ?? null;
  const selectedResultSnapshot = insightsSnapshot?.selected_result_snapshot ?? null;
  const selectedResultFromList =
    selectedResultIndex !== null &&
    selectedResultIndex >= 0 &&
    selectedResultIndex < resultsSnapshot.length
      ? resultsSnapshot[selectedResultIndex]
      : null;
  const selectedResultToRender = selectedResultFromList || selectedResultSnapshot;
  const isFailed = task.status === 'failed';
  const canReply = task.status !== 'completed' && task.status !== 'blocked';
  const canClaim = task.status === 'pending';
  const canUnclaim = task.status === 'claimed';
  const canBlock = task.status === 'claimed' || task.status === 'pending' || isFailed;
  const canComplete = task.status === 'claimed' || task.status === 'pending' || isFailed;

  const memberHref = task.user_id ? `/users-list/${task.user_id}` : null;
  const userEmail = (detail.user?.email as string | null | undefined) ?? null;
  const userPhone = (detail.user?.phone as string | null | undefined) ?? (detail.user?.phone_number as string | null | undefined) ?? null;
  const effectiveMessageIds = useMemo(() => Array.from(new Set(sentMessageIds)), [sentMessageIds]);

  const clearFlash = () => {
    setError(null);
    setSuccess(null);
  };

  async function autoClaimIfNeeded(): Promise<Task | null> {
    if (task.status !== 'pending' && task.status !== 'failed') return task;
    const updated = await api.claimFlightConversionTask(task.id);
    onTaskUpdate(updated);
    return updated;
  }

  async function handleClaim() {
    if (!canClaim || actionLoading) return;
    clearFlash();
    setActionLoading('claim');
    try {
      const updated = await api.claimFlightConversionTask(task.id);
      onTaskUpdate(updated);
      setSuccess('Task claimed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim task');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleUnclaim() {
    if (!canUnclaim || actionLoading) return;
    clearFlash();
    setActionLoading('unclaim');
    try {
      const updated = await api.unclaimFlightConversionTask(task.id);
      onTaskUpdate(updated);
      setSuccess('Task released back to queue');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unclaim task');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleBlock() {
    if (!canBlock || actionLoading) return;
    if (!blockReason.trim()) {
      setError('Block reason is required');
      return;
    }
    clearFlash();
    setActionLoading('block');
    try {
      if (task.status === 'pending') {
        await autoClaimIfNeeded();
      }
      const updated = await api.blockFlightConversionTask(task.id, blockReason.trim());
      onTaskUpdate(updated);
      setSuccess('Task blocked');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to block task');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleComplete() {
    if (!canComplete || actionLoading) return;
    clearFlash();
    setActionLoading('complete');
    try {
      if (task.status === 'pending') {
        await autoClaimIfNeeded();
      }
      const updated = await api.completeFlightConversionTask(task.id, {
        outcome: completionOutcome,
        contacted_via: effectiveMessageIds.length > 0 ? 'email' : undefined,
        message_ids: effectiveMessageIds,
        fulfillment_outcome: fulfillmentOutcome.trim() || undefined,
        notes: completionNotes.trim() || undefined,
      });
      onTaskUpdate(updated);
      setSuccess('Task completed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete task');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSendMessage() {
    const body = replyBody.trim();
    if (!body || actionLoading) return;
    if (!canReply) {
      setError(`Cannot send reply while task is ${task.status}`);
      return;
    }

    clearFlash();
    setActionLoading('send');
    try {
      if (task.status === 'pending') {
        await autoClaimIfNeeded();
      }

      const idempotencyKey = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : undefined;

      const response = await api.sendFlightConversionMessage(task.id, {
        body,
        subject: replySubject.trim() || undefined,
        idempotency_key: idempotencyKey,
      });

      if (response.message_id) {
        setSentMessageIds((prev) => Array.from(new Set([...prev, response.message_id as string])));
      }
      setReplyBody('');
      setSuccess(response.status === 'SENT' ? 'Message sent as Axel' : `Message status: ${response.status}`);
      await onRefreshDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
      <div className="w-full max-w-4xl bg-card border-l border-border h-full overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-start justify-between gap-3 z-10">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold">Flight Watch Conversion</h2>
              <StatusBadge status={task.status} />
              <OutcomeBadge outcome={task.outcome} />
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{route}</div>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span>{departureDate ? formatDate(departureDate) : '—'}{returnDate ? ` → ${formatDate(returnDate)}` : ''}</span>
              <span>{passengerLabel(passengers)}</span>
              {cabin && <span className="capitalize">{cabin.replace(/_/g, ' ')}</span>}
              {convertedAt && <span>Converted {timeAgo(convertedAt)}</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-md transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          <section className="rounded-lg border border-border bg-accent/20 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-sm font-semibold">Customer & Task Context</h3>
              {memberHref && (
                <Link href={memberHref} className="text-xs text-primary hover:underline">
                  Member profile →
                </Link>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border border-border bg-background/50 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <User className="size-4 mt-0.5 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{userDisplayName(detail.user)}</div>
                    <div className="text-xs text-muted-foreground break-all">{detail.user?.id || task.user_id}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Mail className="size-3.5" />
                  <span className="break-all">{userEmail || 'No email on user record'}</span>
                </div>
                {userPhone && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Phone className="size-3.5" />
                    <span>{userPhone}</span>
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border bg-background/50 p-3 space-y-2 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Plane className="size-3.5" />
                  <span>{route}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="size-3.5" />
                  <span>{formatDate(departureDate)}{returnDate ? ` → ${formatDate(returnDate)}` : ' (one way)'}</span>
                </div>
                <div className="text-muted-foreground">Quote request: <span className="font-mono text-[11px] break-all">{detail.quote_request_id}</span></div>
                <div className="text-muted-foreground">Task: <span className="font-mono text-[11px] break-all">{task.id}</span></div>
                <div className="text-muted-foreground">Created: {formatDateTime(task.created_at)}</div>
                {task.claimed_by && <div className="text-muted-foreground">Claimed by: {task.claimed_by}</div>}
                {task.blocked_reason && <div className="text-red-400">Blocked: {task.blocked_reason}</div>}
                {bestSavings !== null && bestSavings !== undefined && (
                  <div className="text-green-400">Best shown savings: {formatMoneyCents(bestSavings, 'USD')}</div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-accent/20 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold">Price Insights Snapshot</h3>
                <p className="text-xs text-muted-foreground">
                  Pricing context the customer saw at conversion time.
                </p>
              </div>
              {insightsSnapshot?.is_fallback && (
                <span className="inline-flex items-center rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-400">
                  Estimated — no historical pricing data
                </span>
              )}
            </div>

            {!insightsSnapshot ? (
              <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                No price insights snapshot stored. This conversion predates the persistence feature.
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="rounded-md border border-border bg-background/50 p-3">
                  <div className="text-xs text-muted-foreground">Hold Target</div>
                  <div className="text-lg font-semibold">
                    {formatMoneyCents(insightsSnapshot.hold_target_cents)}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-background/50 p-3">
                  <div className="text-xs text-muted-foreground">Price Level</div>
                  <div className="text-sm font-medium capitalize">
                    {insightsSnapshot.price_level || '—'}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-background/50 p-3">
                  <div className="text-xs text-muted-foreground">
                    {insightsSnapshot.is_fallback ? 'Estimated Range' : 'Typical Range'}
                  </div>
                  <div className="text-sm font-medium">
                    {formatMoneyCents(insightsSnapshot.typical_low_cents)} -{' '}
                    {formatMoneyCents(insightsSnapshot.typical_high_cents)}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-background/50 p-3">
                  <div className="text-xs text-muted-foreground">Cheapest at Search</div>
                  <div className="text-sm font-medium">
                    {formatMoneyCents(insightsSnapshot.cheapest_price_cents)}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-background/50 p-3">
                  <div className="text-xs text-muted-foreground">User Target</div>
                  <div className="text-sm font-medium">
                    {formatMoneyCents(userTargetPriceCents, userTargetCurrency)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {userTargetSetAt ? `Set ${formatDateTime(userTargetSetAt)}` : 'Not set'}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-background/50 p-3">
                  <div className="text-xs text-muted-foreground">Selected Result</div>
                  <div className="text-sm font-medium">
                    {selectedResultIndex !== null ? `Result #${selectedResultIndex + 1}` : 'Not set'}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {selectedResultSetAt ? formatDateTime(selectedResultSetAt) : '—'}
                  </div>
                  {selectedResultSource && (
                    <div className="text-[11px] text-muted-foreground mt-1 capitalize">
                      Source: {selectedResultSource.replace(/_/g, ' ')}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-accent/20 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold">Flight Results Snapshot</h3>
                <p className="text-xs text-muted-foreground">
                  Exact airline/Axel prices the customer was shown at conversion time.
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                {resultsSnapshot.length} result{resultsSnapshot.length === 1 ? '' : 's'}
              </div>
            </div>

            {selectedResultIndex !== null && (
              <div className="mb-3 rounded-md border border-primary/30 bg-primary/10 p-2 text-xs">
                <span className="font-medium">Customer selected</span>{' '}
                <span>Result #{selectedResultIndex + 1}</span>
                {selectedResultSetAt && (
                  <span className="text-muted-foreground">{` • ${formatDateTime(selectedResultSetAt)}`}</span>
                )}
              </div>
            )}

            {!context ? (
              <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                Fulfillment context unavailable. The quote request may have been deleted or the snapshot was not persisted.
              </div>
            ) : resultsSnapshot.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                No `results_snapshot` stored on the quote request.
              </div>
            ) : (
              <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                {resultsSnapshot.map((result, index) => (
                  <SnapshotCard
                    key={`${index}-${result.price_cents}-${result.axel_price_cents ?? 'na'}`}
                    result={result}
                    index={index}
                    isRoundTrip={isRoundTrip}
                    isSelected={selectedResultIndex === index}
                  />
                ))}
              </div>
            )}

            {context && selectedResultToRender && !selectedResultFromList && (
              <div className="mt-3 space-y-2">
                <div className="text-xs text-muted-foreground">
                  Selected result snapshot (stored on quote request)
                </div>
                <SnapshotCard
                  result={selectedResultToRender}
                  index={selectedResultIndex ?? 0}
                  isRoundTrip={isRoundTrip}
                  isSelected
                />
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-accent/20 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-sm font-semibold">Recent Communications</h3>
              <span className="text-xs text-muted-foreground">{detail.recent_communications.length}</span>
            </div>
            {detail.recent_communications.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent communications found.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {detail.recent_communications.map((comm) => (
                  <CommunicationBubble key={comm.id} comm={comm} />
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-accent/20 p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Reply as Axel</h3>
              <p className="text-xs text-muted-foreground">
                Sends an operator-authored email through Communications as Axel and stores it in conversation history.
              </p>
            </div>

            <input
              type="text"
              value={replySubject}
              onChange={(e) => setReplySubject(e.target.value)}
              placeholder="Subject (optional)"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={!canReply || actionLoading === 'send'}
            />
            <textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              rows={6}
              placeholder="Write the message the customer should receive from Axel..."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={!canReply || actionLoading === 'send'}
            />

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Mail className="size-3.5" />
                <span>{userEmail || 'Email will be resolved server-side'}</span>
              </div>
              <button
                onClick={handleSendMessage}
                disabled={!canReply || !replyBody.trim() || !!actionLoading}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionLoading === 'send' ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {task.status === 'pending' ? 'Claim & Send as Axel' : 'Send as Axel'}
              </button>
            </div>

            {effectiveMessageIds.length > 0 && (
              <div className="rounded-md border border-border bg-background/40 p-2 text-xs text-muted-foreground">
                Sent message IDs: {effectiveMessageIds.join(', ')}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-accent/20 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Task Actions</h3>
              <p className="text-xs text-muted-foreground">Claim, block, or complete this fulfillment task.</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleClaim}
                disabled={!canClaim || !!actionLoading}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
              >
                {actionLoading === 'claim' ? <Loader2 className="size-4 animate-spin" /> : <Hand className="size-4" />}
                Claim
              </button>
              <button
                onClick={handleUnclaim}
                disabled={!canUnclaim || !!actionLoading}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
              >
                {actionLoading === 'unclaim' ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
                Unclaim
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2 rounded-md border border-border bg-background/40 p-3">
                <div className="text-sm font-medium">Block task</div>
                <textarea
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  rows={3}
                  placeholder="Why is this task blocked?"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={!canBlock || !!actionLoading}
                />
                <button
                  onClick={handleBlock}
                  disabled={!canBlock || !blockReason.trim() || !!actionLoading}
                  className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {actionLoading === 'block' ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
                  {task.status === 'pending' ? 'Claim & Block' : 'Block'}
                </button>
              </div>

              <div className="space-y-2 rounded-md border border-border bg-background/40 p-3">
                <div className="text-sm font-medium">Complete task</div>
                <div className="grid grid-cols-3 gap-2">
                  {(['success', 'partial', 'failure'] as const).map((outcome) => (
                    <button
                      key={outcome}
                      onClick={() => setCompletionOutcome(outcome)}
                      className={cn(
                        'rounded-md border px-2 py-1.5 text-xs font-medium capitalize',
                        completionOutcome === outcome
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-border bg-background hover:bg-accent',
                      )}
                      disabled={!!actionLoading}
                    >
                      {outcome}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={fulfillmentOutcome}
                  onChange={(e) => setFulfillmentOutcome(e.target.value)}
                  placeholder="Fulfillment outcome summary (optional)"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={!canComplete || !!actionLoading}
                />
                <textarea
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  rows={3}
                  placeholder="Internal notes (optional)"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={!canComplete || !!actionLoading}
                />
                <button
                  onClick={handleComplete}
                  disabled={!canComplete || !!actionLoading}
                  className="inline-flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {actionLoading === 'complete' ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  {task.status === 'pending' ? 'Claim & Complete' : 'Complete'} ({completionOutcome})
                </button>
              </div>
            </div>
          </section>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 flex items-start gap-2">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300 flex items-start gap-2">
              <CheckCircle2 className="size-4 mt-0.5 shrink-0" />
              <span>{success}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
