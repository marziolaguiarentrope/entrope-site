'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Hand,
  Loader2,
  Plane,
  Undo2,
  User,
} from 'lucide-react';
import {
  AgentFlightBookingDetail,
  AgentFlightBookingSegment,
  AgentFlightBookingTraveler,
  api,
  FlightBookingPatchRequest,
  Task,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const PLACEHOLDER_CONFIRMATION_CODES = new Set(['PENDING']);

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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

function routeLabel(origin: string | null | undefined, destination: string | null | undefined): string {
  if (origin && destination) return `${origin} → ${destination}`;
  if (origin) return origin;
  if (destination) return destination;
  return 'Route unavailable';
}

function travelerName(traveler: AgentFlightBookingTraveler): string {
  const first = typeof traveler.first_name === 'string' ? traveler.first_name : null;
  const last = typeof traveler.last_name === 'string' ? traveler.last_name : null;
  const full = [first, last].filter(Boolean).join(' ').trim();
  return full || 'Traveler';
}

function userDisplayName(user: AgentFlightBookingDetail['user']): string {
  if (!user) return 'Unknown user';
  const first = typeof user.first_name === 'string' ? user.first_name : null;
  const last = typeof user.last_name === 'string' ? user.last_name : null;
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (typeof user.name === 'string' && user.name.trim()) return user.name;
  if (typeof user.email === 'string' && user.email.trim()) return user.email;
  return user.id;
}

function normalizeConfirmationCode(value: string | null | undefined): string {
  const normalized = value?.trim() || '';
  if (!normalized) return '';
  if (PLACEHOLDER_CONFIRMATION_CODES.has(normalized.toUpperCase())) return '';
  return normalized;
}

function displayConfirmationCode(value: string | null | undefined): string {
  const normalized = value?.trim() || '';
  if (!normalized) return '—';
  if (PLACEHOLDER_CONFIRMATION_CODES.has(normalized.toUpperCase())) {
    return 'Pending operator confirmation';
  }
  return normalized;
}

function formatSegmentDateTime(date: string | null | undefined, time: string | null | undefined): string {
  return [date, time].filter(Boolean).join(' ') || '—';
}

function formatSegmentFlightCode(
  carrier: string | null | undefined,
  flightNumber: string | null | undefined,
): string | null {
  const normalizedCarrier = carrier?.trim() || '';
  const normalizedFlightNumber = flightNumber?.trim() || '';
  if (!normalizedCarrier && !normalizedFlightNumber) return null;
  if (!normalizedFlightNumber) return normalizedCarrier;
  if (normalizedCarrier && normalizedFlightNumber.toUpperCase().startsWith(normalizedCarrier.toUpperCase())) {
    return normalizedFlightNumber;
  }
  return normalizedCarrier ? `${normalizedCarrier} ${normalizedFlightNumber}` : normalizedFlightNumber;
}

function segmentMarketingDisplay(segment: AgentFlightBookingSegment): string | null {
  const marketing = formatSegmentFlightCode(segment.marketing_carrier, segment.marketing_flight_number);
  const operating = formatSegmentFlightCode(segment.operating_carrier, segment.flight_number);
  if (!marketing || marketing === operating) return null;
  return marketing;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
    claimed: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    blocked: 'bg-red-500/15 text-red-400 border-red-500/20',
    completed: 'bg-green-500/15 text-green-400 border-green-500/20',
    failed: 'bg-red-500/15 text-red-400 border-red-500/20',
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

function DetailField({
  label,
  value,
  monospace = false,
}: {
  label: string;
  value: string | null | undefined;
  monospace?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-accent/20 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-sm', monospace && 'font-mono')}>{value || '—'}</div>
    </div>
  );
}

interface AgentFlightBookingDetailPanelProps {
  detail: AgentFlightBookingDetail;
  onClose: () => void;
  onTaskUpdate: (task: Task) => void;
  onRefreshDetail: () => Promise<void>;
}

export function AgentFlightBookingDetailPanel({
  detail,
  onClose,
  onTaskUpdate,
  onRefreshDetail,
}: AgentFlightBookingDetailPanelProps) {
  const task = detail.task;
  const summary = detail.summary;
  const flightBooking = detail.flight_booking;
  const initialFailureReason = typeof task.response_data?.failure_reason === 'string' ? task.response_data.failure_reason : '';
  const initialNotes = typeof task.response_data?.notes === 'string' ? task.response_data.notes : '';
  const rawRecordLocator = flightBooking?.record_locator || summary.record_locator || '';

  const [confirmationCode, setConfirmationCode] = useState(normalizeConfirmationCode(rawRecordLocator));
  const [bookingProvider, setBookingProvider] = useState(flightBooking?.booking_provider || '');
  const [completionOutcome, setCompletionOutcome] = useState<'success' | 'partial' | 'failure'>(
    task.outcome === 'success' || task.outcome === 'partial' || task.outcome === 'failure'
      ? task.outcome
      : 'success',
  );
  const [failureReason, setFailureReason] = useState(initialFailureReason);
  const [completionNotes, setCompletionNotes] = useState(initialNotes);
  const [blockReason, setBlockReason] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setConfirmationCode(normalizeConfirmationCode(flightBooking?.record_locator || summary.record_locator));
    setBookingProvider(flightBooking?.booking_provider || '');
  }, [task.id, flightBooking?.record_locator, flightBooking?.booking_provider, summary.record_locator]);

  useEffect(() => {
    setFailureReason(initialFailureReason);
    setCompletionNotes(initialNotes);
  }, [initialFailureReason, initialNotes, task.id]);

  const userName = useMemo(() => userDisplayName(detail.user), [detail.user]);
  const currentRecordLocator = normalizeConfirmationCode(rawRecordLocator);
  const currentBookingProvider = (flightBooking?.booking_provider || '').trim();
  const normalizedConfirmationCode = normalizeConfirmationCode(confirmationCode);
  const normalizedBookingProvider = bookingProvider.trim();
  const effectiveConfirmationCode = normalizedConfirmationCode || currentRecordLocator;
  const effectiveBookingProvider = normalizedBookingProvider || currentBookingProvider;
  const hasPendingBookingChanges =
    normalizedConfirmationCode !== currentRecordLocator ||
    normalizedBookingProvider !== currentBookingProvider;

  const canClaim = task.status === 'pending' || task.status === 'failed';
  const canUnclaim = task.status === 'claimed';
  const canBlock = task.status === 'pending' || task.status === 'claimed' || task.status === 'failed';
  const canComplete = task.status === 'pending' || task.status === 'claimed' || task.status === 'failed';
  const completionNeedsConfirmation = completionOutcome === 'success' && !effectiveConfirmationCode;
  const completionNeedsFailureReason =
    completionOutcome === 'failure' &&
    task.valid_failure_reasons.length > 0 &&
    !failureReason.trim();

  async function handleClaim() {
    setActionLoading('claim');
    setError(null);
    setSuccess(null);
    try {
      const updated = await api.claimAgentFlightBookingTask(task.id);
      onTaskUpdate(updated);
      setSuccess('Task claimed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim task');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleUnclaim() {
    setActionLoading('unclaim');
    setError(null);
    setSuccess(null);
    try {
      const updated = await api.unclaimAgentFlightBookingTask(task.id);
      onTaskUpdate(updated);
      setSuccess('Task returned to queue');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unclaim task');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSaveBooking() {
    if (!flightBooking?.id) {
      setError('Flight booking detail is unavailable for editing');
      return;
    }
    if (!hasPendingBookingChanges) {
      setSuccess('Booking already matches the saved values');
      setError(null);
      return;
    }
    if (!normalizedConfirmationCode && currentRecordLocator) {
      setError('Confirmation code cannot be cleared from this page');
      return;
    }
    if (!normalizedBookingProvider && currentBookingProvider) {
      setError('Booking provider cannot be cleared from this page');
      return;
    }

    const patch: FlightBookingPatchRequest = {};
    if (normalizedConfirmationCode && normalizedConfirmationCode !== currentRecordLocator) {
      patch.confirmation_code = normalizedConfirmationCode;
    }
    if (normalizedBookingProvider && normalizedBookingProvider !== currentBookingProvider) {
      patch.booking_provider = normalizedBookingProvider;
    }

    if (Object.keys(patch).length === 0) {
      setSuccess('No editable booking changes to save');
      setError(null);
      return;
    }

    setActionLoading('save');
    setError(null);
    setSuccess(null);
    try {
      await api.patchFlightBooking(flightBooking.id, patch);
      await onRefreshDetail();
      setSuccess('Booking updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update booking');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleBlock() {
    if (!blockReason.trim()) {
      setError('Enter a block reason');
      return;
    }
    setActionLoading('block');
    setError(null);
    setSuccess(null);
    try {
      const updated = await api.blockAgentFlightBookingTask(task.id, blockReason.trim());
      onTaskUpdate(updated);
      setSuccess('Task blocked');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to block task');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleComplete() {
    if (hasPendingBookingChanges) {
      setError('Save booking updates before completing the task');
      return;
    }
    if (completionNeedsConfirmation) {
      setError('A confirmation code is required for a successful completion');
      return;
    }
    if (completionNeedsFailureReason) {
      setError('Select a failure reason before completing a failed task');
      return;
    }

    setActionLoading('complete');
    setError(null);
    setSuccess(null);
    try {
      const updated = await api.completeAgentFlightBookingTask(task.id, {
        outcome: completionOutcome,
        airline_confirmation_code: completionOutcome === 'success' ? effectiveConfirmationCode : undefined,
        booking_provider: effectiveBookingProvider || undefined,
        failure_reason: completionOutcome === 'failure' ? failureReason.trim() || undefined : undefined,
        notes: completionNotes.trim() || undefined,
      });
      onTaskUpdate(updated);
      await onRefreshDetail();
      setSuccess('Task completed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete task');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <div className="h-full w-full max-w-4xl overflow-y-auto border-l border-border bg-card">
        <div className="sticky top-0 z-10 border-b border-border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold">Agent Flight Booking</h2>
                <StatusBadge status={task.status} />
                <OutcomeBadge outcome={task.outcome} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {routeLabel(summary.origin, summary.destination)} · {summary.carrier_name || summary.carrier_code || 'Carrier unavailable'}
              </p>
            </div>
            <button onClick={onClose} className="rounded-md p-2 transition-colors hover:bg-accent">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {canClaim && (
              <button
                onClick={() => void handleClaim()}
                disabled={actionLoading !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-500/15 px-3 py-2 text-sm font-medium text-blue-400 transition-colors hover:bg-blue-500/25 disabled:opacity-50"
              >
                {actionLoading === 'claim' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hand className="h-4 w-4" />}
                Claim
              </button>
            )}
            {canUnclaim && (
              <button
                onClick={() => void handleUnclaim()}
                disabled={actionLoading !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium transition-colors hover:bg-accent/70 disabled:opacity-50"
              >
                {actionLoading === 'unclaim' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                Unclaim
              </button>
            )}
            <Link
              href={`/users-list/${task.user_id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium transition-colors hover:bg-accent/70"
            >
              <User className="h-4 w-4" />
              Profile
            </Link>
          </div>
        </div>

        <div className="space-y-6 p-4">
          {(error || success) && (
            <div className={cn('rounded-lg border p-3 text-sm', error ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-green-500/30 bg-green-500/10 text-green-300')}>
              {error || success}
            </div>
          )}

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Plane className="h-4 w-4" />
              Flight Summary
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <DetailField label="Route" value={routeLabel(summary.origin, summary.destination)} />
              <DetailField label="Outbound" value={formatDateTime(summary.outbound_departure)} />
              <DetailField label="Return" value={formatDateTime(summary.return_departure)} />
              <DetailField label="Carrier" value={summary.carrier_name || summary.carrier_code} />
              <DetailField label="Flight Numbers" value={summary.flight_numbers.join(', ')} monospace />
              <DetailField label="Trip" value={[summary.trip_type?.replace(/_/g, ' '), summary.cabin, summary.fare_family].filter(Boolean).join(' · ')} />
              <DetailField label="Paid" value={formatMoneyCents(summary.price_paid_cents, summary.currency || 'USD')} />
              <DetailField label="Booking ID" value={summary.booking_id} monospace />
              <DetailField label="Task ID" value={task.id} monospace />
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-sm font-semibold">Itinerary Segments</div>
            {summary.segments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                Segment-level routing was not included on this task.
              </div>
            ) : (
              <div className="space-y-3">
                {summary.segments.map((segment, index) => {
                  const operatingFlight = formatSegmentFlightCode(segment.operating_carrier, segment.flight_number);
                  const marketedFlight = segmentMarketingDisplay(segment);
                  const segmentTripDetails = [segment.cabin, segment.fare_family].filter(Boolean).join(' · ');

                  return (
                    <div
                      key={`${segment.origin || 'segment'}-${segment.destination || 'segment'}-${index}`}
                      className="rounded-lg border border-border bg-accent/20 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">
                            Segment {index + 1} · {routeLabel(segment.origin, segment.destination)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {[
                              operatingFlight,
                              segmentTripDetails,
                            ].filter(Boolean).join(' · ') || 'Flight details unavailable'}
                          </div>
                        </div>
                        {marketedFlight && (
                          <div className="rounded-md border border-border bg-background/60 px-2 py-1 text-xs text-muted-foreground">
                            Marketed as {marketedFlight}
                          </div>
                        )}
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField label="Departure" value={formatSegmentDateTime(segment.departure_date, segment.departure_time)} />
                        <DetailField label="Arrival" value={formatSegmentDateTime(segment.arrival_date, segment.arrival_time)} />
                        <DetailField label="Operating Flight" value={operatingFlight} monospace />
                        <DetailField label="Fare" value={segmentTripDetails || '—'} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <User className="h-4 w-4" />
              Member
            </div>
            <div className="rounded-lg border border-border bg-accent/20 p-4 text-sm">
              <div className="font-medium">{userName}</div>
              <div className="mt-1 text-muted-foreground">{detail.user?.email || 'No email available'}</div>
              {detail.user?.phone && <div className="text-muted-foreground">{detail.user.phone}</div>}
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-sm font-semibold">Travelers</div>
            {summary.travelers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                Traveler details were not included on this task.
              </div>
            ) : (
              <div className="space-y-2">
                {summary.travelers.map((traveler, index) => (
                  <div key={`${travelerName(traveler)}-${index}`} className="rounded-lg border border-border bg-accent/20 p-3 text-sm">
                    <div className="font-medium">{travelerName(traveler)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {[
                        typeof traveler.date_of_birth === 'string' ? traveler.date_of_birth : null,
                        typeof traveler.gender === 'string' ? traveler.gender : null,
                      ].filter(Boolean).join(' · ') || 'No extra traveler metadata'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="text-sm font-semibold">Booking State</div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <DetailField label="Travel Status" value={flightBooking?.status || summary.booking_status} />
              <DetailField label="Record Locator" value={displayConfirmationCode(rawRecordLocator)} monospace />
              <DetailField label="Booking Provider" value={flightBooking?.booking_provider || summary.booking_provider} />
              <DetailField
                label="Current Cash Paid"
                value={flightBooking?.cash_paid ? formatMoneyCents(flightBooking.cash_paid.amount, flightBooking.cash_paid.currency) : '—'}
              />
              <DetailField label="Claimed By" value={task.claimed_by} />
              <DetailField label="Created" value={formatDateTime(task.created_at)} />
            </div>
            {task.blocked_reason && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                <div className="font-medium">Blocked reason</div>
                <div className="mt-1">{task.blocked_reason}</div>
              </div>
            )}
          </section>

          <section className="space-y-4">
            <div className="text-sm font-semibold">Operator Actions</div>

            <div className="rounded-lg border border-border bg-accent/20 p-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="font-medium">Confirmation code</span>
                  <input
                    type="text"
                    value={confirmationCode}
                    onChange={(e) => setConfirmationCode(e.target.value)}
                    placeholder="ABC123"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium">Booking provider</span>
                  <input
                    type="text"
                    value={bookingProvider}
                    onChange={(e) => setBookingProvider(e.target.value)}
                    placeholder="delta.com"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => void handleSaveBooking()}
                  disabled={actionLoading !== null || !flightBooking}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {actionLoading === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Save booking
                </button>
                <span className="text-xs text-muted-foreground">
                  Save confirmation details before marking this task complete.
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-accent/20 p-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="font-medium">Completion outcome</span>
                  <select
                    value={completionOutcome}
                    onChange={(e) => setCompletionOutcome(e.target.value as 'success' | 'partial' | 'failure')}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="success">Success</option>
                    <option value="partial">Partial</option>
                    <option value="failure">Failure</option>
                  </select>
                </label>
                {completionOutcome === 'failure' ? (
                  <label className="space-y-2 text-sm">
                    <span className="font-medium">Failure reason</span>
                    <select
                      value={failureReason}
                      onChange={(e) => setFailureReason(e.target.value)}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Select a reason</option>
                      {task.valid_failure_reasons.map((reason) => (
                        <option key={reason} value={reason}>
                          {reason}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="rounded-lg border border-border bg-background/60 p-3 text-xs text-muted-foreground">
                    Successful completion writes the confirmation code back to Travel and lets the fulfillment task close cleanly.
                  </div>
                )}
              </div>

              <label className="space-y-2 text-sm">
                <span className="font-medium">Operator notes</span>
                <textarea
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  placeholder="Optional notes for the task response"
                  rows={4}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </label>

              {(hasPendingBookingChanges || completionNeedsConfirmation || completionNeedsFailureReason) && (
                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      {hasPendingBookingChanges && <div>Booking edits are pending. Save them before completing the task.</div>}
                      {completionNeedsConfirmation && <div>A confirmation code is required for a successful completion.</div>}
                      {completionNeedsFailureReason && <div>Select a failure reason before completing the task.</div>}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => void handleComplete()}
                  disabled={actionLoading !== null || !canComplete || hasPendingBookingChanges || completionNeedsConfirmation || completionNeedsFailureReason}
                  className="inline-flex items-center gap-2 rounded-lg bg-green-500/15 px-3 py-2 text-sm font-medium text-green-400 transition-colors hover:bg-green-500/25 disabled:opacity-50"
                >
                  {actionLoading === 'complete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Complete task
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-accent/20 p-4 space-y-4">
              <label className="space-y-2 text-sm">
                <span className="font-medium">Block reason</span>
                <textarea
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Why this task should stay blocked"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </label>
              <button
                onClick={() => void handleBlock()}
                disabled={actionLoading !== null || !canBlock}
                className="inline-flex items-center gap-2 rounded-lg bg-red-500/15 px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/25 disabled:opacity-50"
              >
                {actionLoading === 'block' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                Block task
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
