'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  RefreshCw, ChevronDown, ChevronRight, ExternalLink, Search,
  Mail, Database, Eye, Telescope, MessageSquare, CheckCircle2,
  Loader2, Check, X, Hotel, Plane, Clock, DollarSign,
} from 'lucide-react';
import { cn, parseLocalDate } from '@/lib/utils';
import {
  api,
  RepricingPipelineIssue,
  RepricingPipelineResponse,
  RepricingIssueTypeInfo,
  HotelMatchRequest,
  HotelMatchResult,
  MemberContext,
  BookingView,
  WatchView,
  HotelOpportunityView,
  FlightOpportunityView,
  FlightBookingView,
  HotelBookingView,
} from '@/lib/api';

// ---------------------------------------------------------------------------
// Pipeline stage definitions — each issue type belongs to a stage
// ---------------------------------------------------------------------------

interface PipelineStage {
  key: string;
  label: string;
  description: string;
  icon: typeof Mail;
  issueTypes: string[];
  color: string;
  bgColor: string;
  headerColor: string;
}

const PIPELINE_STAGES: PipelineStage[] = [
  {
    key: 'import',
    label: 'Import',
    description: 'Email ingestion and booking creation',
    icon: Mail,
    issueTypes: ['email_no_booking', 'gmail_import_no_booking'],
    color: 'text-purple-400 border-purple-500/20',
    bgColor: 'bg-purple-500/15',
    headerColor: 'border-l-purple-500',
  },
  {
    key: 'booking',
    label: 'Booking',
    description: 'Booking data quality and reprice eligibility',
    icon: Database,
    issueTypes: ['bad_data_blocking_eligibility'],
    color: 'text-amber-400 border-amber-500/20',
    bgColor: 'bg-amber-500/15',
    headerColor: 'border-l-amber-500',
  },
  {
    key: 'watch',
    label: 'Watch',
    description: 'Price monitoring setup and linking',
    icon: Eye,
    issueTypes: ['eligible_no_watch', 'watch_not_linked'],
    color: 'text-cyan-400 border-cyan-500/20',
    bgColor: 'bg-cyan-500/15',
    headerColor: 'border-l-cyan-500',
  },
  {
    key: 'observation',
    label: 'Observation',
    description: 'Price check execution and delivery',
    icon: Telescope,
    issueTypes: ['watch_no_observations', 'email_not_delivered', 'threshold_met_no_opportunity', 'savings_found_awaiting_details'],
    color: 'text-blue-400 border-blue-500/20',
    bgColor: 'bg-blue-500/15',
    headerColor: 'border-l-blue-500',
  },
  {
    key: 'opportunity',
    label: 'Opportunity',
    description: 'Savings surfaced and communicated to user',
    icon: MessageSquare,
    issueTypes: ['opportunity_no_comms', 'opportunity_bad_outcome'],
    color: 'text-orange-400 border-orange-500/20',
    bgColor: 'bg-orange-500/15',
    headerColor: 'border-l-orange-500',
  },
  {
    key: 'completion',
    label: 'Completion',
    description: 'Accepted repricing fulfilled',
    icon: CheckCircle2,
    issueTypes: ['hotel_accepted_no_new_booking', 'flight_accepted_not_resolved'],
    color: 'text-red-400 border-red-500/20',
    bgColor: 'bg-red-500/15',
    headerColor: 'border-l-red-500',
  },
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…`;
}

function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(amount / 100);
}

function formatTimeUntil(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = date.getTime() - now.getTime();
  if (diffMs < 0) return 'overdue';
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `in ${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `in ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `in ${diffDays}d`;
}

function getBookingPrice(
  flight: FlightBookingView | null,
  hotel: HotelBookingView | null
): { amount: number | null; currency: string } {
  if (flight) {
    if (flight.total_price?.amount !== undefined) return { amount: flight.total_price.amount, currency: flight.total_price.currency };
    if (flight.customer_price !== undefined) return { amount: flight.customer_price, currency: flight.currency || 'USD' };
  }
  if (hotel) {
    if (hotel.total_price?.amount !== undefined) return { amount: hotel.total_price.amount, currency: hotel.total_price.currency };
    if (hotel.customer_price !== undefined) return { amount: hotel.customer_price, currency: hotel.currency || 'USD' };
  }
  return { amount: null, currency: 'USD' };
}

function getConfirmationCode(flight: FlightBookingView | null, hotel: HotelBookingView | null): string | null {
  if (flight) return flight.confirmation_code ?? flight.confirmation_number ?? null;
  if (hotel) return hotel.confirmation_code ?? hotel.confirmation_number ?? null;
  return null;
}

function getBookingProvider(flight: FlightBookingView | null, hotel: HotelBookingView | null): string | null {
  if (flight) return flight.booked_with ?? flight.booking_provider ?? null;
  if (hotel) return hotel.booked_with ?? hotel.booking_provider ?? null;
  return null;
}

function getWatchHealthStatus(watch: WatchView): { color: string; label: string; icon: string } {
  if (!watch.last_result) {
    return { color: 'bg-gray-500/20 text-gray-400', label: 'Pending', icon: '⚪' };
  }
  switch (watch.last_result) {
    case 'success':
      return { color: 'bg-green-500/20 text-green-400', label: 'Healthy', icon: '🟢' };
    case 'empty':
      return { color: 'bg-yellow-500/20 text-yellow-400', label: 'No Results', icon: '🟡' };
    case 'timeout':
    case 'supplier_error':
      return { color: 'bg-red-500/20 text-red-400', label: 'Error', icon: '🔴' };
    default:
      return { color: 'bg-gray-500/20 text-gray-400', label: 'Unknown', icon: '⚪' };
  }
}

// Find matching booking in member context
function findBooking(ctx: MemberContext, bookingId: string | null): BookingView | undefined {
  if (!bookingId) return undefined;
  for (const trip of ctx.trips) {
    const found = trip.bookings.find((b) => b.id === bookingId);
    if (found) return found;
  }
  return undefined;
}

// Find matching watch in member context
function findWatch(ctx: MemberContext, issue: RepricingPipelineIssue, booking?: BookingView): WatchView | undefined {
  if (issue.watch_id) {
    return ctx.watches.find((w) => w.id === issue.watch_id);
  }
  if (booking?.watch_id) {
    return ctx.watches.find((w) => w.id === booking.watch_id);
  }
  if (issue.booking_id) {
    return ctx.watches.find((w) => w.booking_id === issue.booking_id);
  }
  return undefined;
}

// Find matching opportunity in member context
function findOpportunity(ctx: MemberContext, issue: RepricingPipelineIssue): HotelOpportunityView | FlightOpportunityView | undefined {
  if (issue.opportunity_id) {
    const ho = ctx.hotel_opportunities.find((o) => o.id === issue.opportunity_id);
    if (ho) return ho;
    return ctx.flight_opportunities.find((o) => o.id === issue.opportunity_id);
  }
  if (issue.booking_id) {
    const ho = ctx.hotel_opportunities.find((o) => o.hotel_booking_id === issue.booking_id);
    if (ho) return ho;
    return ctx.flight_opportunities.find((o) => o.booking_id === issue.booking_id);
  }
  return undefined;
}

// Get a flight route string from booking
function getFlightRoute(flight: FlightBookingView): string {
  if (flight.legs?.length > 0) {
    const first = flight.legs[0];
    if (first.segments?.length > 0) {
      const origin = first.segments[0].origin;
      const dest = first.segments[first.segments.length - 1].destination;
      return `${origin} → ${dest}`;
    }
  }
  return 'Unknown route';
}

// Get inline booking summary for collapsed rows
function getBookingSummary(ctx: MemberContext | undefined, bookingId: string | null): string | null {
  if (!ctx || typeof ctx !== 'object' || !bookingId) return null;
  const booking = findBooking(ctx, bookingId);
  if (!booking) return null;
  if (booking.hotel?.hotel_name) return booking.hotel.hotel_name;
  if (booking.flight) return getFlightRoute(booking.flight);
  return null;
}

// ---------------------------------------------------------------------------
// Context panel — shows booking, watch, and opportunity details
// ---------------------------------------------------------------------------

function IssueContextPanel({
  issue,
  memberContext,
}: {
  issue: RepricingPipelineIssue;
  memberContext: MemberContext | 'loading' | 'error' | undefined;
}) {
  if (!memberContext) return null;

  if (memberContext === 'loading') {
    return (
      <div className="mt-3 pt-3 border-t border-border/30">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-accent/20 rounded-lg p-3 border border-border/50 animate-pulse space-y-2">
              <div className="h-4 w-24 bg-accent rounded" />
              <div className="h-3 w-40 bg-accent rounded" />
              <div className="h-3 w-32 bg-accent rounded" />
              <div className="h-3 w-36 bg-accent rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (memberContext === 'error') {
    return (
      <div className="mt-3 pt-3 border-t border-border/30">
        <p className="text-xs text-muted-foreground">Could not load member context.</p>
      </div>
    );
  }

  const booking = findBooking(memberContext, issue.booking_id);
  const watch = findWatch(memberContext, issue, booking);
  const opportunity = findOpportunity(memberContext, issue);

  if (!booking && !watch && !opportunity) {
    return (
      <div className="mt-3 pt-3 border-t border-border/30">
        <p className="text-xs text-muted-foreground">No matching booking, watch, or opportunity found in member context.</p>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-border/30">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Booking card */}
        {booking && (
          <div className="bg-accent/20 rounded-lg p-3 border border-border/50">
            <div className="flex items-center gap-2 mb-2">
              {booking.type === 'HOTEL' ? (
                <Hotel className="size-3.5 text-purple-400" />
              ) : (
                <Plane className="size-3.5 text-blue-400" />
              )}
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Booking</span>
              <span className={cn(
                'ml-auto px-1.5 py-0.5 text-[10px] font-medium rounded',
                booking.status === 'CONFIRMED' ? 'bg-green-500/20 text-green-400' :
                booking.status === 'CANCELLED' ? 'bg-red-500/20 text-red-400' :
                'bg-yellow-500/20 text-yellow-400'
              )}>
                {booking.status}
              </span>
            </div>

            {booking.hotel && (
              <div className="space-y-1 text-xs">
                <div className="font-medium text-sm">{booking.hotel.hotel_name || 'Unknown Hotel'}</div>
                {booking.hotel.hotel_city && (
                  <div className="text-muted-foreground">{booking.hotel.hotel_city}</div>
                )}
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1.5">
                  <div><span className="text-muted-foreground">Check-in:</span> {booking.hotel.check_in ? parseLocalDate(booking.hotel.check_in).toLocaleDateString() : 'N/A'}</div>
                  <div><span className="text-muted-foreground">Check-out:</span> {booking.hotel.check_out ? parseLocalDate(booking.hotel.check_out).toLocaleDateString() : 'N/A'}</div>
                  {booking.hotel.nights > 0 && <div><span className="text-muted-foreground">Nights:</span> {booking.hotel.nights}</div>}
                  {booking.hotel.room_type && <div><span className="text-muted-foreground">Room:</span> {booking.hotel.room_type}</div>}
                </div>
                <div className="mt-1.5 pt-1.5 border-t border-border/30 grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <div>
                    <span className="text-muted-foreground">Price:</span>{' '}
                    {formatMoney(getBookingPrice(null, booking.hotel).amount, getBookingPrice(null, booking.hotel).currency)}
                  </div>
                  {getConfirmationCode(null, booking.hotel) && (
                    <div><span className="text-muted-foreground">Conf:</span> {getConfirmationCode(null, booking.hotel)}</div>
                  )}
                  {getBookingProvider(null, booking.hotel) && (
                    <div><span className="text-muted-foreground">Via:</span> {getBookingProvider(null, booking.hotel)}</div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Hotel ID:</span>{' '}
                    {booking.hotel.hotel_id ? (
                      <span className="font-mono">{truncateId(booking.hotel.hotel_id)}</span>
                    ) : (
                      <span className="text-red-400 font-medium">missing</span>
                    )}
                  </div>
                  {booking.hotel.refundability && (
                    <div>
                      <span className="text-muted-foreground">Refundable:</span>{' '}
                      <span className={booking.hotel.refundability === 'REFUNDABLE' ? 'text-green-400' : 'text-yellow-400'}>
                        {booking.hotel.refundability}
                      </span>
                    </div>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="text-muted-foreground">Repriceable:</span>{' '}
                  {booking.hotel.is_repriceable ? (
                    <span className="text-green-400 font-medium">Yes</span>
                  ) : (
                    <span className="text-red-400">{booking.hotel.reprice_ineligible_reason || 'No'}</span>
                  )}
                </div>
              </div>
            )}

            {booking.flight && (
              <div className="space-y-1 text-xs">
                <div className="font-medium text-sm">{getFlightRoute(booking.flight)}</div>
                {booking.flight.legs?.length > 0 && booking.flight.legs[0].segments?.length > 0 && (
                  <div className="text-muted-foreground">
                    {booking.flight.legs[0].segments[0].airline_name || booking.flight.legs[0].segments[0].airline}
                    {booking.flight.legs[0].segments[0].departure && (
                      <> · {parseLocalDate(booking.flight.legs[0].segments[0].departure).toLocaleDateString()}</>
                    )}
                    {booking.flight.legs[0].segments[0].cabin && (
                      <> · {booking.flight.legs[0].segments[0].cabin}</>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1.5">
                  <div>
                    <span className="text-muted-foreground">Price:</span>{' '}
                    {formatMoney(getBookingPrice(booking.flight, null).amount, getBookingPrice(booking.flight, null).currency)}
                  </div>
                  {getConfirmationCode(booking.flight, null) && (
                    <div><span className="text-muted-foreground">Conf:</span> {getConfirmationCode(booking.flight, null)}</div>
                  )}
                  {getBookingProvider(booking.flight, null) && (
                    <div><span className="text-muted-foreground">Via:</span> {getBookingProvider(booking.flight, null)}</div>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="text-muted-foreground">Repriceable:</span>{' '}
                  {booking.flight.is_repriceable ? (
                    <span className="text-green-400 font-medium">Yes</span>
                  ) : (
                    <span className="text-red-400">{booking.flight.reprice_ineligible_reason || 'No'}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Watch card */}
        {watch && (
          <div className="bg-accent/20 rounded-lg p-3 border border-border/50">
            <div className="flex items-center gap-2 mb-2">
              <Eye className="size-3.5 text-cyan-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Watch</span>
              <span className={cn('ml-auto px-1.5 py-0.5 text-[10px] font-medium rounded', {
                'bg-green-500/20 text-green-400': watch.status?.toLowerCase() === 'active',
                'bg-yellow-500/20 text-yellow-400': watch.status?.toLowerCase() === 'paused',
                'bg-gray-500/20 text-gray-400': watch.status?.toLowerCase() === 'ended',
              })}>
                {watch.status}
              </span>
            </div>

            {(() => {
              const health = getWatchHealthStatus(watch);
              return (
                <div className={cn('inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium mb-2', health.color)}>
                  <span>{health.icon}</span>
                  {health.label}
                </div>
              );
            })()}

            <div className="space-y-1 text-xs">
              {watch.latest_observed_price && (
                <div className="flex items-center gap-1.5">
                  <DollarSign className="size-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Last price:</span>
                  <span className="font-medium">{formatMoney(watch.latest_observed_price.amount, watch.latest_observed_price.currency)}</span>
                  {watch.latest_observed_at && <span className="text-muted-foreground">({timeAgo(watch.latest_observed_at)})</span>}
                </div>
              )}
              {watch.last_executed_at && (
                <div className="flex items-center gap-1.5">
                  <Clock className="size-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Last check:</span>
                  <span>{timeAgo(watch.last_executed_at)}</span>
                  {watch.last_result && watch.last_result !== 'success' && (
                    <span className="text-red-400">({watch.last_result})</span>
                  )}
                </div>
              )}
              {watch.next_due_at && watch.status?.toLowerCase() === 'active' && (
                <div className="flex items-center gap-1.5">
                  <Clock className="size-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Next:</span>
                  <span>{formatTimeUntil(watch.next_due_at)}</span>
                </div>
              )}
              {watch.threshold_amount != null && watch.threshold_currency && (
                <div className="flex items-center gap-1.5">
                  <DollarSign className="size-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Threshold:</span>
                  <span>{formatMoney(watch.threshold_amount, watch.threshold_currency)}</span>
                </div>
              )}
              {watch.watch_type && (
                <div className="text-muted-foreground mt-1">Type: {watch.watch_type}</div>
              )}
            </div>
          </div>
        )}

        {/* Opportunity card */}
        {opportunity && (
          <div className="bg-accent/20 rounded-lg p-3 border border-border/50">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="size-3.5 text-orange-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Opportunity</span>
              <span className="ml-auto px-1.5 py-0.5 text-[10px] font-medium rounded bg-orange-500/20 text-orange-400">
                {opportunity.status}
              </span>
            </div>

            <div className="space-y-1.5 text-xs">
              {/* Price comparison */}
              {(opportunity.old_price != null || opportunity.new_price != null) && (
                <div className="flex items-center gap-2">
                  {opportunity.old_price != null && (
                    <span className="line-through text-muted-foreground">
                      {formatMoney(opportunity.old_price, opportunity.savings_currency || 'USD')}
                    </span>
                  )}
                  {opportunity.new_price != null && (
                    <span className="text-green-400 font-medium">
                      {formatMoney(opportunity.new_price, opportunity.savings_currency || 'USD')}
                    </span>
                  )}
                </div>
              )}

              {/* Savings badge */}
              {opportunity.savings_amount != null && (
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/15 text-green-400 text-xs font-medium">
                  Save {formatMoney(opportunity.savings_amount, opportunity.savings_currency || 'USD')}
                </div>
              )}

              {/* Hotel-specific fields */}
              {'hotel_name' in opportunity && (opportunity as HotelOpportunityView).hotel_name && (
                <div className="text-muted-foreground">
                  {(opportunity as HotelOpportunityView).hotel_name}
                </div>
              )}
              {'payment_status' in opportunity && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1">
                  {(opportunity as HotelOpportunityView).payment_status && (
                    <div>
                      <span className="text-muted-foreground">Payment:</span>{' '}
                      {(opportunity as HotelOpportunityView).payment_status}
                    </div>
                  )}
                  {(opportunity as HotelOpportunityView).payment_amount != null && (
                    <div>
                      <span className="text-muted-foreground">Amount:</span>{' '}
                      {formatMoney(
                        (opportunity as HotelOpportunityView).payment_amount,
                        (opportunity as HotelOpportunityView).payment_currency || 'USD'
                      )}
                    </div>
                  )}
                  {(opportunity as HotelOpportunityView).cancellation_capability && (
                    <div>
                      <span className="text-muted-foreground">Cancel:</span>{' '}
                      {(opportunity as HotelOpportunityView).cancellation_capability}
                    </div>
                  )}
                </div>
              )}

              {opportunity.created_at && (
                <div className="text-muted-foreground mt-1">{timeAgo(opportunity.created_at)}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action bar — contextual actions per issue type
// ---------------------------------------------------------------------------

function IssueActions({
  issue,
  onActionComplete,
  memberContext,
}: {
  issue: RepricingPipelineIssue;
  onActionComplete: () => void;
  memberContext?: MemberContext | 'loading' | 'error';
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [hotelName, setHotelName] = useState('');
  const [matchResults, setMatchResults] = useState<HotelMatchResult[] | null>(null);
  const [showMatchForm, setShowMatchForm] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [currencyInput, setCurrencyInput] = useState('USD');
  const [showPriceForm, setShowPriceForm] = useState(false);
  const [airlineInput, setAirlineInput] = useState('');
  const [showAirlineForm, setShowAirlineForm] = useState(false);
  const [refundableInput, setRefundableInput] = useState<boolean | null>(null);
  const [showRefundForm, setShowRefundForm] = useState(false);

  // Pre-populate hotel name from member context
  useEffect(() => {
    if (showMatchForm && issue.reason === 'No hotel ID' && !hotelName && memberContext && typeof memberContext === 'object') {
      const booking = findBooking(memberContext, issue.booking_id);
      if (booking?.hotel?.hotel_name) {
        setHotelName(booking.hotel.hotel_name);
      }
    }
  }, [showMatchForm, memberContext, issue.booking_id, issue.reason, hotelName]);

  const clearResult = () => setTimeout(() => setActionResult(null), 4000);

  // --- Watch actions ---

  async function handleRegenerateWatch() {
    if (!issue.booking_id) return;
    setActionLoading('regenerate');
    setActionResult(null);
    try {
      const result = await api.regenerateWatch(issue.booking_id);
      setActionResult({ type: 'success', message: `Watch created: ${truncateId(result.new_watch_id)}` });
      clearResult();
      onActionComplete();
    } catch (err) {
      setActionResult({ type: 'error', message: err instanceof Error ? err.message : 'Failed to regenerate watch' });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRetryWatch() {
    if (!issue.watch_id) return;
    setActionLoading('retry');
    setActionResult(null);
    try {
      await api.retryWatchNow(issue.watch_id);
      setActionResult({ type: 'success', message: 'Watch retry triggered' });
      clearResult();
      onActionComplete();
    } catch (err) {
      setActionResult({ type: 'error', message: err instanceof Error ? err.message : 'Failed to retry watch' });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTerminateWatch() {
    if (!issue.watch_id) return;
    setActionLoading('terminate');
    setActionResult(null);
    try {
      await api.terminateWatch(issue.watch_id);
      setActionResult({ type: 'success', message: 'Watch terminated' });
      clearResult();
      onActionComplete();
    } catch (err) {
      setActionResult({ type: 'error', message: err instanceof Error ? err.message : 'Failed to terminate watch' });
    } finally {
      setActionLoading(null);
    }
  }

  // --- Hotel match ---

  // Extract hotel city from member context for geocoding
  const bookingForContext = memberContext && typeof memberContext === 'object'
    ? findBooking(memberContext, issue.booking_id)
    : undefined;
  const hotelCity = bookingForContext?.hotel?.hotel_city;

  async function handleMatchHotel() {
    if (!hotelName.trim()) return;
    setActionLoading('match');
    setActionResult(null);
    setMatchResults(null);
    try {
      const request: HotelMatchRequest = { hotel_name: hotelName.trim() };
      if (hotelCity) {
        request.address = hotelCity;
      }
      const result = await api.matchHotel(request);
      if (result.matches.length === 0) {
        setActionResult({ type: 'error', message: 'No matches found. Try a different hotel name.' });
      } else {
        setMatchResults(result.matches);
      }
    } catch (err) {
      setActionResult({ type: 'error', message: err instanceof Error ? err.message : 'Hotel match failed' });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleApplyHotelId(hotelId: string) {
    if (!issue.booking_id) return;
    setActionLoading('apply-hotel');
    setActionResult(null);
    try {
      await api.patchHotelBooking(issue.booking_id, { stay: { hotel: { id: hotelId } } });
      setActionResult({ type: 'success', message: `Hotel ID set: ${truncateId(hotelId)}` });
      setShowMatchForm(false);
      setMatchResults(null);
      clearResult();
      onActionComplete();
    } catch (err) {
      setActionResult({ type: 'error', message: err instanceof Error ? err.message : 'Failed to patch hotel ID' });
    } finally {
      setActionLoading(null);
    }
  }

  // --- Price patch ---

  async function handlePatchPrice() {
    if (!issue.booking_id || !priceInput) return;
    const amount = parseFloat(priceInput);
    if (isNaN(amount) || amount <= 0) {
      setActionResult({ type: 'error', message: 'Enter a valid price' });
      return;
    }
    setActionLoading('patch-price');
    setActionResult(null);
    try {
      if (issue.booking_type === 'hotel') {
        await api.patchHotelBooking(issue.booking_id, { customer_price: { amount, currency: currencyInput } });
      } else {
        await api.patchFlightBooking(issue.booking_id, { customer_price: { amount, currency: currencyInput } });
      }
      setActionResult({ type: 'success', message: `Price set: ${amount} ${currencyInput}` });
      setShowPriceForm(false);
      clearResult();
      onActionComplete();
    } catch (err) {
      setActionResult({ type: 'error', message: err instanceof Error ? err.message : 'Failed to patch price' });
    } finally {
      setActionLoading(null);
    }
  }

  // --- Airline code patch ---

  async function handlePatchAirline() {
    if (!issue.booking_id || !airlineInput.trim()) return;
    setActionLoading('patch-airline');
    setActionResult(null);
    try {
      await api.patchFlightBooking(issue.booking_id, {
        itinerary: { legs: [{ airline: airlineInput.trim().toUpperCase() }] },
      });
      setActionResult({ type: 'success', message: `Airline set: ${airlineInput.trim().toUpperCase()}` });
      setShowAirlineForm(false);
      clearResult();
      onActionComplete();
    } catch (err) {
      setActionResult({ type: 'error', message: err instanceof Error ? err.message : 'Failed to patch airline' });
    } finally {
      setActionLoading(null);
    }
  }

  // --- Refundability patch ---

  async function handlePatchRefundability() {
    if (!issue.booking_id || refundableInput === null) return;
    setActionLoading('patch-refund');
    setActionResult(null);
    try {
      await api.patchHotelBooking(issue.booking_id, { stay: { refundable: refundableInput } });
      setActionResult({ type: 'success', message: `Refundability set: ${refundableInput ? 'Yes' : 'No'}` });
      setShowRefundForm(false);
      clearResult();
      onActionComplete();
    } catch (err) {
      setActionResult({ type: 'error', message: err instanceof Error ? err.message : 'Failed to patch refundability' });
    } finally {
      setActionLoading(null);
    }
  }

  // --- Determine which actions to show based on issue type ---

  const actions: React.ReactNode[] = [];

  // Always show "View User" link
  actions.push(
    <Link
      key="view-user"
      href={`/users-list/${issue.user_id}`}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent/80 rounded transition-colors"
    >
      <ExternalLink className="size-3" />
      View User
    </Link>
  );

  switch (issue.issue_type) {
    // Watch stage — create a watch
    case 'eligible_no_watch':
    case 'watch_not_linked':
      if (issue.booking_id) {
        actions.push(
          <button
            key="regenerate"
            onClick={handleRegenerateWatch}
            disabled={!!actionLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 rounded transition-colors disabled:opacity-50"
          >
            {actionLoading === 'regenerate' ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            {actionLoading === 'regenerate' ? 'Creating…' : issue.issue_type === 'eligible_no_watch' ? 'Create Watch' : 'Regenerate Watch'}
          </button>
        );
      }
      break;

    // Observation stage — retry the watch
    case 'watch_no_observations':
      if (issue.watch_id) {
        actions.push(
          <button
            key="retry"
            onClick={handleRetryWatch}
            disabled={!!actionLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 rounded transition-colors disabled:opacity-50"
          >
            {actionLoading === 'retry' ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            {actionLoading === 'retry' ? 'Retrying…' : 'Retry Watch Now'}
          </button>
        );
      }
      if (issue.booking_id) {
        actions.push(
          <button
            key="regenerate"
            onClick={handleRegenerateWatch}
            disabled={!!actionLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent/80 rounded transition-colors disabled:opacity-50"
          >
            {actionLoading === 'regenerate' ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            {actionLoading === 'regenerate' ? 'Regenerating…' : 'Regenerate Watch'}
          </button>
        );
      }
      break;

    // Opportunity — bad outcome, can terminate watch to stop wasting resources
    case 'opportunity_bad_outcome':
      if (issue.watch_id) {
        actions.push(
          <button
            key="terminate"
            onClick={handleTerminateWatch}
            disabled={!!actionLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-colors disabled:opacity-50"
          >
            {actionLoading === 'terminate' ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
            {actionLoading === 'terminate' ? 'Terminating…' : 'Terminate Watch'}
          </button>
        );
      }
      break;

    // Bad data — contextual fix based on reason
    case 'bad_data_blocking_eligibility':
      if (issue.reason === 'No hotel ID' && issue.booking_id) {
        actions.push(
          <button
            key="match-hotel"
            onClick={() => setShowMatchForm(!showMatchForm)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 rounded transition-colors"
          >
            <Search className="size-3" />
            Match Hotel
          </button>
        );
      }
      if (issue.reason === 'No valid price' && issue.booking_id) {
        actions.push(
          <button
            key="set-price"
            onClick={() => setShowPriceForm(!showPriceForm)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 rounded transition-colors"
          >
            Set Price
          </button>
        );
      }
      if (issue.reason === 'No airline code' && issue.booking_id) {
        actions.push(
          <button
            key="set-airline"
            onClick={() => setShowAirlineForm(!showAirlineForm)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 rounded transition-colors"
          >
            Set Airline Code
          </button>
        );
      }
      if (issue.reason === 'Refundability unknown' && issue.booking_id) {
        actions.push(
          <button
            key="set-refund"
            onClick={() => setShowRefundForm(!showRefundForm)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 rounded transition-colors"
          >
            Set Refundability
          </button>
        );
      }
      break;
  }

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground mr-1">Actions:</span>
        {actions}
      </div>

      {/* Hotel match form */}
      {showMatchForm && (
        <div className="mt-3 p-3 bg-background rounded border border-border">
          <div className="text-xs font-medium mb-2">Match Hotel ID</div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={hotelName}
              onChange={(e) => setHotelName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleMatchHotel()}
              placeholder="Hotel name..."
              className="flex-1 px-2.5 py-1.5 text-xs rounded border border-border bg-background placeholder:text-muted-foreground"
            />
            <button
              onClick={handleMatchHotel}
              disabled={!hotelName.trim() || !!actionLoading}
              className="px-3 py-1.5 text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 rounded transition-colors disabled:opacity-50"
            >
              {actionLoading === 'match' ? 'Searching…' : 'Search'}
            </button>
          </div>
          {matchResults && (
            <div className="mt-2 space-y-1.5">
              {matchResults.map((m) => (
                <div key={m.hotel_id} className="flex items-center justify-between p-2 bg-accent/30 rounded text-xs">
                  <div>
                    <span className="font-medium">{m.name}</span>
                    <span className="text-muted-foreground ml-2">
                      {Math.round(m.confidence_score * 100)}% match · {m.match_type}
                    </span>
                  </div>
                  <button
                    onClick={() => handleApplyHotelId(m.hotel_id)}
                    disabled={!!actionLoading}
                    className="px-2 py-1 text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded transition-colors disabled:opacity-50"
                  >
                    {actionLoading === 'apply-hotel' ? 'Applying…' : 'Apply'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Price form */}
      {showPriceForm && (
        <div className="mt-3 p-3 bg-background rounded border border-border">
          <div className="text-xs font-medium mb-2">Set Booking Price</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePatchPrice()}
              placeholder="Amount..."
              step="0.01"
              min="0"
              className="w-32 px-2.5 py-1.5 text-xs rounded border border-border bg-background placeholder:text-muted-foreground"
            />
            <select
              value={currencyInput}
              onChange={(e) => setCurrencyInput(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded border border-border bg-background"
            >
              <option value="USD">USD</option>
              <option value="CAD">CAD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
            <button
              onClick={handlePatchPrice}
              disabled={!priceInput || !!actionLoading}
              className="px-3 py-1.5 text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded transition-colors disabled:opacity-50"
            >
              {actionLoading === 'patch-price' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Airline code form */}
      {showAirlineForm && (
        <div className="mt-3 p-3 bg-background rounded border border-border">
          <div className="text-xs font-medium mb-2">Set Airline Code</div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={airlineInput}
              onChange={(e) => setAirlineInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handlePatchAirline()}
              placeholder="e.g. AA, UA, DL..."
              maxLength={3}
              className="w-24 px-2.5 py-1.5 text-xs rounded border border-border bg-background placeholder:text-muted-foreground uppercase"
            />
            <button
              onClick={handlePatchAirline}
              disabled={!airlineInput.trim() || !!actionLoading}
              className="px-3 py-1.5 text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded transition-colors disabled:opacity-50"
            >
              {actionLoading === 'patch-airline' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Refundability form */}
      {showRefundForm && (
        <div className="mt-3 p-3 bg-background rounded border border-border">
          <div className="text-xs font-medium mb-2">Set Refundability</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRefundableInput(true)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded border transition-colors',
                refundableInput === true
                  ? 'bg-green-500/20 text-green-400 border-green-500/30'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
            >
              Refundable
            </button>
            <button
              onClick={() => setRefundableInput(false)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded border transition-colors',
                refundableInput === false
                  ? 'bg-red-500/20 text-red-400 border-red-500/30'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
            >
              Non-refundable
            </button>
            <button
              onClick={handlePatchRefundability}
              disabled={refundableInput === null || !!actionLoading}
              className="px-3 py-1.5 text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded transition-colors disabled:opacity-50"
            >
              {actionLoading === 'patch-refund' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Action result */}
      {actionResult && (
        <div className={cn(
          'mt-2 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded',
          actionResult.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
        )}>
          {actionResult.type === 'success' ? <Check className="size-3" /> : <X className="size-3" />}
          {actionResult.message}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue row component
// ---------------------------------------------------------------------------

function IssueRow({
  issue,
  stage,
  isExpanded,
  onToggle,
  onActionComplete,
  memberContext,
  onRequestContext,
  issueKey,
}: {
  issue: RepricingPipelineIssue;
  stage: PipelineStage | undefined;
  isExpanded: boolean;
  onToggle: () => void;
  onActionComplete: (issueKey: string) => void;
  memberContext: MemberContext | 'loading' | 'error' | undefined;
  onRequestContext: (userId: string) => void;
  issueKey: string;
}) {
  // Fetch member context when row is expanded
  useEffect(() => {
    if (isExpanded) {
      onRequestContext(issue.user_id);
    }
  }, [isExpanded, issue.user_id, onRequestContext]);

  const bookingSummary = useMemo(() => {
    if (!memberContext || typeof memberContext !== 'object') return null;
    return getBookingSummary(memberContext, issue.booking_id);
  }, [memberContext, issue.booking_id]);

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-border hover:bg-accent/50 transition-colors cursor-pointer"
      >
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="size-3.5 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 text-muted-foreground flex-shrink-0" />
            )}
            <span className="text-sm font-medium truncate">{issue.label}</span>
          </div>
        </td>
        <td className="py-3 px-4">
          <Link
            href={`/users-list/${issue.user_id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-sm font-mono text-primary hover:underline"
          >
            {truncateId(issue.user_id)}
          </Link>
        </td>
        <td className="py-3 px-4">
          {issue.booking_id ? (
            <div>
              <span className="text-sm font-mono">
                <span className="text-muted-foreground">
                  {issue.booking_type === 'hotel' ? 'H' : issue.booking_type === 'flight' ? 'F' : '?'}-
                </span>
                {truncateId(issue.booking_id)}
              </span>
              {bookingSummary && (
                <div className="text-xs text-muted-foreground truncate max-w-48">{bookingSummary}</div>
              )}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </td>
        <td className="py-3 px-4">
          {issue.reason ? (
            <span className="text-sm truncate max-w-48 block" title={issue.reason}>
              {issue.reason}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </td>
        <td className="py-3 px-4 text-right">
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {issue.created_at ? timeAgo(issue.created_at) : '—'}
          </span>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-border bg-accent/30">
          <td colSpan={5} className="px-4 py-4">
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm max-w-3xl">
              <div>
                <span className="text-muted-foreground">Issue Type</span>
                <div className="font-medium mt-0.5">
                  {issue.label}
                  {stage && (
                    <span className={cn('ml-2 text-xs font-medium px-1.5 py-0.5 rounded border', stage.color, stage.bgColor)}>
                      {stage.label}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">User</span>
                <div className="font-mono mt-0.5 flex items-center gap-1.5">
                  <span className="select-all">{issue.user_id}</span>
                  <Link
                    href={`/users-list/${issue.user_id}`}
                    className="text-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    <ExternalLink className="size-3" />
                  </Link>
                </div>
              </div>
              {issue.booking_id && (
                <div>
                  <span className="text-muted-foreground">Booking</span>
                  <div className="font-mono mt-0.5">
                    <span className="select-all">{issue.booking_id}</span>
                    <span className="text-muted-foreground ml-1.5">
                      ({issue.booking_type ?? 'unknown'})
                    </span>
                  </div>
                </div>
              )}
              {issue.opportunity_id && (
                <div>
                  <span className="text-muted-foreground">Opportunity</span>
                  <div className="font-mono mt-0.5 select-all">{issue.opportunity_id}</div>
                </div>
              )}
              {issue.watch_id && (
                <div>
                  <span className="text-muted-foreground">Watch</span>
                  <div className="font-mono mt-0.5 select-all">{issue.watch_id}</div>
                </div>
              )}
              {issue.status && (
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <div className="mt-0.5">{issue.status}</div>
                </div>
              )}
              {issue.reason && (
                <div>
                  <span className="text-muted-foreground">Reason</span>
                  <div className="mt-0.5">{issue.reason}</div>
                </div>
              )}
              {issue.approved_at && (
                <div>
                  <span className="text-muted-foreground">Approved At</span>
                  <div className="mt-0.5">{formatDate(issue.approved_at)}</div>
                </div>
              )}
              {issue.created_at && (
                <div>
                  <span className="text-muted-foreground">Created At</span>
                  <div className="mt-0.5">{formatDate(issue.created_at)}</div>
                </div>
              )}
              {issue.parsed_result && Object.keys(issue.parsed_result).length > 0 && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Parsed Result</span>
                  <pre className="mt-1 p-2 bg-background rounded border border-border text-xs overflow-x-auto max-h-40 overflow-y-auto">
                    {JSON.stringify(issue.parsed_result, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Rich member context */}
            <IssueContextPanel issue={issue} memberContext={memberContext} />

            {/* Contextual actions */}
            <IssueActions issue={issue} onActionComplete={() => onActionComplete(issueKey)} memberContext={memberContext} />
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Section component — one per pipeline stage
// ---------------------------------------------------------------------------

function StageSection({
  stage,
  issues,
  expandedId,
  setExpandedId,
  getRowKey,
  onActionComplete,
  getMemberContext,
  onRequestContext,
  collapsed,
  onToggleCollapse,
  expandedIssueTypes,
  onToggleIssueType,
}: {
  stage: PipelineStage;
  issues: RepricingPipelineIssue[];
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  getRowKey: (issue: RepricingPipelineIssue, index: number) => string;
  onActionComplete: (issueKey: string) => void;
  getMemberContext: (userId: string) => MemberContext | 'loading' | 'error' | undefined;
  onRequestContext: (userId: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  expandedIssueTypes: Record<string, boolean>;
  onToggleIssueType: (key: string) => void;
}) {
  const Icon = stage.icon;

  // Group issues by issue_type, sorted by count descending
  const issueGroups = useMemo(() => {
    const groups = new Map<string, { issueType: string; label: string; issues: { issue: RepricingPipelineIssue; originalIndex: number }[] }>();
    issues.forEach((issue, idx) => {
      const existing = groups.get(issue.issue_type);
      if (existing) {
        existing.issues.push({ issue, originalIndex: idx });
      } else {
        groups.set(issue.issue_type, {
          issueType: issue.issue_type,
          label: issue.label,
          issues: [{ issue, originalIndex: idx }],
        });
      }
    });
    return Array.from(groups.values()).sort((a, b) => b.issues.length - a.issues.length);
  }, [issues]);

  return (
    <div className="mb-6">
      <button
        onClick={onToggleCollapse}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 rounded-t-lg border border-border bg-card hover:bg-accent/50 transition-colors border-l-4',
          stage.headerColor,
          collapsed && 'rounded-b-lg'
        )}
      >
        {collapsed ? (
          <ChevronRight className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
        <Icon className={cn('size-4', stage.color.split(' ')[0])} />
        <span className="text-sm font-semibold">{stage.label}</span>
        <span className="text-xs text-muted-foreground">{stage.description}</span>
        <span className={cn('ml-auto text-xs font-semibold px-2 py-0.5 rounded-full border', stage.color, stage.bgColor)}>
          {issues.length}
        </span>
      </button>

      {!collapsed && (
        <div className="border border-t-0 border-border rounded-b-lg overflow-hidden">
          {issues.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <CheckCircle2 className="size-5 text-green-500/60 mx-auto mb-1.5" />
              <p className="text-xs text-muted-foreground">No issues — this stage is healthy</p>
            </div>
          ) : (
            <div>
              {issueGroups.map((group) => {
                const groupKey = `${stage.key}-${group.issueType}`;
                const isGroupExpanded = expandedIssueTypes[groupKey] ?? false;

                return (
                  <div key={group.issueType}>
                    {/* Issue type sub-header */}
                    <button
                      onClick={() => onToggleIssueType(groupKey)}
                      className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-accent/50 transition-colors border-b border-border"
                    >
                      {isGroupExpanded ? (
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      )}
                      <span className="text-sm">{group.label}</span>
                      <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded-full border', stage.color, stage.bgColor)}>
                        {group.issues.length}
                      </span>
                    </button>

                    {/* Expanded issue rows */}
                    {isGroupExpanded && (
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border bg-card/50">
                            <th className="py-2 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Issue</th>
                            <th className="py-2 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">User</th>
                            <th className="py-2 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Booking</th>
                            <th className="py-2 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Reason</th>
                            <th className="py-2 px-4 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.issues.map(({ issue, originalIndex }) => {
                            const key = getRowKey(issue, originalIndex);
                            return (
                              <IssueRow
                                key={key}
                                issue={issue}
                                stage={stage}
                                isExpanded={expandedId === key}
                                onToggle={() => setExpandedId(expandedId === key ? null : key)}
                                onActionComplete={onActionComplete}
                                memberContext={getMemberContext(issue.user_id)}
                                onRequestContext={onRequestContext}
                                issueKey={key}
                              />
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BookingIssuesPage() {
  const [data, setData] = useState<RepricingPipelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterStage, setFilterStage] = useState<string>('all');
  const [userIdInput, setUserIdInput] = useState('');
  const [activeUserId, setActiveUserId] = useState<string | undefined>(undefined);

  // Track which stages are collapsed — persists across data refreshes
  const [collapsedStages, setCollapsedStages] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    PIPELINE_STAGES.forEach(s => { initial[s.key] = false; });
    return initial;
  });

  const toggleStageCollapse = useCallback((stageKey: string) => {
    setCollapsedStages(prev => ({ ...prev, [stageKey]: !prev[stageKey] }));
  }, []);

  // Track which issue type sub-groups have their rows expanded
  const [expandedIssueTypes, setExpandedIssueTypes] = useState<Record<string, boolean>>({});

  const toggleIssueType = useCallback((key: string) => {
    setExpandedIssueTypes(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Member context cache — keyed by user_id
  const memberContextCache = useRef<Map<string, MemberContext | 'loading' | 'error'>>(new Map());
  const [, forceUpdate] = useState(0);

  const fetchMemberContext = useCallback(async (userId: string) => {
    const cache = memberContextCache.current;
    if (cache.has(userId)) return;

    cache.set(userId, 'loading');
    forceUpdate((n) => n + 1);

    try {
      const ctx = await api.getMember(userId);
      cache.set(userId, ctx);
    } catch {
      cache.set(userId, 'error');
    }
    forceUpdate((n) => n + 1);
  }, []);

  const getMemberContext = useCallback((userId: string): MemberContext | 'loading' | 'error' | undefined => {
    return memberContextCache.current.get(userId);
  }, []);

  const fetchData = useCallback(async (userId?: string) => {
    setLoading(true);
    setError(null);
    memberContextCache.current.clear();
    try {
      const response = await api.getRepricingPipelineIssues(userId);
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch pipeline issues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(activeUserId);
  }, [fetchData, activeUserId]);

  const handleRefresh = useCallback(() => {
    fetchData(activeUserId);
  }, [fetchData, activeUserId]);

  // After an action, remove the issue from the local list immediately (so the
  // operator can keep working on the next row without the page collapsing),
  // then do a quiet background refresh to pick up any new issues.
  const handleActionComplete = useCallback((issueKey: string) => {
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        issues: prev.issues.filter((_issue, idx) => {
          const key = `${_issue.issue_type}-${_issue.user_id}-${_issue.booking_id ?? ''}-${idx}`;
          return key !== issueKey;
        }),
      };
    });
    // Quiet background refresh after a short delay — does NOT set loading=true
    // so the UI stays stable
    setTimeout(async () => {
      try {
        const response = await api.getRepricingPipelineIssues(activeUserId);
        setData(response);
      } catch {
        // Silently fail — the user already got feedback from the action
      }
    }, 3000);
  }, [activeUserId]);

  const handleUserSearch = () => {
    const trimmed = userIdInput.trim();
    if (trimmed) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(trimmed)) {
        setError('Invalid UUID format. Expected: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
        return;
      }
      setActiveUserId(trimmed);
    } else {
      setActiveUserId(undefined);
    }
    setExpandedId(null);
  };

  const handleClearUser = () => {
    setUserIdInput('');
    setActiveUserId(undefined);
    setExpandedId(null);
  };

  const stagesWithIssues = useMemo(() => {
    if (!data) return [];
    return PIPELINE_STAGES
      .map((stage) => {
        const issues = data.issues.filter((i) => stage.issueTypes.includes(i.issue_type));
        return { stage, issues };
      })
      .filter(({ stage }) => {
        if (filterStage === 'all') return true;
        return stage.key === filterStage;
      });
  }, [data, filterStage]);

  const stageCounts = useMemo(() => {
    if (!data) return {};
    const counts: Record<string, number> = {};
    for (const stage of PIPELINE_STAGES) {
      counts[stage.key] = data.issues.filter((i) => stage.issueTypes.includes(i.issue_type)).length;
    }
    return counts;
  }, [data]);

  const totalIssues = data?.issues.length ?? 0;

  const getRowKey = (issue: RepricingPipelineIssue, index: number) => {
    return `${issue.issue_type}-${issue.user_id}-${issue.booking_id ?? ''}-${index}`;
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Booking Issues</h1>
          <p className="text-muted-foreground mt-1">
            Repricing pipeline health — bookings needing attention
          </p>
          {!loading && data && (() => {
            const uniqueIssueBookings = new Set(data.issues.map(i => i.booking_id).filter(Boolean)).size;
            const total = data.healthy_bookings + uniqueIssueBookings;
            return total > 0 ? (
              <p className="text-sm mt-1">
                <span className="font-semibold text-green-400">{data.healthy_bookings}</span>
                <span className="text-muted-foreground"> of </span>
                <span className="font-semibold">{total}</span>
                <span className="text-muted-foreground"> bookings actively repricing</span>
              </p>
            ) : null;
          })()}
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={filterStage}
          onChange={(e) => {
            setFilterStage(e.target.value);
            setExpandedId(null);
          }}
          className="px-3 py-2 text-sm rounded-md border border-border bg-background hover:bg-accent transition-colors"
        >
          <option value="all">All Stages ({totalIssues})</option>
          {PIPELINE_STAGES.map((stage) => {
            const count = stageCounts[stage.key] ?? 0;
            return (
              <option key={stage.key} value={stage.key}>
                {stage.label} ({count})
              </option>
            );
          })}
        </select>

        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              value={userIdInput}
              onChange={(e) => setUserIdInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUserSearch()}
              placeholder="Filter by user ID..."
              className="pl-8 pr-3 py-2 text-sm rounded-md border border-border bg-background w-80 placeholder:text-muted-foreground"
            />
          </div>
          <button
            onClick={handleUserSearch}
            className="px-3 py-2 text-sm font-medium rounded-md border border-border hover:bg-accent transition-colors"
          >
            Search
          </button>
          {activeUserId && (
            <button
              onClick={handleClearUser}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        <div className="ml-auto text-sm text-muted-foreground">
          {totalIssues} issue{totalIssues !== 1 ? 's' : ''}
        </div>
      </div>

      {activeUserId && (
        <div className="mb-4 px-3 py-2 text-sm rounded-md border border-primary/30 bg-primary/5 flex items-center gap-2">
          <span className="text-muted-foreground">Filtering by user:</span>
          <span className="font-mono text-primary">{activeUserId}</span>
          <span className="text-muted-foreground">
            — includes cross-service checks (Observation, Opportunity, Import)
          </span>
        </div>
      )}

      {/* Stage summary pills */}
      {!loading && data && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          {PIPELINE_STAGES.map((stage) => {
            const count = stageCounts[stage.key] ?? 0;
            const StageIcon = stage.icon;
            return (
              <button
                key={stage.key}
                onClick={() => setFilterStage(filterStage === stage.key ? 'all' : stage.key)}
                className={cn(
                  'flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors',
                  filterStage === stage.key
                    ? cn(stage.color, stage.bgColor, 'ring-1 ring-current/20')
                    : count > 0
                      ? 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                      : 'border-border/50 text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/50'
                )}
              >
                <StageIcon className="size-3" />
                {stage.label}
                <span className={cn('font-semibold', count === 0 && 'text-green-500/60')}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border border-border rounded-lg overflow-hidden animate-pulse">
              <div className="px-4 py-3 bg-card flex items-center gap-3">
                <div className="h-4 w-4 bg-accent rounded" />
                <div className="h-4 w-24 bg-accent rounded" />
                <div className="h-3 w-48 bg-accent rounded" />
                <div className="ml-auto h-5 w-8 bg-accent rounded-full" />
              </div>
              <div className="border-t border-border">
                {Array.from({ length: 2 }).map((_, j) => (
                  <div key={j} className="flex items-center gap-4 py-3 px-4 border-b border-border last:border-0">
                    <div className="h-4 w-40 bg-accent rounded" />
                    <div className="h-4 w-20 bg-accent rounded" />
                    <div className="h-4 w-24 bg-accent rounded" />
                    <div className="ml-auto h-4 w-16 bg-accent rounded" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="border border-red-500/30 rounded-lg p-4 bg-red-500/5">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={handleRefresh} className="mt-2 text-sm text-primary hover:underline">
            Try again
          </button>
        </div>
      )}

      {/* Staged sections */}
      {!loading && !error && stagesWithIssues.map(({ stage, issues }) => (
        <StageSection
          key={stage.key}
          stage={stage}
          issues={issues}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          getRowKey={getRowKey}
          onActionComplete={handleActionComplete}
          getMemberContext={getMemberContext}
          onRequestContext={fetchMemberContext}
          collapsed={collapsedStages[stage.key] ?? false}
          onToggleCollapse={() => toggleStageCollapse(stage.key)}
          expandedIssueTypes={expandedIssueTypes}
          onToggleIssueType={toggleIssueType}
        />
      ))}
    </div>
  );
}
