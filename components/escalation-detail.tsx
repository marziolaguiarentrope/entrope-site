'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Escalation, api, UserBasicInfo, HotelOpportunityView, HotelBookingView, BookingView, MemberContext, RawEmail, HotelBookingDetail, GuestSummary, TravelerProfile } from '@/lib/api';
import { cn, formatDate, fromMinorUnits } from '@/lib/utils';
import { convertToUSD, formatUSD } from '@/lib/currency';

// ── Helpers ──────────────────────────────────────────────

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

function formatMoney(cents: number | null | undefined, currency: string = 'USD') {
  if (cents === null || cents === undefined) return null;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={cn(
        'shrink-0 p-1 hover:bg-accent rounded transition-colors text-muted-foreground hover:text-foreground',
        className,
      )}
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

function IdPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-mono text-muted-foreground/80 truncate max-w-[120px]">{value.slice(0, 8)}…</span>
      <CopyButton value={value} />
    </div>
  );
}

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
    <div className="bg-accent/50 rounded-lg p-3">
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading customer…</p>
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
  );
}

// ── Hotel Opportunity Info (fetches from member context) ─

/** Find a booking by ID across all trips */
function findBookingInTrips(
  memberCtx: MemberContext,
  bookingId: string | null | undefined,
): BookingView | null {
  if (!bookingId) return null;
  for (const trip of memberCtx.trips || []) {
    for (const b of trip.bookings || []) {
      if (b.id === bookingId) return b;
    }
  }
  return null;
}

/** Merged guest info from multiple sources */
interface GuestInfo {
  name: string;
  isPrimary: boolean;
  dob: string | null;
  citizenship: string | null;
  isChild: boolean;
}

/** Merge guest data from HotelBookingDetail, HotelBookingView, and TravelerProfiles */
function mergeGuestInfo(
  detailGuests: GuestSummary[] | null,
  viewGuestNames: string[] | null,
  travellers: TravelerProfile[] | null,
): GuestInfo[] {
  // Best case: HotelBookingDetail has structured guest data
  if (detailGuests && detailGuests.length > 0) {
    return detailGuests.map(g => {
      // Try to enrich with traveller profile (match by name)
      const matchedTraveller = travellers?.find(t =>
        `${t.first_name || ''} ${t.last_name || ''}`.trim().toLowerCase() === g.name.toLowerCase()
      );
      const dob = g.date_of_birth || matchedTraveller?.date_of_birth || null;
      const citizenship = g.citizenship || matchedTraveller?.passport_country || null;
      const isChild = dob ? isUnder18(dob) : false;
      return { name: g.name, isPrimary: g.is_primary, dob, citizenship, isChild };
    });
  }

  // Fallback: HotelBookingView.guests[] (just string names) + traveller cross-reference
  if (viewGuestNames && viewGuestNames.length > 0) {
    return viewGuestNames.map((name, i) => {
      const matchedTraveller = travellers?.find(t =>
        `${t.first_name || ''} ${t.last_name || ''}`.trim().toLowerCase() === name.toLowerCase()
      );
      return {
        name,
        isPrimary: i === 0,
        dob: matchedTraveller?.date_of_birth || null,
        citizenship: matchedTraveller?.passport_country || null,
        isChild: matchedTraveller?.date_of_birth ? isUnder18(matchedTraveller.date_of_birth) : false,
      };
    });
  }

  return [];
}

function isUnder18(dob: string): boolean {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age < 18;
}

function calculateAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

/** Inline USD display for a price in minor units */
function USDPrice({ amount, currency }: { amount: number; currency: string }) {
  const [usd, setUsd] = useState<number | null>(null);

  useEffect(() => {
    if (currency.toUpperCase() === 'USD') return;
    const displayAmount = fromMinorUnits(amount, currency);
    convertToUSD(displayAmount, currency).then(setUsd);
  }, [amount, currency]);

  if (currency.toUpperCase() === 'USD' || usd === null) return null;
  return <span className="text-muted-foreground text-xs ml-1">(~{formatUSD(usd)})</span>;
}

function HotelOpportunityInfo({
  userId,
  opportunityId,
  contextData,
  escalationSourceId,
  escalationSourceType,
}: {
  userId: string;
  opportunityId: string;
  contextData: Record<string, unknown>;
  escalationSourceId?: string | null;
  escalationSourceType?: string;
}) {
  const [opportunity, setOpportunity] = useState<HotelOpportunityView | null>(null);
  const [hotelBooking, setHotelBooking] = useState<HotelBookingView | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [guestInfo, setGuestInfo] = useState<GuestInfo[]>([]);
  const [memberCtx, setMemberCtx] = useState<MemberContext | null>(null);

  // Source email state
  const [showEmail, setShowEmail] = useState(false);
  const [emailData, setEmailData] = useState<RawEmail | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailFetched, setEmailFetched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    api.getMember(userId)
      .then(async (ctx) => {
        if (cancelled) return;
        setMemberCtx(ctx);

        // Find the matching opportunity
        const match = ctx.hotel_opportunities?.find(
          (o: HotelOpportunityView) => o.id === opportunityId
        );
        setOpportunity(match || null);

        // Build a list of candidate booking IDs to try, in priority order
        const candidateIds: string[] = [];
        if (escalationSourceId && (escalationSourceType === 'booking' || escalationSourceType === 'BOOKING')) {
          candidateIds.push(escalationSourceId);
        }
        const ctxBookingId = contextData.booking_id as string | undefined;
        if (ctxBookingId) candidateIds.push(ctxBookingId);
        const ctxHotelBookingId = contextData.hotel_booking_id as string | undefined;
        if (ctxHotelBookingId) candidateIds.push(ctxHotelBookingId);
        if (match?.hotel_booking_id) candidateIds.push(match.hotel_booking_id);
        if (escalationSourceId && escalationSourceType !== 'booking' && escalationSourceType !== 'BOOKING') {
          candidateIds.push(escalationSourceId);
        }

        // Try each candidate ID to find the booking in trips
        let foundBooking: BookingView | null = null;
        let resolvedBookingId: string | null = null;
        for (const candidateId of candidateIds) {
          const booking = findBookingInTrips(ctx, candidateId);
          if (booking) {
            foundBooking = booking;
            resolvedBookingId = candidateId;
            break;
          }
        }

        const finalBookingId = resolvedBookingId || candidateIds[0] || null;
        setBookingId(finalBookingId);
        if (foundBooking?.hotel) {
          setHotelBooking(foundBooking.hotel);
        }

        // Try to fetch detailed guest info from HotelBookingDetail endpoint
        let detailGuests: GuestSummary[] | null = null;
        if (finalBookingId) {
          try {
            const detail = await api.getHotelBookingDetail(finalBookingId);
            detailGuests = detail.guests || null;
          } catch {
            // Endpoint may not work — fallback to view data
          }
        }

        // Merge guest info from all available sources
        const merged = mergeGuestInfo(
          detailGuests,
          foundBooking?.hotel?.guests || null,
          ctx.travellers || null,
        );
        setGuestInfo(merged);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [userId, opportunityId, contextData, escalationSourceId, escalationSourceType]);

  // Fallback values from escalation context
  const confCode = contextData.confirmation_code as string | undefined;

  if (loading) {
    return (
      <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-4">
        <p className="text-sm text-muted-foreground">Loading hotel details…</p>
      </div>
    );
  }

  // No opportunity AND no booking found — minimal fallback
  if (!opportunity && !hotelBooking) {
    return (
      <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-3 space-y-2">
        <p className="text-xs font-medium text-purple-400">Hotel Repricing</p>
        {confCode && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Confirmation</span>
            <span className="font-mono">{confCode}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <IdPill label="Opportunity" value={opportunityId} />
          {bookingId && <IdPill label="Booking" value={bookingId} />}
        </div>
        <p className="text-xs text-muted-foreground italic">
          Could not load hotel details — booking may not be in trips yet.
        </p>
      </div>
    );
  }

  // Merge data
  const hotelName = hotelBooking?.hotel_name || 'Hotel';
  const checkIn = hotelBooking?.check_in;
  const checkOut = hotelBooking?.check_out;
  const city = hotelBooking?.hotel_city;
  const roomType = hotelBooking?.room_type;
  const guestNames = hotelBooking?.guests;
  const bookedWith = hotelBooking?.booked_with;
  const originalPrice = hotelBooking?.total_price || opportunity?.original_price;
  const targetPrice = opportunity?.target_price;
  const hotelConfCode = hotelBooking?.confirmation_code;
  const axelConfCode = confCode?.startsWith('AXL') ? confCode : null;
  const originalConfirmation = hotelConfCode || (!axelConfCode ? confCode : null);
  const newBookingId = opportunity?.new_booking_id;
  const oppStatus = opportunity?.status || 'unknown';
  const failureReason = opportunity?.failure_reason;
  const nights = hotelBooking?.nights || (checkIn && checkOut ? Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000) : null);

  // Account owner info
  const accountEmail = memberCtx?.user_extras?.email;
  const accountPhone = memberCtx?.user_extras?.phone;
  const accountName = memberCtx?.user?.first_name;

  // Guest breakdown
  const adults = guestInfo.filter(g => !g.isChild);
  const children = guestInfo.filter(g => g.isChild);

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

  const fmtPrice = (p: { amount: number; currency: string }) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency || 'USD' }).format(fromMinorUnits(p.amount, p.currency || 'USD'));

  return (
    <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-3 space-y-2">
      {/* Hotel header: name + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{hotelName}</p>
          <p className="text-xs text-muted-foreground">
            {city}{city && (checkIn || checkOut) ? ' · ' : ''}
            {checkIn ? formatDate(checkIn) : '?'} → {checkOut ? formatDate(checkOut) : '?'}
            {nights ? ` (${nights} night${nights !== 1 ? 's' : ''})` : ''}
          </p>
        </div>
        <span className={cn(
          'text-[10px] font-medium uppercase shrink-0 px-1.5 py-0.5 rounded',
          statusColors[oppStatus] || 'text-gray-400',
          'bg-accent/50',
        )}>
          {oppStatus.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Failure reason */}
      {failureReason && (
        <p className="text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded">{failureReason}</p>
      )}

      {/* Guest Details */}
      {(guestInfo.length > 0 || (guestNames && guestNames.length > 0)) && (
        <div className="border-t border-purple-500/10 pt-2">
          <p className="text-[10px] font-medium text-purple-400 uppercase tracking-wide mb-1">Guests</p>
          <div className="space-y-0.5">
            {guestInfo.length > 0 ? (
              guestInfo.map((g, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="font-medium min-w-0 truncate">{g.name}</span>
                  {g.isPrimary && <span className="text-[10px] bg-primary/20 text-primary px-1 rounded">primary</span>}
                  {g.dob && (
                    <span className="text-muted-foreground shrink-0">
                      {g.isChild ? `age ${calculateAge(g.dob)}` : `DOB ${g.dob}`}
                    </span>
                  )}
                  {g.citizenship && <span className="text-muted-foreground shrink-0">{g.citizenship}</span>}
                </div>
              ))
            ) : (
              guestNames?.map((name, i) => (
                <p key={i} className="text-xs font-medium">{name}</p>
              ))
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {adults.length > 0 || children.length > 0
              ? `${adults.length} adult${adults.length !== 1 ? 's' : ''}${children.length > 0 ? `, ${children.length} child${children.length !== 1 ? 'ren' : ''} (${children.map(c => c.dob ? `age ${calculateAge(c.dob)}` : '?').join(', ')})` : ''}`
              : `${guestNames?.length || 0} guest${(guestNames?.length || 0) !== 1 ? 's' : ''}`
            }
          </p>
        </div>
      )}

      {/* Room & Booking Details — compact grid */}
      <div className="border-t border-purple-500/10 pt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {roomType && (
          <>
            <span className="text-muted-foreground">Room</span>
            <span className="font-medium truncate">{roomType}</span>
          </>
        )}
        {bookedWith && (
          <>
            <span className="text-muted-foreground">Booked with</span>
            <span>{bookedWith}</span>
          </>
        )}
        {originalConfirmation && (
          <>
            <span className="text-muted-foreground">Hotel Conf.</span>
            <span className="font-mono">{originalConfirmation}</span>
          </>
        )}
        {axelConfCode && (
          <>
            <span className="text-muted-foreground">Axel Conf.</span>
            <span className="font-mono">{axelConfCode}</span>
          </>
        )}
        {newBookingId && (
          <>
            <span className="text-muted-foreground">Axel Booking</span>
            <span className="font-mono truncate" title={newBookingId}>{newBookingId.slice(0, 10)}…</span>
          </>
        )}
        {opportunity?.cancellation_capability && (
          <>
            <span className="text-muted-foreground">Cancellation</span>
            <span className={opportunity.cancellation_capability === 'we_cancel' ? 'text-green-400' : 'text-yellow-400'}>
              {opportunity.cancellation_capability === 'we_cancel' ? 'Auto' : 'Manual'}
            </span>
          </>
        )}
      </div>

      {/* Pricing with USD conversion */}
      {(originalPrice || targetPrice) && (
        <div className="border-t border-purple-500/10 pt-2">
          <p className="text-[10px] font-medium text-purple-400 uppercase tracking-wide mb-1">Pricing</p>
          <div className="space-y-0.5 text-xs">
            {originalPrice && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground w-14 shrink-0">Original</span>
                <span className={cn(targetPrice ? 'line-through text-muted-foreground' : 'font-medium')}>
                  {fmtPrice(originalPrice)}
                </span>
                <USDPrice amount={originalPrice.amount} currency={originalPrice.currency} />
              </div>
            )}
            {targetPrice && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground w-14 shrink-0">Target</span>
                <span className="text-green-400 font-medium">{fmtPrice(targetPrice)}</span>
                <USDPrice amount={targetPrice.amount} currency={targetPrice.currency} />
              </div>
            )}
            {originalPrice && targetPrice && originalPrice.currency === targetPrice.currency && originalPrice.amount > targetPrice.amount && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground w-14 shrink-0">Savings</span>
                <span className="text-green-400 font-medium">
                  {fmtPrice({ amount: originalPrice.amount - targetPrice.amount, currency: originalPrice.currency })}
                </span>
                <USDPrice amount={originalPrice.amount - targetPrice.amount} currency={originalPrice.currency} />
              </div>
            )}
          </div>
          {opportunity?.payment_status && (
            <div className="flex items-center gap-1 text-xs mt-1">
              <span className="text-muted-foreground">Payment:</span>
              <span className={cn(
                'font-medium',
                ['paid', 'card_saved'].includes(opportunity.payment_status) && 'text-green-400',
                opportunity.payment_status === 'pending' && 'text-yellow-400',
                opportunity.payment_status === 'failed' && 'text-red-400',
              )}>
                {opportunity.payment_status.replace(/_/g, ' ')}
                {opportunity.payment_amount ? ` (${fmtPrice({ amount: opportunity.payment_amount, currency: opportunity.payment_currency || 'USD' })})` : ''}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Account owner — inline */}
      <div className="border-t border-purple-500/10 pt-2">
        <p className="text-[10px] font-medium text-purple-400 uppercase tracking-wide mb-1">Account</p>
        <div className="flex items-center justify-between">
          <div className="min-w-0 text-xs space-y-0.5">
            {accountName && <p className="font-medium">{accountName}</p>}
            {accountEmail && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground truncate">{accountEmail}</span>
                <CopyButton value={accountEmail} />
              </div>
            )}
            {accountPhone && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">{accountPhone}</span>
                <CopyButton value={accountPhone} />
              </div>
            )}
          </div>
          <Link
            href={`/users-list/${userId}`}
            className="text-xs text-primary hover:underline shrink-0 ml-2"
          >
            View →
          </Link>
        </div>
      </div>

      {/* Source Email */}
      {(opportunity?.hotel_booking_id || bookingId) && (
        <div className="border-t border-purple-500/10 pt-2">
          <button
            onClick={async () => {
              if (emailFetched) { setShowEmail(!showEmail); return; }
              setShowEmail(true);
              setEmailFetched(true);
              setEmailLoading(true);
              const bkId = opportunity?.hotel_booking_id || bookingId!;
              try {
                const data = await api.getEmailForBooking('hotel', bkId);
                setEmailData(data);
              } catch {
                // 404 = no source email, that's ok
              } finally {
                setEmailLoading(false);
              }
            }}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {showEmail ? 'Hide' : 'View'} Original Email
          </button>
          {showEmail && (
            <div className="mt-2">
              {emailLoading ? (
                <p className="text-xs text-muted-foreground">Loading email…</p>
              ) : emailData ? (
                <div className="bg-accent/30 rounded-lg p-3 space-y-2">
                  {emailData.subject && (
                    <p className="text-xs font-medium">{emailData.subject}</p>
                  )}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    {emailData.from_address && <span>From: {emailData.from_address}</span>}
                    {emailData.received_at && <span>{formatDate(emailData.received_at)}</span>}
                  </div>
                  {(emailData.body_text || emailData.body) && (
                    <div className="max-h-48 overflow-y-auto text-xs bg-background/50 rounded p-2 whitespace-pre-wrap font-mono">
                      {emailData.body_text || emailData.body}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No source email found for this booking</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Compact IDs */}
      <div className="border-t border-purple-500/10 pt-2 flex items-center justify-between">
        <div className="flex flex-wrap gap-3">
          <IdPill label="Opportunity" value={opportunityId} />
          {(opportunity?.hotel_booking_id || bookingId) && (
            <IdPill label="Booking" value={opportunity?.hotel_booking_id || bookingId!} />
          )}
        </div>
        <Link
          href={`/users-list/${userId}`}
          className="text-xs text-primary hover:underline shrink-0 ml-2"
        >
          View booking →
        </Link>
      </div>
    </div>
  );
}

// ── Collapsible Details Section ─────────────────────────

function CollapsibleDetails({ escalation }: { escalation: Escalation }) {
  const [open, setOpen] = useState(false);
  const ctx = escalation.context || {};

  // Fields already displayed prominently elsewhere
  const shownKeys = new Set([
    'booking_id', 'original_booking_id', 'new_booking_id', 'hotel_booking_id',
    'opportunity_id', 'action_needed', 'opportunity_type', 'confirmation_code',
    'hotel_name', 'check_in', 'check_out', 'room_type',
    'old_price', 'new_price', 'savings_amount', 'savings_currency', 'currency',
    'cancellation_capability',
  ]);
  const extraFields = Object.entries(ctx).filter(([k]) => !shownKeys.has(k));

  // Collect all IDs for reference
  const ids: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  const addId = (val: string | undefined | null, label: string) => {
    if (val && val !== 'None' && !seen.has(val)) {
      seen.add(val);
      ids.push({ label, value: val });
    }
  };

  addId(escalation.source_id, 'Source');
  addId(ctx.booking_id as string | undefined, 'Booking');
  addId(ctx.original_booking_id as string | undefined, 'Original Booking');
  addId(ctx.hotel_booking_id as string | undefined, 'Hotel Booking');
  addId(ctx.new_booking_id as string | undefined, 'New Booking');
  addId(ctx.opportunity_id as string | undefined, 'Opportunity');

  const hasContent = ids.length > 0 || extraFields.length > 0;
  if (!hasContent) return null;

  return (
    <section>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        <svg
          className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-90')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">Details & IDs</span>
        <span className="text-xs text-muted-foreground/60 ml-1">
          ({ids.length} IDs{extraFields.length > 0 ? `, ${extraFields.length} fields` : ''})
        </span>
      </button>

      {open && (
        <div className="mt-2 bg-accent/30 rounded-lg p-3 space-y-3">
          {/* Source info */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Source:</span>
            <span className="font-medium">{escalation.source_type}</span>
          </div>

          {/* IDs */}
          {ids.length > 0 && (
            <div className="space-y-1.5">
              {ids.map(({ label, value }) => (
                <div key={value} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-mono text-muted-foreground/80 truncate max-w-[200px]">{value}</span>
                    <CopyButton value={value} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Extra context fields */}
          {extraFields.length > 0 && (
            <div className="border-t border-border/50 pt-2 space-y-1">
              {extraFields.map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{key.replace(/_/g, ' ')}</span>
                  <span className="text-xs font-mono text-right truncate max-w-[200px]">
                    {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Links */}
          <div className="flex flex-wrap gap-2 pt-1">
            {(escalation.source_type === 'opportunity' || (ctx.opportunity_type as string) === 'hotel_reprice') && (
              <Link
                href="/hotel-repricing-tracking"
                className="text-xs text-primary hover:underline"
              >
                Hotel Repricing Tracker →
              </Link>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Main Detail Component ────────────────────────────────

interface EscalationDetailProps {
  escalation: Escalation;
  onClose: () => void;
  onUpdate: (escalation: Escalation) => void;
  renderInline?: boolean;
}

export function EscalationDetail({ escalation, onClose, onUpdate, renderInline }: EscalationDetailProps) {
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

  const isResolved = escalation.status === 'resolved';
  const canAct = !isResolved; // can take action on open or claimed

  // Extract key context data
  const ctx = escalation.context || {};
  const opportunityId = (ctx.opportunity_id as string | undefined) || (escalation.source_type === 'opportunity' ? escalation.source_id : null);
  const actionNeeded = ctx.action_needed as string | undefined;
  const isBookingFailure = escalation.type === 'booking_failure';
  const canConfirmBooking = isBookingFailure && !!opportunityId && canAct;

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

  async function handleResolve() {
    if (!resolutionNotes.trim()) {
      setError('Resolution notes required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Auto-claim first if not yet claimed (logs who acted)
      if (escalation.status === 'open') {
        await api.claimEscalation(escalation.id).catch(() => {});
      }
      const updated = await api.resolveEscalation(escalation.id, resolutionNotes.trim());
      onUpdate(updated);
      onClose();
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
      // Auto-claim first if not yet claimed (logs who acted)
      if (escalation.status === 'open') {
        await api.claimEscalation(escalation.id).catch(() => {});
      }
      const costAmount = supplierCostAmount ? Math.round(parseFloat(supplierCostAmount) * 100) : undefined;
      await api.confirmBooking(
        opportunityId,
        supplier,
        supplierReference.trim(),
        costAmount,
        costAmount ? supplierCostCurrency : undefined,
      );
      // Explicitly resolve the escalation after confirming the booking
      try {
        const notes = `Manual booking confirmed — supplier: ${supplier === 'etg' ? 'ETG/RateHawk' : supplier}, ref: ${supplierReference.trim()}${costAmount ? `, cost: ${(costAmount / 100).toFixed(2)} ${supplierCostCurrency}` : ''}`;
        const updated = await api.resolveEscalation(escalation.id, notes);
        onUpdate(updated);
      } catch {
        // If resolve fails (e.g. already resolved by backend), just refresh
        try {
          const updated = await api.getEscalation(escalation.id);
          onUpdate(updated);
        } catch {
          // ignore
        }
      }
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to confirm booking';
      setError(`${msg} — you can resolve the escalation manually below.`);
      setConfirmBookingStep('input');
      setShowConfirmBookingForm(false);
      setShowResolveForm(true);
    } finally {
      setLoading(false);
    }
  }

  const content = (
    <>
      {/* Header */}
      <div className="sticky top-0 bg-card border-b border-border px-3 py-2 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-sm font-semibold">Escalation</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={cn('px-2 py-0.5 text-xs font-medium rounded', statusColors[escalation.status] || 'bg-gray-500/20 text-gray-400')}>
                {escalation.status}
              </span>
              <span className={cn('px-2 py-0.5 text-xs font-medium rounded', priorityColors[escalation.priority] || 'bg-gray-500/20 text-gray-400')}>
                {escalation.priority}
              </span>
              {isResolved && escalation.claimed_by && (
                <span className="text-xs text-muted-foreground">
                  by {escalation.claimed_by}
                </span>
              )}
            </div>
          </div>
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

      <div className="p-3 space-y-3">
        {/* Type badge + time */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium bg-accent/50 px-2 py-0.5 rounded">{escalation.type.replace(/_/g, ' ')}</span>
          <span className="text-xs text-muted-foreground">{timeAgo(escalation.created_at)}</span>
        </div>

        {/* Action Needed — most prominent */}
        {actionNeeded && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2">
            <p className="text-xs font-medium text-yellow-400 mb-0.5">Action Needed</p>
            <p className="text-sm font-medium">{actionNeeded}</p>
          </div>
        )}

        {/* Reason */}
        <div className="bg-accent/50 rounded-lg p-2">
          <p className="text-[10px] font-medium text-muted-foreground mb-0.5">Reason</p>
          <p className="text-xs">{escalation.reason}</p>
        </div>

        {/* Hotel Opportunity Info — primary info card for repricing escalations */}
        {opportunityId && (
          <HotelOpportunityInfo
            userId={escalation.user_id}
            opportunityId={opportunityId}
            contextData={ctx}
            escalationSourceId={escalation.source_id}
            escalationSourceType={escalation.source_type}
          />
        )}

        {/* Customer — only show standalone section when hotel info card is NOT shown (it has account info inline) */}
        {!opportunityId && <CustomerInfoSection userId={escalation.user_id} />}

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
                  Opportunity moved to EXECUTING. The charge cron will process payment automatically.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Confirm Booking Action (for booking_failure escalations) */}
        {canConfirmBooking && !showConfirmBookingForm && !confirmBookingSuccess && (
          <button
            onClick={() => setShowConfirmBookingForm(true)}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm"
          >
            Confirm Manual Booking
          </button>
        )}

        {canConfirmBooking && showConfirmBookingForm && confirmBookingStep === 'input' && (
          <div className="space-y-3 bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Confirm Manual Booking
            </h4>

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
                className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm"
              >
                Review & Confirm
              </button>
              <button
                onClick={() => { setShowConfirmBookingForm(false); setError(null); }}
                className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Confirm Booking — Confirmation Step */}
        {canConfirmBooking && showConfirmBookingForm && confirmBookingStep === 'confirm' && (
          <div className="space-y-3 bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-4">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Double Check
            </h4>

            <div className="bg-accent/50 rounded-lg p-3 space-y-1 text-sm">
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
                  <span className="text-muted-foreground">Cost</span>
                  <span>${parseFloat(supplierCostAmount).toFixed(2)} {supplierCostCurrency}</span>
                </div>
              )}
            </div>

            <div className="text-xs text-yellow-400 space-y-0.5">
              <p>This will move opportunity to EXECUTING, mark booking CONFIRMED, create savings record, and auto-resolve this escalation.</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleConfirmBooking}
                disabled={loading}
                className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
              >
                {loading ? 'Confirming…' : 'Confirm Booking'}
              </button>
              <button
                onClick={() => setConfirmBookingStep('input')}
                disabled={loading}
                className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors text-sm"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Resolve — always available as fallback (small link when confirm booking is primary) */}
        {canAct && !showResolveForm && !canConfirmBooking && (
          <button
            onClick={() => setShowResolveForm(true)}
            className="w-full py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
          >
            Resolve Escalation
          </button>
        )}
        {canAct && !showResolveForm && canConfirmBooking && (
          <button
            onClick={() => setShowResolveForm(true)}
            className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
          >
            Or resolve manually…
          </button>
        )}

        {canAct && showResolveForm && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Resolution Notes *</label>
              <textarea
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="Describe how the escalation was resolved…"
                rows={3}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleResolve}
                disabled={loading}
                className="flex-1 py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors text-sm"
              >
                {loading ? 'Resolving…' : 'Confirm Resolution'}
              </button>
              <button
                onClick={() => setShowResolveForm(false)}
                className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Resolution Notes (if resolved) */}
        {isResolved && escalation.resolution_notes && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
            <p className="text-xs font-medium text-green-400 mb-1">Resolution</p>
            <p className="text-sm">{escalation.resolution_notes}</p>
          </div>
        )}

        {/* Timeline — compact */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Created {formatDateTime(escalation.created_at)}</span>
          {escalation.claimed_at && <span>Claimed {formatDateTime(escalation.claimed_at)}</span>}
          {escalation.resolved_at && <span>Resolved {formatDateTime(escalation.resolved_at)}</span>}
        </div>

        {/* Collapsible Details & IDs */}
        <CollapsibleDetails escalation={escalation} />
      </div>
    </>
  );

  if (renderInline) {
    return <div className="h-full overflow-y-auto">{content}</div>;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
      <div className="w-full max-w-lg bg-card border-l border-border h-full overflow-y-auto">
        {content}
      </div>
    </div>
  );
}
