'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Escalation, api, UserBasicInfo, HotelBookingDetail } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

// ── Customer Info Section ────────────────────────────────

function CustomerInfoSection({ userId }: { userId: string }) {
  const [info, setInfo] = useState<UserBasicInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getUserBasicInfo(userId)
      .then(data => { if (!cancelled) setInfo(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <section>
      <h3 className="text-sm font-medium text-muted-foreground mb-2">Customer</h3>
      <div className="bg-accent/50 rounded-lg p-3 space-y-1">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading customer info...</p>
        ) : info ? (
          <>
            {info.name && <p className="font-medium">{info.name}</p>}
            {info.email && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Email</span>
                <span>{info.email}</span>
              </div>
            )}
            {info.phone && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Phone</span>
                <span>{info.phone}</span>
              </div>
            )}
            <div className="pt-1">
              <Link
                href={`/users-list/${userId}`}
                className="text-xs text-primary hover:underline"
              >
                View Full Profile →
              </Link>
            </div>
          </>
        ) : (
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">Could not load customer info</p>
            <Link
              href={`/users-list/${userId}`}
              className="text-xs text-primary hover:underline"
            >
              View Profile →
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Booking Details Section ──────────────────────────────

function BookingDetailCard({ bookingId, label }: { bookingId: string; label: string }) {
  const [detail, setDetail] = useState<HotelBookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.getHotelBookingDetail(bookingId)
      .then(data => { if (!cancelled) setDetail(data); })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [bookingId]);

  if (loading) {
    return (
      <div className="bg-accent/50 rounded-lg p-3">
        <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="bg-accent/50 rounded-lg p-3">
        <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
        <p className="text-sm text-muted-foreground">{error || 'Could not load'}</p>
        <p className="text-xs text-muted-foreground mt-1 font-mono">{bookingId}</p>
      </div>
    );
  }

  const primaryGuest = detail.guests?.find(g => g.is_primary) || detail.guests?.[0];

  return (
    <div className="bg-accent/50 rounded-lg p-3 space-y-1">
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Hotel</span>
        <span className="font-medium">{detail.hotel_name || 'N/A'}</span>
      </div>
      {detail.city && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">City</span>
          <span>{detail.city}</span>
        </div>
      )}
      <div className="flex justify-between">
        <span className="text-muted-foreground">Check-in</span>
        <span>{formatDate(detail.check_in_date)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Check-out</span>
        <span>{formatDate(detail.check_out_date)}</span>
      </div>
      {detail.room_type && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Room</span>
          <span className="text-sm max-w-[200px] truncate text-right">{detail.room_type}</span>
        </div>
      )}
      {primaryGuest && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Guest</span>
          <span>{primaryGuest.name}</span>
        </div>
      )}
      {detail.confirmation_number && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Confirmation</span>
          <span className="font-mono text-sm">{detail.confirmation_number}</span>
        </div>
      )}
      {detail.booking_provider && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Provider</span>
          <span>{detail.booking_provider}</span>
        </div>
      )}
      <div className="flex justify-between">
        <span className="text-muted-foreground">Status</span>
        <span className={cn(
          'text-sm font-medium',
          detail.status === 'active' && 'text-green-400',
          detail.status === 'cancelled' && 'text-red-400',
        )}>
          {detail.status}
        </span>
      </div>
    </div>
  );
}

// Shows hotel details from escalation context (inline data, no API call needed)
function HotelContextSummary({ context }: { context: Record<string, unknown> }) {
  const hotelName = context.hotel_name as string | undefined;
  const checkIn = context.check_in as string | undefined;
  const checkOut = context.check_out as string | undefined;
  const roomType = context.room_type as string | undefined;
  const confirmationCode = context.confirmation_code as string | undefined;
  const oldPrice = context.old_price as number | undefined;
  const newPrice = context.new_price as number | undefined;
  const savingsAmount = context.savings_amount as number | undefined;
  const currency = (context.savings_currency || context.currency || 'USD') as string;
  const cancellationCapability = context.cancellation_capability as string | undefined;

  // Only render if we have at least some hotel data
  if (!hotelName && !checkIn && !confirmationCode) return null;

  const formatCtxMoney = (cents: number | undefined) => {
    if (cents === null || cents === undefined) return null;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  };

  return (
    <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-3 space-y-1">
      <p className="text-xs font-medium text-purple-400 mb-1">Hotel Repricing Details</p>
      {hotelName && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Hotel</span>
          <span className="font-medium">{hotelName}</span>
        </div>
      )}
      {checkIn && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Check-in</span>
          <span>{formatDate(checkIn)}</span>
        </div>
      )}
      {checkOut && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Check-out</span>
          <span>{formatDate(checkOut)}</span>
        </div>
      )}
      {roomType && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Room</span>
          <span className="text-sm max-w-[200px] truncate text-right">{roomType}</span>
        </div>
      )}
      {confirmationCode && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Confirmation</span>
          <span className="font-mono text-sm">{confirmationCode}</span>
        </div>
      )}
      {(oldPrice || newPrice) && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Price</span>
          <span>
            {oldPrice && <span className="line-through text-muted-foreground mr-1">{formatCtxMoney(oldPrice)}</span>}
            {newPrice && <span className="text-green-400">{formatCtxMoney(newPrice)}</span>}
          </span>
        </div>
      )}
      {savingsAmount && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Savings</span>
          <span className="text-green-400 font-medium">{formatCtxMoney(savingsAmount)}</span>
        </div>
      )}
      {cancellationCapability && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Cancellation</span>
          <span className={cn(
            'text-sm font-medium',
            cancellationCapability === 'we_cancel' ? 'text-green-400' : 'text-yellow-400'
          )}>
            {cancellationCapability === 'we_cancel' ? 'Auto (we cancel)' : 'Manual (they cancel)'}
          </span>
        </div>
      )}
    </div>
  );
}

function BookingDetailsSection({ escalation }: { escalation: Escalation }) {
  // Collect all booking IDs to display from source and context
  const ctx = escalation.context || {};
  const bookingIds: { id: string; label: string }[] = [];
  const seen = new Set<string>();

  const addBooking = (id: string | undefined | null, label: string) => {
    if (id && id !== 'None' && !seen.has(id)) {
      seen.add(id);
      bookingIds.push({ id, label });
    }
  };

  if (escalation.source_type === 'booking' && escalation.source_id) {
    addBooking(escalation.source_id, 'Booking');
  }

  // Pull booking IDs from context — covers opportunity-sourced, booking_failure, and other types
  addBooking(ctx.original_booking_id as string | undefined, 'Original Booking');
  addBooking(ctx.hotel_booking_id as string | undefined, 'Original Hotel Booking');
  addBooking(ctx.booking_id as string | undefined, 'Booking');
  addBooking(ctx.new_booking_id as string | undefined, 'New Booking');

  if (bookingIds.length === 0) return null;

  return (
    <section>
      <h3 className="text-sm font-medium text-muted-foreground mb-2">Booking Details</h3>
      <div className="space-y-2">
        {bookingIds.map(({ id, label }) => (
          <BookingDetailCard key={id} bookingId={id} label={label} />
        ))}
      </div>
    </section>
  );
}

// ── Context Section (structured) ─────────────────────────

function ContextSection({ context, sourceType, sourceId }: {
  context: Record<string, unknown> | null;
  sourceType: string;
  sourceId: string | null;
}) {
  if (!context || Object.keys(context).length === 0) return null;

  const actionNeeded = context.action_needed as string | undefined;
  const opportunityType = context.opportunity_type as string | undefined;
  const opportunityId = (context.opportunity_id as string | undefined) || (sourceType === 'opportunity' ? sourceId : null);

  // Fields already shown elsewhere (booking IDs, etc.)
  const shownKeys = new Set([
    'booking_id', 'original_booking_id', 'new_booking_id', 'hotel_booking_id',
    'opportunity_id', 'action_needed', 'opportunity_type', 'confirmation_code',
    'hotel_name', 'check_in', 'check_out', 'room_type',
    'old_price', 'new_price', 'savings_amount', 'savings_currency', 'currency',
    'cancellation_capability',
  ]);
  const extraFields = Object.entries(context).filter(([k]) => !shownKeys.has(k));

  return (
    <section>
      <h3 className="text-sm font-medium text-muted-foreground mb-2">Context</h3>
      <div className="space-y-2">
        {/* Action Needed — prominent */}
        {actionNeeded && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
            <p className="text-xs font-medium text-yellow-400 mb-1">Action Needed</p>
            <p className="text-sm">{actionNeeded}</p>
          </div>
        )}

        <div className="bg-accent/50 rounded-lg p-3 space-y-1">
          {/* Opportunity link */}
          {opportunityId && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Opportunity</span>
              <div className="flex items-center gap-2">
                {opportunityType && <span className="text-xs text-muted-foreground">{opportunityType}</span>}
                <span className="font-mono text-xs">{opportunityId.slice(0, 8)}...</span>
              </div>
            </div>
          )}

          {/* Link to hotel repricing tracker */}
          {(sourceType === 'opportunity' || opportunityType === 'hotel_reprice') && (
            <div className="pt-1">
              <Link
                href="/hotel-repricing-tracking"
                className="text-xs text-primary hover:underline"
              >
                View Hotel Repricing Tracker →
              </Link>
            </div>
          )}

          {/* Extra context fields not shown elsewhere */}
          {extraFields.map(([key, value]) => (
            <div key={key} className="flex justify-between">
              <span className="text-muted-foreground text-sm">{key.replace(/_/g, ' ')}</span>
              <span className="text-sm font-mono max-w-[200px] truncate text-right">
                {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Main Detail Component ────────────────────────────────

interface EscalationDetailProps {
  escalation: Escalation;
  onClose: () => void;
  onUpdate: (escalation: Escalation) => void;
}

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

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

export function EscalationDetail({ escalation, onClose, onUpdate }: EscalationDetailProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [showResolveForm, setShowResolveForm] = useState(false);

  // Confirm Booking state
  const [showConfirmBookingForm, setShowConfirmBookingForm] = useState(false);
  const [confirmBookingStep, setConfirmBookingStep] = useState<'input' | 'confirm'>('input');
  const [supplier, setSupplier] = useState('etg');
  const [supplierReference, setSupplierReference] = useState('');
  const [supplierCostAmount, setSupplierCostAmount] = useState('');
  const [supplierCostCurrency, setSupplierCostCurrency] = useState('USD');
  const [confirmBookingSuccess, setConfirmBookingSuccess] = useState(false);

  const isOpen = escalation.status === 'open';
  const isClaimed = escalation.status === 'claimed';
  const isResolved = escalation.status === 'resolved';

  // Determine if this is a booking_failure with an opportunity that can be confirmed
  const ctx = escalation.context || {};
  const opportunityId = (ctx.opportunity_id as string | undefined) || (escalation.source_type === 'opportunity' ? escalation.source_id : null);
  const isBookingFailure = escalation.type === 'booking_failure';
  const canConfirmBooking = isBookingFailure && !!opportunityId && (isClaimed || isOpen);

  const priorityColors: Record<string, string> = {
    urgent: 'bg-red-500/20 text-red-400',
    high: 'bg-orange-500/20 text-orange-400',
    normal: 'bg-blue-500/20 text-blue-400',
    low: 'bg-gray-500/20 text-gray-400',
  };

  const statusColors: Record<string, string> = {
    open: 'bg-yellow-500/20 text-yellow-400',
    claimed: 'bg-blue-500/20 text-blue-400',
    resolved: 'bg-green-500/20 text-green-400',
  };

  async function handleClaim() {
    setLoading(true);
    setError(null);
    try {
      const updated = await api.claimEscalation(escalation.id);
      onUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim');
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve() {
    if (!resolutionNotes.trim()) {
      setError('Resolution notes required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const updated = await api.resolveEscalation(escalation.id, resolutionNotes.trim());
      onUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmBooking() {
    if (!opportunityId || !supplierReference.trim()) {
      setError('Supplier reference (ETG Order ID) is required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const costAmount = supplierCostAmount ? Math.round(parseFloat(supplierCostAmount) * 100) : undefined;
      await api.confirmBooking(
        opportunityId,
        supplier,
        supplierReference.trim(),
        costAmount,
        costAmount ? supplierCostCurrency : undefined,
      );
      setConfirmBookingSuccess(true);
      setShowConfirmBookingForm(false);
      setConfirmBookingStep('input');
      // Refresh the escalation (the API auto-resolves it)
      try {
        const updated = await api.getEscalation(escalation.id);
        onUpdate(updated);
      } catch {
        // Escalation might already be resolved; just close
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm booking');
      setConfirmBookingStep('input');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
      <div className="w-full max-w-lg bg-card border-l border-border h-full overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Escalation</h2>
            <p className="text-sm text-muted-foreground">{escalation.type}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-accent rounded-md transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Status & Priority */}
          <div className="flex items-center gap-2">
            <span className={cn('px-2 py-1 text-xs font-medium rounded uppercase', statusColors[escalation.status] || 'bg-gray-500/20 text-gray-400')}>
              {escalation.status}
            </span>
            <span className={cn('px-2 py-1 text-xs font-medium rounded uppercase', priorityColors[escalation.priority] || 'bg-gray-500/20 text-gray-400')}>
              {escalation.priority}
            </span>
            {escalation.claimed_by && (
              <span className="text-sm text-muted-foreground">
                by {escalation.claimed_by}
              </span>
            )}
          </div>

          {/* Reason */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Reason</h3>
            <div className="bg-accent/50 rounded-lg p-3">
              <p className="text-sm">{escalation.reason}</p>
            </div>
          </section>

          {/* Customer Info */}
          <CustomerInfoSection userId={escalation.user_id} />

          {/* Booking Details — works for both booking and opportunity source types */}
          <BookingDetailsSection escalation={escalation} />

          {/* Hotel Repricing Context (inline data from escalation context) */}
          {escalation.context && (
            <HotelContextSummary context={escalation.context} />
          )}

          {/* Source */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Source</h3>
            <div className="bg-accent/50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type</span>
                <span className="font-medium">{escalation.source_type}</span>
              </div>
              {escalation.source_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ID</span>
                  <span className="font-mono text-xs">{escalation.source_id}</span>
                </div>
              )}
            </div>
          </section>

          {/* Context — structured display */}
          <ContextSection
            context={escalation.context}
            sourceType={escalation.source_type}
            sourceId={escalation.source_id}
          />

          {/* Timestamps */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Timeline</h3>
            <div className="bg-accent/50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span className="text-sm">{formatDateTime(escalation.created_at)} ({timeAgo(escalation.created_at)})</span>
              </div>
              {escalation.claimed_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Claimed</span>
                  <span className="text-sm">{formatDateTime(escalation.claimed_at)}</span>
                </div>
              )}
              {escalation.resolved_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Resolved</span>
                  <span className="text-sm">{formatDateTime(escalation.resolved_at)}</span>
                </div>
              )}
            </div>
          </section>

          {/* Resolution Notes (if resolved) */}
          {isResolved && escalation.resolution_notes && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Resolution Notes</h3>
              <div className="bg-green-500/10 rounded-lg p-3">
                <p className="text-sm">{escalation.resolution_notes}</p>
              </div>
            </section>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-500/20 text-red-400 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Confirm Booking Success Banner */}
          {confirmBookingSuccess && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-green-400">Booking Confirmed</p>
                  <p className="text-xs text-muted-foreground">
                    Opportunity moved to EXECUTING. The charge cron will process payment automatically (runs hourly).
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Confirm Booking Action (for booking_failure escalations) */}
          {canConfirmBooking && !showConfirmBookingForm && !confirmBookingSuccess && (
            <div className="space-y-2">
              <button
                onClick={() => setShowConfirmBookingForm(true)}
                className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                Confirm Manual Booking
              </button>
              <p className="text-xs text-muted-foreground text-center">
                Use this after manually booking on RateHawk/ETG. This moves the opportunity to EXECUTING and auto-resolves the escalation.
              </p>
            </div>
          )}

          {canConfirmBooking && showConfirmBookingForm && confirmBookingStep === 'input' && (
            <div className="space-y-4 bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h4 className="text-sm font-medium">Confirm Manual Booking</h4>
              </div>

              {/* Opportunity ID (read-only) */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Opportunity ID</label>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs bg-accent/50 px-2 py-1.5 rounded flex-1 truncate">{opportunityId}</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(opportunityId!)}
                    className="shrink-0 p-1.5 hover:bg-accent rounded transition-colors text-muted-foreground hover:text-foreground"
                    title="Copy"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth={2} />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth={2} />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Supplier */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Supplier</label>
                <select
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                >
                  <option value="etg">ETG / RateHawk</option>
                  <option value="booking_com">Booking.com</option>
                  <option value="expedia">Expedia</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Supplier Reference (ETG Order ID) */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Supplier Reference (ETG Order ID) *
                </label>
                <input
                  type="text"
                  value={supplierReference}
                  onChange={(e) => setSupplierReference(e.target.value)}
                  placeholder="e.g. 835283355"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm font-mono"
                />
              </div>

              {/* Optional: Supplier Cost */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    Supplier Cost (optional)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={supplierCostAmount}
                      onChange={(e) => setSupplierCostAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-7 pr-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Currency</label>
                  <select
                    value={supplierCostCurrency}
                    onChange={(e) => setSupplierCostCurrency(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (!supplierReference.trim()) {
                      setError('Supplier reference is required');
                      return;
                    }
                    setError(null);
                    setConfirmBookingStep('confirm');
                  }}
                  className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Review & Confirm
                </button>
                <button
                  onClick={() => { setShowConfirmBookingForm(false); setError(null); }}
                  className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Confirm Booking — Confirmation Step */}
          {canConfirmBooking && showConfirmBookingForm && confirmBookingStep === 'confirm' && (
            <div className="space-y-4 bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <h4 className="text-sm font-medium">Confirm Booking — Double Check</h4>
              </div>

              <div className="bg-accent/50 rounded-lg p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Opportunity</span>
                  <span className="font-mono text-xs">{opportunityId?.slice(0, 12)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Supplier</span>
                  <span className="font-medium">{supplier === 'etg' ? 'ETG / RateHawk' : supplier}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reference</span>
                  <span className="font-mono font-medium">{supplierReference}</span>
                </div>
                {supplierCostAmount && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Supplier Cost</span>
                    <span>${parseFloat(supplierCostAmount).toFixed(2)} {supplierCostCurrency}</span>
                  </div>
                )}
              </div>

              <div className="text-xs text-yellow-400 space-y-1">
                <p>This will:</p>
                <ul className="list-disc list-inside space-y-0.5 ml-1">
                  <li>Move the opportunity from NEEDS_INTERVENTION → EXECUTING</li>
                  <li>Mark the new booking as CONFIRMED with supplier details</li>
                  <li>Create the Money Rescue record (tracks customer savings)</li>
                  <li>Auto-resolve this escalation</li>
                </ul>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleConfirmBooking}
                  disabled={loading}
                  className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Confirming...' : 'Confirm Booking'}
                </button>
                <button
                  onClick={() => setConfirmBookingStep('input')}
                  disabled={loading}
                  className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {/* Actions */}
          {isOpen && (
            <button
              onClick={handleClaim}
              disabled={loading}
              className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Claiming...' : 'Claim Escalation'}
            </button>
          )}

          {isClaimed && !showResolveForm && !showConfirmBookingForm && (
            <button
              onClick={() => setShowResolveForm(true)}
              className="w-full py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
            >
              Resolve Escalation
            </button>
          )}

          {isClaimed && showResolveForm && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Resolution Notes *</label>
                <textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="Describe how the escalation was resolved..."
                  rows={4}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleResolve}
                  disabled={loading}
                  className="flex-1 py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Resolving...' : 'Confirm Resolution'}
                </button>
                <button
                  onClick={() => setShowResolveForm(false)}
                  className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
