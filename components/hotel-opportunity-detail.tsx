'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { HotelOpportunity, BookingEnrichment, api, RawEmail, UserBasicInfo, MemberContext, HotelOpportunityView } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

// ── Helpers ──────────────────────────────────────────────

function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(amount / 100);
}

function formatMoneyObj(price: { amount: number; currency: string } | null | undefined): string {
  if (!price) return '—';
  return formatMoney(price.amount, price.currency);
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

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 p-1 hover:bg-accent rounded transition-colors text-muted-foreground hover:text-foreground"
      title={copied ? 'Copied!' : 'Copy'}
    >
      {copied ? (
        <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth={2} />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth={2} />
        </svg>
      )}
    </button>
  );
}

// ── Customer Info Section ────────────────────────────────

function CustomerInfoSection({ userId, userInfo }: { userId: string; userInfo?: UserBasicInfo }) {
  const [info, setInfo] = useState<UserBasicInfo | null>(userInfo || null);
  const [loading, setLoading] = useState(!userInfo);

  useEffect(() => {
    if (userInfo) { setInfo(userInfo); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api.getUserBasicInfo(userId)
      .then(data => { if (!cancelled) setInfo(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, userInfo]);

  return (
    <section>
      <h3 className="text-sm font-medium text-muted-foreground mb-2">Customer</h3>
      <div className="bg-accent/50 rounded-lg p-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading customer...</p>
        ) : info ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium text-primary shrink-0">
                {info.name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{info.name || 'Unknown'}</p>
                <p className="text-xs text-muted-foreground truncate">{info.email || info.phone || '—'}</p>
              </div>
            </div>
            <Link
              href={`/users-list/${userId}`}
              className="text-xs text-primary hover:underline shrink-0 ml-2"
            >
              View →
            </Link>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Could not load customer</p>
            <Link href={`/users-list/${userId}`} className="text-xs text-primary hover:underline">View →</Link>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Hotel Booking Details Module ─────────────────────────

function HotelBookingDetailsModule({
  opportunity,
  bookingEnrichment,
}: {
  opportunity: HotelOpportunity;
  bookingEnrichment?: BookingEnrichment;
}) {
  const hotelName = bookingEnrichment?.hotel_name || opportunity.hotel_name || 'Unknown Hotel';
  const city = bookingEnrichment?.hotel_city || null;
  const checkIn = bookingEnrichment?.check_in || opportunity.check_in;
  const checkOut = bookingEnrichment?.check_out || opportunity.check_out;
  const roomType = bookingEnrichment?.room_type || null;
  const guestNames = bookingEnrichment?.guests || [];
  const primaryGuestName = guestNames[0] || null;
  const bookedWith = bookingEnrichment?.booked_with || opportunity.old_booking_provider;

  // Pricing — total_price from BookingEnrichment is the original booking price
  const originalPrice = bookingEnrichment?.total_price || null;
  const newPrice = opportunity.payment_amount;
  const newCurrency = opportunity.payment_currency || 'USD';

  // Savings (only when same currency)
  let savingsAmount: number | null = null;
  if (originalPrice && newPrice && originalPrice.currency === newCurrency) {
    const diff = originalPrice.amount - newPrice;
    if (diff > 0) savingsAmount = diff;
  }

  // Confirmation codes
  const hotelConfCode = bookingEnrichment?.confirmation_code || opportunity.old_booking_confirmation_code;

  // Status
  const statusColors: Record<string, string> = {
    active: 'text-blue-400',
    accepted: 'text-blue-400',
    awaiting_customer: 'text-yellow-400',
    executing: 'text-orange-400',
    completed: 'text-green-400',
    failed: 'text-red-400',
    declined: 'text-gray-400',
    expired: 'text-gray-400',
    needs_intervention: 'text-red-400',
  };

  return (
    <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-4 space-y-3">
      {/* Header: Hotel name + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold truncate">{hotelName}</p>
          {city && <p className="text-xs text-muted-foreground">{city}</p>}
          {(checkIn || checkOut) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {checkIn ? formatDate(checkIn) : '?'} → {checkOut ? formatDate(checkOut) : '?'}
            </p>
          )}
        </div>
        <span className={cn(
          'text-xs font-medium uppercase shrink-0 px-1.5 py-0.5 rounded bg-accent/50',
          statusColors[opportunity.status] || 'text-gray-400',
        )}>
          {opportunity.status.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Room + guest */}
      {(roomType || primaryGuestName) && (
        <div className="text-xs text-muted-foreground space-y-0.5">
          {roomType && <p>{roomType}</p>}
          {primaryGuestName && <p>Guest: {primaryGuestName}</p>}
          {guestNames.length > 1 && <p className="text-xs">+{guestNames.length - 1} more guest{guestNames.length > 2 ? 's' : ''}</p>}
        </div>
      )}

      {/* Pricing row */}
      {(originalPrice || newPrice) && (
        <div className="flex items-center gap-3 text-sm flex-wrap">
          {originalPrice && (
            <span className={cn(newPrice ? 'line-through text-muted-foreground' : 'font-medium')}>
              {formatMoneyObj(originalPrice)}
            </span>
          )}
          {newPrice && (
            <span className="text-green-400 font-medium">
              {formatMoney(newPrice, newCurrency)}
            </span>
          )}
          {savingsAmount && (
            <span className="text-green-400 text-xs bg-green-500/10 px-1.5 py-0.5 rounded">
              Save {formatMoney(savingsAmount, originalPrice?.currency || newCurrency)}
            </span>
          )}
        </div>
      )}

      {/* Key details grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {opportunity.payment_status && (
          <>
            <span className="text-muted-foreground">Payment</span>
            <span className={cn(
              'text-right font-medium',
              ['paid', 'collected', 'card_saved'].includes(opportunity.payment_status) && 'text-green-400',
              ['pending', 'awaiting_card'].includes(opportunity.payment_status) && 'text-yellow-400',
              opportunity.payment_status === 'overdue' && 'text-red-400',
            )}>
              {opportunity.payment_status.replace(/_/g, ' ')}
            </span>
          </>
        )}
        {opportunity.payment_due_at && (
          <>
            <span className="text-muted-foreground">Payment Due</span>
            <span className={cn(
              'text-right',
              new Date(opportunity.payment_due_at) < new Date() && 'text-red-400 font-medium',
            )}>
              {formatDate(opportunity.payment_due_at)}
            </span>
          </>
        )}
        {opportunity.cancellation_capability && (
          <>
            <span className="text-muted-foreground">Cancellation</span>
            <span className={cn(
              'text-right text-sm',
              opportunity.cancellation_capability === 'we_cancel' ? 'text-green-400' : 'text-yellow-400',
            )}>
              {opportunity.cancellation_capability === 'we_cancel' ? 'Auto (we cancel)' : 'Manual (they cancel)'}
            </span>
          </>
        )}
        {opportunity.cancellation_scheduled_at && (
          <>
            <span className="text-muted-foreground">Cancel By</span>
            <span className="text-right text-orange-400 font-medium">
              {formatDate(opportunity.cancellation_scheduled_at)}
            </span>
          </>
        )}
        {hotelConfCode && (
          <>
            <span className="text-muted-foreground">Hotel Conf.</span>
            <span className="text-right font-mono text-xs flex items-center justify-end gap-1">
              {hotelConfCode}
              <CopyButton value={hotelConfCode} />
            </span>
          </>
        )}
        {bookedWith && (
          <>
            <span className="text-muted-foreground">Booked With</span>
            <span className="text-right text-xs">{bookedWith}</span>
          </>
        )}
        {opportunity.old_booking_status && (
          <>
            <span className="text-muted-foreground">Original Booking</span>
            <span className={cn(
              'text-right text-xs font-medium',
              opportunity.old_booking_status === 'active' ? 'text-yellow-400' : 'text-green-400',
            )}>
              {opportunity.old_booking_status}
            </span>
          </>
        )}
      </div>

      {/* IDs */}
      <div className="pt-2 border-t border-purple-500/10 flex items-center justify-between">
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Opportunity:</span>
            <span className="font-mono text-muted-foreground/80 truncate max-w-[120px]">{opportunity.id.slice(0, 8)}…</span>
            <CopyButton value={opportunity.id} />
          </div>
          {opportunity.old_booking_id && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Booking:</span>
              <span className="font-mono text-muted-foreground/80 truncate max-w-[120px]">{opportunity.old_booking_id.slice(0, 8)}…</span>
              <CopyButton value={opportunity.old_booking_id} />
            </div>
          )}
        </div>
        <Link
          href={`/users-list/${opportunity.user_id}`}
          className="text-xs text-primary hover:underline shrink-0 ml-2"
        >
          View booking →
        </Link>
      </div>
    </div>
  );
}

// ── Repricing History Section ────────────────────────────

function RepricingHistorySection({ userId, currentOpportunityId }: { userId: string; currentOpportunityId: string }) {
  const [opportunities, setOpportunities] = useState<HotelOpportunityView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getMember(userId)
      .then((ctx: MemberContext) => {
        if (cancelled) return;
        // Get all hotel opportunities for this user
        const opps = ctx.hotel_opportunities || [];
        setOpportunities(opps);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  if (loading) {
    return (
      <section>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Repricing History</h3>
        <p className="text-xs text-muted-foreground">Loading history...</p>
      </section>
    );
  }

  // Show all opportunities except current, newest first
  const others = opportunities
    .filter(o => o.id !== currentOpportunityId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const current = opportunities.find(o => o.id === currentOpportunityId);
  const total = opportunities.length;

  if (total <= 1) {
    return (
      <section>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Repricing History</h3>
        <p className="text-xs text-muted-foreground">No previous repricings for this customer.</p>
      </section>
    );
  }

  const statusColors: Record<string, string> = {
    active: 'text-blue-400',
    accepted: 'text-indigo-400',
    executing: 'text-purple-400',
    completed: 'text-green-400',
    failed: 'text-red-400',
    needs_intervention: 'text-orange-400',
    declined: 'text-zinc-400',
    expired: 'text-zinc-400',
  };

  return (
    <section>
      <h3 className="text-sm font-medium text-muted-foreground mb-2">
        Repricing History
        <span className="text-xs text-muted-foreground/60 ml-1">({total} total)</span>
      </h3>
      <div className="space-y-2">
        {/* Current (highlighted) */}
        {current && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-2.5 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-primary">Current</span>
                <span className={cn('font-medium', statusColors[current.status] || 'text-zinc-400')}>
                  {current.status.replace(/_/g, ' ')}
                </span>
              </div>
              <span className="text-muted-foreground">{timeAgo(current.created_at)}</span>
            </div>
            {(current.original_price || current.target_price) && (
              <div className="flex items-center gap-2 mt-1">
                {current.original_price && (
                  <span className={cn(current.target_price ? 'line-through text-muted-foreground' : '')}>
                    {formatMoneyObj(current.original_price)}
                  </span>
                )}
                {current.target_price && (
                  <span className="text-green-400">{formatMoneyObj(current.target_price)}</span>
                )}
              </div>
            )}
          </div>
        )}
        {/* Previous */}
        {others.map(opp => (
          <div key={opp.id} className="bg-accent/30 rounded-lg p-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className={cn('font-medium', statusColors[opp.status] || 'text-zinc-400')}>
                {opp.status.replace(/_/g, ' ')}
              </span>
              <span className="text-muted-foreground">{timeAgo(opp.created_at)}</span>
            </div>
            {(opp.original_price || opp.target_price) && (
              <div className="flex items-center gap-2 mt-1">
                {opp.original_price && (
                  <span className={cn(opp.target_price ? 'line-through text-muted-foreground' : '')}>
                    {formatMoneyObj(opp.original_price)}
                  </span>
                )}
                {opp.target_price && (
                  <span className="text-green-400">{formatMoneyObj(opp.target_price)}</span>
                )}
              </div>
            )}
            {opp.failure_reason && (
              <p className="text-red-400 mt-1">{opp.failure_reason}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Email Side Panel ─────────────────────────────────────

function EmailSidePanel({
  bookingId,
  onClose,
}: {
  bookingId: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState<RawEmail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getEmailForBooking('hotel', bookingId)
      .then(data => { if (!cancelled) setEmail(data); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load email'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bookingId]);

  return (
    <div className="w-full max-w-md bg-card border-l border-border h-full overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="sticky top-0 bg-card border-b border-border p-3 flex items-center justify-between z-10">
        <h3 className="text-sm font-medium">Original Email</h3>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-accent rounded-md transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 p-3">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading email...</p>
        ) : error ? (
          <div className="bg-red-500/10 rounded-lg p-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : email ? (
          <div className="space-y-3">
            <div className="space-y-1 text-xs">
              {email.from_address && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">From</span>
                  <span>{email.from_address}</span>
                </div>
              )}
              {email.subject && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subject</span>
                  <span className="font-medium text-right max-w-[250px] truncate">{email.subject}</span>
                </div>
              )}
              {email.received_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Received</span>
                  <span>{new Date(email.received_at).toLocaleString()}</span>
                </div>
              )}
            </div>
            <div className="border-t border-border pt-3">
              {email.body_html || (email.body && email.body.includes('<')) ? (
                <div
                  className="text-sm prose prose-invert max-w-none [&_img]:max-w-full [&_table]:border-collapse [&_a]:text-primary"
                  dangerouslySetInnerHTML={{ __html: email.body_html || email.body || '' }}
                />
              ) : (
                <pre className="text-sm whitespace-pre-wrap">{email.body_text || email.body || 'No content'}</pre>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">No email found for this booking.</p>
        )}
      </div>
    </div>
  );
}

// ── Main Detail Component ────────────────────────────────

interface HotelOpportunityDetailProps {
  opportunity: HotelOpportunity;
  bookingEnrichment?: BookingEnrichment;
  userInfo?: UserBasicInfo;
  variant: 'payment' | 'cancel';
  onClose: () => void;
  onUpdate: (opportunity: HotelOpportunity) => void;
  renderInline?: boolean;
}

export function HotelOpportunityDetail({
  opportunity,
  bookingEnrichment,
  userInfo,
  variant,
  onClose,
  onUpdate,
  renderInline = false,
}: HotelOpportunityDetailProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [showEmail, setShowEmail] = useState(false);

  async function handleMarkCancelled() {
    if (!opportunity.old_booking_id) {
      setError('No booking ID available');
      return;
    }
    if (!notes.trim()) {
      setError('Please enter notes about the cancellation');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let fullNotes = notes.trim();
      if (confirmationCode.trim()) {
        fullNotes += `\nCancellation ref: ${confirmationCode.trim()}`;
      }

      await api.markBookingCancelled(
        'hotel',
        opportunity.old_booking_id,
        'cancelled',
        fullNotes,
      );
      onUpdate({
        ...opportunity,
        old_booking_status: 'cancelled',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark as cancelled');
      setShowConfirm(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleUnableToCancel() {
    if (!opportunity.old_booking_id) {
      setError('No booking ID available');
      return;
    }
    if (!notes.trim()) {
      setError('Please enter notes about why cancellation was not possible');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await api.markBookingCancelled(
        'hotel',
        opportunity.old_booking_id,
        'unable_to_cancel',
        notes.trim(),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send cancel reminder');
    } finally {
      setLoading(false);
    }
  }

  const detailContent = (
    <>
      {/* Header */}
      <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
        <div>
          <h2 className="text-lg font-semibold">
            {variant === 'cancel' ? 'Pending Cancellation' : 'Pending Payment'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {opportunity.hotel_name || 'Unknown Hotel'}
          </p>
        </div>
        {!renderInline && (
          <button
            onClick={onClose}
            className="p-2 hover:bg-accent rounded-md transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Customer Info */}
        <CustomerInfoSection userId={opportunity.user_id} userInfo={userInfo} />

        {/* Hotel Booking Details Module */}
        <HotelBookingDetailsModule
          opportunity={opportunity}
          bookingEnrichment={bookingEnrichment}
        />

        {/* View Original Email button */}
        {opportunity.old_booking_id && (
          <button
            onClick={() => setShowEmail(!showEmail)}
            className={cn(
              'w-full py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 text-sm',
              showEmail
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'bg-accent text-foreground hover:bg-accent/80',
            )}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {showEmail ? 'Hide Original Email' : 'View Original Email'}
          </button>
        )}

        {/* Inline email section (when renderInline is true, embed email below the button) */}
        {renderInline && showEmail && opportunity.old_booking_id && (
          <div className="border border-border rounded-lg overflow-hidden">
            <EmailSidePanel
              bookingId={opportunity.old_booking_id}
              onClose={() => setShowEmail(false)}
            />
          </div>
        )}

        {/* Repricing History */}
        <RepricingHistorySection
          userId={opportunity.user_id}
          currentOpportunityId={opportunity.id}
        />

        {/* Error */}
        {error && (
          <div className="bg-red-500/20 text-red-400 p-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Actions for cancel variant */}
        {variant === 'cancel' && opportunity.old_booking_status === 'active' && !showConfirm && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Cancellation Notes *
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., Called hotel, cancelled successfully, ref #12345"
                rows={3}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Hotel Cancellation Reference (optional)
              </label>
              <input
                type="text"
                value={confirmationCode}
                onChange={(e) => setConfirmationCode(e.target.value)}
                placeholder="e.g., cancellation # from the hotel"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <button
              onClick={() => {
                if (!notes.trim()) {
                  setError('Please enter notes about the cancellation');
                  return;
                }
                setError(null);
                setShowConfirm(true);
              }}
              className="w-full py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
            >
              Mark as Cancelled
            </button>
            <div className="border-t border-border pt-4">
              <p className="text-sm text-muted-foreground mb-2">
                This sends an email reminder to the customer to cancel their booking.
              </p>
              <button
                onClick={() => {
                  if (!notes.trim()) {
                    setError('Please enter notes about why cancellation was not possible');
                    return;
                  }
                  setError(null);
                  handleUnableToCancel();
                }}
                disabled={loading}
                className="w-full py-2 px-4 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Sending...' : 'Unable to Cancel'}
              </button>
            </div>
          </div>
        )}

        {/* Confirmation */}
        {variant === 'cancel' && opportunity.old_booking_status === 'active' && showConfirm && (
          <div className="space-y-4">
            <div className="bg-green-500/10 rounded-lg p-4">
              <h4 className="font-medium text-green-400 mb-2">Confirm Cancellation</h4>
              <p className="text-sm text-muted-foreground mb-3">
                You are marking this booking as cancelled:
              </p>
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">Hotel:</span> {opportunity.hotel_name}</p>
                {opportunity.old_booking_confirmation_code && (
                  <p><span className="text-muted-foreground">Conf:</span> {opportunity.old_booking_confirmation_code}</p>
                )}
                <p><span className="text-muted-foreground">Notes:</span> {notes}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleMarkCancelled}
                disabled={loading}
                className="flex-1 py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Saving...' : 'Yes, Mark Cancelled'}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                disabled={loading}
                className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Old booking cancelled — step complete */}
        {opportunity.old_booking_status === 'cancelled' && (
          <div className="bg-green-500/10 rounded-lg p-4">
            <p className="text-green-400 font-medium">Original booking has been cancelled.</p>
            <p className="text-sm text-muted-foreground mt-1">This step is complete — the repricing can proceed.</p>
          </div>
        )}
      </div>
    </>
  );

  if (renderInline) {
    return (
      <div className="h-full overflow-y-auto">
        {detailContent}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
      {/* Email side panel (opens to the left of the detail panel) */}
      {showEmail && opportunity.old_booking_id && (
        <EmailSidePanel
          bookingId={opportunity.old_booking_id}
          onClose={() => setShowEmail(false)}
        />
      )}

      {/* Main detail panel */}
      <div className="bg-card border-l border-border h-full overflow-y-auto w-full max-w-lg">
        {detailContent}
      </div>
    </div>
  );
}
