'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  MemberSummary,
  MemberContext,
  TripView,
  BookingView,
  WatchView,
  FlightOpportunityView,
  HotelOpportunityView,
  EscalationSummary,
  PaymentRecord,
  CommunicationView,
  PendingTaskView,
  TravelerProfile,
  FlightBookingView,
  HotelBookingView,
  api,
  FlightBookingPatchRequest,
  HotelBookingPatchRequest,
} from '@/lib/api';

// Helper to get price from booking (handles both old and new schema)
function getBookingPrice(flight: FlightBookingView | null, hotel: HotelBookingView | null): { amount: number | null; currency: string } {
  if (flight) {
    // New schema: total_price is Money object
    if (flight.total_price?.amount !== undefined) {
      return { amount: flight.total_price.amount, currency: flight.total_price.currency };
    }
    // Legacy: customer_price is cents
    if (flight.customer_price !== undefined) {
      return { amount: flight.customer_price, currency: flight.currency || 'USD' };
    }
  }
  if (hotel) {
    if (hotel.total_price?.amount !== undefined) {
      return { amount: hotel.total_price.amount, currency: hotel.total_price.currency };
    }
    if (hotel.customer_price !== undefined) {
      return { amount: hotel.customer_price, currency: hotel.currency || 'USD' };
    }
  }
  return { amount: null, currency: 'USD' };
}

// Helper to get confirmation code (handles both old and new schema)
function getConfirmationCode(flight: FlightBookingView | null, hotel: HotelBookingView | null): string | null {
  if (flight) return flight.confirmation_code ?? flight.confirmation_number ?? null;
  if (hotel) return hotel.confirmation_code ?? hotel.confirmation_number ?? null;
  return null;
}

// Helper to get booking provider (handles both old and new schema)
function getBookingProvider(flight: FlightBookingView | null, hotel: HotelBookingView | null): string | null {
  if (flight) return flight.booked_with ?? flight.booking_provider ?? null;
  if (hotel) return hotel.booked_with ?? hotel.booking_provider ?? null;
  return null;
}

// Collapsible section component
function Section({
  title,
  count,
  defaultOpen = false,
  children,
  badge,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: { text: string; variant: 'success' | 'warning' | 'error' | 'info' };
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const badgeColors = {
    success: 'bg-green-500/20 text-green-400',
    warning: 'bg-yellow-500/20 text-yellow-400',
    error: 'bg-red-500/20 text-red-400',
    info: 'bg-blue-500/20 text-blue-400',
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 bg-accent/30 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className={cn('w-4 h-4 transition-transform', isOpen && 'rotate-90')}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium text-sm">{title}</span>
          {count !== undefined && (
            <span className="text-xs text-muted-foreground">({count})</span>
          )}
        </div>
        {badge && (
          <span className={cn('px-2 py-0.5 text-xs rounded', badgeColors[badge.variant])}>
            {badge.text}
          </span>
        )}
      </button>
      {isOpen && <div className="p-3 space-y-2">{children}</div>}
    </div>
  );
}

// Format helpers
function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(amount / 100);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString();
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleString();
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

// Sub-components for each data type

function UserSettingsCard({ context }: { context: MemberContext }) {
  const user = context.user;
  if (!user) return <p className="text-sm text-muted-foreground">No user settings available</p>;

  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Subscription</span>
        <span className={cn(
          user.subscription_status === 'PAYING' ? 'text-green-400' : 'text-muted-foreground'
        )}>{user.subscription_status}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Credit Balance</span>
        <span>{formatMoney(user.credit_balance * 100, user.credit_currency)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Total Savings</span>
        <span className="text-green-400">{formatMoney(user.total_savings * 100, 'USD')}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Action Threshold</span>
        <span>${user.action_threshold_usd}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Auto-Reprice Flights</span>
        <span>{user.auto_reprice_flights ? 'Yes' : 'No'}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Auto-Reprice Hotels</span>
        <span>{user.auto_reprice_hotels ? 'Yes' : 'No'}</span>
      </div>
      <div className="col-span-2 flex justify-between">
        <span className="text-muted-foreground">Channels</span>
        <span>{user.channels?.join(', ') || 'None'}</span>
      </div>
      {user.forwarding_email && (
        <div className="col-span-2 flex justify-between">
          <span className="text-muted-foreground">Forwarding Email</span>
          <span className="font-mono text-xs">{user.forwarding_email}</span>
        </div>
      )}
    </div>
  );
}

function UserContextCard({ userContext }: { userContext: MemberContext['user_context'] }) {
  if (!userContext) return <p className="text-sm text-muted-foreground">No activity data available</p>;

  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Messages Today</span>
          <span>{userContext.messages_sent_today}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Messages This Week</span>
          <span>{userContext.messages_sent_this_week}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Days Since Last Contact</span>
          <span>{userContext.days_since_last_interaction}</span>
        </div>
      </div>
      {userContext.narrative && (
        <div className="mt-2 p-2 bg-accent/50 rounded text-xs">
          <span className="text-muted-foreground">Narrative: </span>
          {userContext.narrative}
        </div>
      )}
    </div>
  );
}

function TravelerCard({ traveler }: { traveler: TravelerProfile }) {
  return (
    <div className="bg-accent/30 rounded p-2 text-sm">
      <div className="font-medium">
        {traveler.first_name} {traveler.last_name}
      </div>
      <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
        {traveler.email && <div>Email: {traveler.email}</div>}
        {traveler.date_of_birth && <div>DOB: {traveler.date_of_birth}</div>}
        {traveler.known_traveler_number && <div>KTN: {traveler.known_traveler_number}</div>}
        {traveler.passport_number && (
          <div>Passport: {traveler.passport_country} - expires {traveler.passport_expiry}</div>
        )}
        {Object.keys(traveler.loyalty_programs || {}).length > 0 && (
          <div>
            Loyalty: {Object.entries(traveler.loyalty_programs).map(([k, v]) => `${k}: ${v}`).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

// Edit Booking Modal
function EditBookingModal({
  booking,
  onClose,
  onSave,
}: {
  booking: BookingView;
  onClose: () => void;
  onSave: () => void;
}) {
  const isHotel = booking.type === 'HOTEL';
  const flightData = booking.flight;
  const hotelData = booking.hotel;

  const [confirmationCode, setConfirmationCode] = useState(
    (isHotel ? hotelData?.confirmation_number : flightData?.confirmation_number) || ''
  );
  const [bookingProvider, setBookingProvider] = useState(
    (isHotel ? hotelData?.booking_provider : flightData?.booking_provider) || ''
  );

  // Price fields (stored in cents)
  const currentPrice = isHotel ? hotelData?.customer_price : flightData?.customer_price;
  const currentCurrency = isHotel ? hotelData?.currency : flightData?.currency;
  const [priceAmount, setPriceAmount] = useState(
    currentPrice !== null && currentPrice !== undefined ? (currentPrice / 100).toFixed(2) : ''
  );
  const [priceCurrency, setPriceCurrency] = useState(currentCurrency || 'USD');

  // Hotel-specific fields
  const [hotelName, setHotelName] = useState(hotelData?.hotel_name || '');
  const [checkInDate, setCheckInDate] = useState(hotelData?.check_in || hotelData?.check_in_date || '');
  const [checkOutDate, setCheckOutDate] = useState(hotelData?.check_out || hotelData?.check_out_date || '');
  const [roomType, setRoomType] = useState(hotelData?.room_type || '');

  // Flight-specific fields - handle both old and new schema
  // New schema: legs[].segments[].origin/destination/departure
  // Old schema: legs[].departure_airport/arrival_airport/departure_time
  const getFlightFields = () => {
    const legs = flightData?.legs || [];
    const outboundLeg = legs.find((l: { direction?: string }) => l.direction === 'OUTBOUND') || legs[0];
    const returnLeg = legs.find((l: { direction?: string }) => l.direction === 'RETURN') || legs[1];

    // Helper to extract from new schema
    const getFromLeg = (leg: typeof legs[0] | undefined) => {
      if (!leg) return { dep: '', arr: '', time: '' };
      // New schema
      if ('segments' in leg && leg.segments?.length > 0) {
        const firstSeg = leg.segments[0];
        const lastSeg = leg.segments[leg.segments.length - 1];
        return {
          dep: firstSeg.origin || '',
          arr: lastSeg.destination || '',
          time: firstSeg.departure?.slice(0, 16) || '',
        };
      }
      // Old schema
      return {
        dep: (leg as { departure_airport?: string }).departure_airport || '',
        arr: (leg as { arrival_airport?: string }).arrival_airport || '',
        time: ((leg as { departure_time?: string }).departure_time || '').slice(0, 16),
      };
    };

    return {
      outbound: getFromLeg(outboundLeg),
      return: getFromLeg(returnLeg),
      hasReturn: !!returnLeg && legs.length > 1,
    };
  };

  const flightFields = getFlightFields();
  const [outboundDep, setOutboundDep] = useState(flightFields.outbound.dep);
  const [outboundArr, setOutboundArr] = useState(flightFields.outbound.arr);
  const [outboundTime, setOutboundTime] = useState(flightFields.outbound.time);
  const [returnDep, setReturnDep] = useState(flightFields.return.dep);
  const [returnArr, setReturnArr] = useState(flightFields.return.arr);
  const [returnTime, setReturnTime] = useState(flightFields.return.time);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);

    try {
      if (isHotel) {
        const patchData: HotelBookingPatchRequest = {};

        const origConfCode = hotelData?.confirmation_code ?? hotelData?.confirmation_number ?? '';
        const origProvider = hotelData?.booked_with ?? hotelData?.booking_provider ?? '';

        if (confirmationCode !== origConfCode) {
          patchData.confirmation_code = confirmationCode;
        }
        if (bookingProvider !== origProvider) {
          patchData.booking_provider = bookingProvider;
        }

        // Price change
        const newPriceAmount = priceAmount ? Math.round(parseFloat(priceAmount) * 100) : null;
        if (newPriceAmount !== null && (newPriceAmount !== currentPrice || priceCurrency !== currentCurrency)) {
          patchData.customer_price = { amount: newPriceAmount, currency: priceCurrency };
        }

        // Stay changes
        const stayChanges: HotelBookingPatchRequest['stay'] = {};
        const origCheckIn = hotelData?.check_in || hotelData?.check_in_date || '';
        const origCheckOut = hotelData?.check_out || hotelData?.check_out_date || '';
        if (hotelName !== (hotelData?.hotel_name || '')) stayChanges.hotel_name = hotelName;
        if (checkInDate !== origCheckIn) stayChanges.check_in_date = checkInDate;
        if (checkOutDate !== origCheckOut) stayChanges.check_out_date = checkOutDate;
        if (roomType !== (hotelData?.room_type || '')) stayChanges.room_type = roomType;
        if (Object.keys(stayChanges).length > 0) {
          patchData.stay = stayChanges;
        }

        if (Object.keys(patchData).length === 0) {
          onClose();
          return;
        }

        await api.patchHotelBooking(booking.id, patchData);
      } else {
        const patchData: FlightBookingPatchRequest = {};

        const origConfCode = flightData?.confirmation_code ?? flightData?.confirmation_number ?? '';
        const origProvider = flightData?.booked_with ?? flightData?.booking_provider ?? '';

        if (confirmationCode !== origConfCode) {
          patchData.confirmation_code = confirmationCode;
        }
        if (bookingProvider !== origProvider) {
          patchData.booking_provider = bookingProvider;
        }

        // Price change
        const newPriceAmount = priceAmount ? Math.round(parseFloat(priceAmount) * 100) : null;
        if (newPriceAmount !== null && (newPriceAmount !== currentPrice || priceCurrency !== currentCurrency)) {
          patchData.customer_price = { amount: newPriceAmount, currency: priceCurrency };
        }

        // Itinerary changes - outbound and return legs
        const outboundChanged = outboundDep !== flightFields.outbound.dep ||
                                outboundArr !== flightFields.outbound.arr ||
                                outboundTime !== flightFields.outbound.time;
        const returnChanged = flightFields.hasReturn && (
                              returnDep !== flightFields.return.dep ||
                              returnArr !== flightFields.return.arr ||
                              returnTime !== flightFields.return.time);

        if (outboundChanged || returnChanged) {
          const legs: FlightBookingPatchRequest['itinerary'] = { legs: [] };

          // Outbound leg
          if (outboundDep || outboundArr || outboundTime) {
            legs.legs?.push({
              departure_airport: outboundDep || undefined,
              arrival_airport: outboundArr || undefined,
              departure_time: outboundTime ? outboundTime + ':00' : undefined,
            });
          }

          // Return leg
          if (flightFields.hasReturn && (returnDep || returnArr || returnTime)) {
            legs.legs?.push({
              departure_airport: returnDep || undefined,
              arrival_airport: returnArr || undefined,
              departure_time: returnTime ? returnTime + ':00' : undefined,
            });
          }

          if (legs.legs && legs.legs.length > 0) {
            patchData.itinerary = legs;
          }
        }

        if (Object.keys(patchData).length === 0) {
          onClose();
          return;
        }

        await api.patchFlightBooking(booking.id, patchData);
      }

      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]">
      <div className="bg-card border border-border rounded-lg p-4 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">Edit {isHotel ? 'Hotel' : 'Flight'} Booking</h3>

        <div className="space-y-4">
          {/* Common fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Confirmation Code</label>
              <input
                type="text"
                value={confirmationCode}
                onChange={(e) => setConfirmationCode(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Booking Provider</label>
              <input
                type="text"
                value={bookingProvider}
                onChange={(e) => setBookingProvider(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              />
            </div>
          </div>

          {/* Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Price</label>
              <input
                type="number"
                step="0.01"
                value={priceAmount}
                onChange={(e) => setPriceAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Currency</label>
              <select
                value={priceCurrency}
                onChange={(e) => setPriceCurrency(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="CAD">CAD</option>
                <option value="AUD">AUD</option>
              </select>
            </div>
          </div>

          {/* Hotel-specific fields */}
          {isHotel && (
            <>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Hotel Name</label>
                <input
                  type="text"
                  value={hotelName}
                  onChange={(e) => setHotelName(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Check-in Date</label>
                  <input
                    type="date"
                    value={checkInDate}
                    onChange={(e) => setCheckInDate(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Check-out Date</label>
                  <input
                    type="date"
                    value={checkOutDate}
                    onChange={(e) => setCheckOutDate(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Room Type</label>
                <input
                  type="text"
                  value={roomType}
                  onChange={(e) => setRoomType(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
              </div>
            </>
          )}

          {/* Flight-specific fields */}
          {!isHotel && (
            <>
              {/* Outbound leg */}
              <div className="text-sm font-medium text-muted-foreground">Outbound</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">From</label>
                  <input
                    type="text"
                    value={outboundDep}
                    onChange={(e) => setOutboundDep(e.target.value.toUpperCase())}
                    maxLength={3}
                    placeholder="JFK"
                    className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">To</label>
                  <input
                    type="text"
                    value={outboundArr}
                    onChange={(e) => setOutboundArr(e.target.value.toUpperCase())}
                    maxLength={3}
                    placeholder="LAX"
                    className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Departure Time</label>
                <input
                  type="datetime-local"
                  value={outboundTime}
                  onChange={(e) => setOutboundTime(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
              </div>

              {/* Return leg */}
              {flightFields.hasReturn && (
                <>
                  <div className="text-sm font-medium text-muted-foreground mt-2">Return</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm text-muted-foreground mb-1">From</label>
                      <input
                        type="text"
                        value={returnDep}
                        onChange={(e) => setReturnDep(e.target.value.toUpperCase())}
                        maxLength={3}
                        placeholder="LAX"
                        className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-muted-foreground mb-1">To</label>
                      <input
                        type="text"
                        value={returnArr}
                        onChange={(e) => setReturnArr(e.target.value.toUpperCase())}
                        maxLength={3}
                        placeholder="JFK"
                        className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1">Departure Time</label>
                    <input
                      type="datetime-local"
                      value={returnTime}
                      onChange={(e) => setReturnTime(e.target.value)}
                      className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    />
                  </div>
                </>
              )}
            </>
          )}

          {error && (
            <div className="text-red-400 text-sm">{error}</div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-border rounded hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BookingCard({ booking, onRefresh }: { booking: BookingView; onRefresh?: () => void }) {
  const isHotel = booking.type === 'HOTEL';
  const data = isHotel ? booking.hotel : booking.flight;

  const [showActions, setShowActions] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const statusColors: Record<string, string> = {
    CONFIRMED: 'bg-green-500/20 text-green-400',
    CANCELLED: 'bg-red-500/20 text-red-400',
    PENDING: 'bg-yellow-500/20 text-yellow-400',
    IN_PROGRESS: 'bg-blue-500/20 text-blue-400',
  };

  async function handleRegenerateWatch() {
    setActionLoading(true);
    setActionError(null);
    try {
      await api.regenerateWatch(booking.id);
      setShowActions(false);
      onRefresh?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to regenerate watch');
    } finally {
      setActionLoading(false);
    }
  }

  if (!data) return null;

  return (
    <>
      <div className="bg-accent/30 rounded p-2 text-sm relative">
        {/* Actions menu button */}
        <button
          onClick={() => setShowActions(!showActions)}
          className="absolute top-2 right-2 p-1 hover:bg-accent rounded transition-colors"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        </button>

        {/* Actions dropdown */}
        {showActions && (
          <div className="absolute top-8 right-2 bg-card border border-border rounded shadow-lg z-10 min-w-[160px]">
            <button
              onClick={() => {
                setShowEditModal(true);
                setShowActions(false);
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
            >
              Edit Booking
            </button>
            <button
              onClick={handleRegenerateWatch}
              disabled={actionLoading}
              className="w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors disabled:opacity-50"
            >
              {actionLoading ? 'Regenerating...' : 'Regenerate Watch'}
            </button>
          </div>
        )}

        {actionError && (
          <div className="text-red-400 text-xs mb-1">{actionError}</div>
        )}

        <div className="flex items-center gap-2 mb-1 pr-6">
          <span className={cn('px-1.5 py-0.5 text-xs rounded', isHotel ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400')}>
            {booking.type}
          </span>
          <span className={cn('px-1.5 py-0.5 text-xs rounded', statusColors[booking.status] || 'bg-gray-500/20')}>
            {booking.status}
          </span>
          <span className="text-xs text-muted-foreground">{booking.agent}</span>
        </div>

        {isHotel && booking.hotel && (() => {
          const price = getBookingPrice(null, booking.hotel);
          const checkIn = booking.hotel.check_in || booking.hotel.check_in_date;
          const checkOut = booking.hotel.check_out || booking.hotel.check_out_date;
          return (
            <>
              <div className="font-medium">{booking.hotel.hotel_name || 'Unknown Hotel'}</div>
              <div className="text-xs text-muted-foreground">
                {formatDate(checkIn)} - {formatDate(checkOut)}
                {booking.hotel.room_type && ` · ${booking.hotel.room_type}`}
              </div>
              <div className="text-xs mt-1">
                <span className="text-muted-foreground">Price: </span>
                {formatMoney(price.amount, price.currency)}
                {booking.hotel.refundability && (
                  <span className={cn('ml-2', booking.hotel.refundability === 'REFUNDABLE' ? 'text-green-400' : 'text-yellow-400')}>
                    {booking.hotel.refundability}
                  </span>
                )}
              </div>
              {booking.hotel.cancellation_deadline && (
                <div className="text-xs text-muted-foreground">
                  Cancel by: {formatDateTime(booking.hotel.cancellation_deadline)}
                </div>
              )}
            </>
          );
        })()}

        {!isHotel && booking.flight && (() => {
          const price = getBookingPrice(booking.flight, null);
          const legs = booking.flight.legs || [];

          // Handle new schema (legs with segments) vs old schema (legs with departure_airport)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const formatLegRoute = (leg: any) => {
            // New schema: leg has direction and segments
            if (leg.segments?.length > 0) {
              const firstSeg = leg.segments[0];
              const lastSeg = leg.segments[leg.segments.length - 1];
              return `${firstSeg.origin}-${lastSeg.destination}`;
            }
            // Old schema: leg has departure_airport/arrival_airport directly
            if (leg.departure_airport) {
              return `${leg.departure_airport}-${leg.arrival_airport}`;
            }
            return '';
          };

          const getFirstDeparture = () => {
            if (legs.length === 0) return null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const firstLeg = legs[0] as any;
            if (firstLeg.segments?.length > 0) {
              return firstLeg.segments[0].departure;
            }
            if (firstLeg.departure_time) {
              return firstLeg.departure_time;
            }
            return null;
          };

          const isRepriceable = booking.flight.is_repriceable ?? (booking.flight.reprice_eligibility === 'ELIGIBLE');

          return (
            <>
              <div className="font-medium">
                {legs.map((leg, i) => {
                  const direction = 'direction' in leg ? leg.direction : null;
                  return (
                    <span key={i}>
                      {i > 0 && ' → '}
                      {direction && <span className="text-muted-foreground text-xs mr-1">({direction})</span>}
                      {formatLegRoute(leg)}
                    </span>
                  );
                })}
                {legs.length === 0 && '-'}
              </div>
              <div className="text-xs text-muted-foreground">
                {getFirstDeparture() && formatDateTime(getFirstDeparture())}
                {booking.flight.passengers?.length > 0 && ` · ${booking.flight.passengers.length} pax`}
              </div>
              <div className="text-xs mt-1">
                <span className="text-muted-foreground">Price: </span>
                {formatMoney(price.amount, price.currency)}
              </div>
              <div className="text-xs mt-1">
                <span className={cn(
                  isRepriceable ? 'text-green-400' : 'text-yellow-400'
                )}>
                  Reprice: {isRepriceable ? 'ELIGIBLE' : 'INELIGIBLE'}
              </span>
              {booking.flight.reprice_ineligible_reason && (
                <span className="text-muted-foreground ml-1">({booking.flight.reprice_ineligible_reason})</span>
              )}
            </div>
          </>
          );
        })()}

        {(() => {
          const confCode = getConfirmationCode(booking.flight, booking.hotel);
          const provider = getBookingProvider(booking.flight, booking.hotel);
          if (!confCode) return null;
          return (
            <div className="text-xs text-muted-foreground mt-1">
              Conf: {confCode}
              {provider && ` via ${provider}`}
            </div>
          );
        })()}
      </div>

      {showEditModal && (
        <EditBookingModal
          booking={booking}
          onClose={() => setShowEditModal(false)}
          onSave={() => onRefresh?.()}
        />
      )}
    </>
  );
}

function TripCard({ trip, onRefresh }: { trip: TripView; onRefresh?: () => void }) {
  const [expanded, setExpanded] = useState(false);

  const statusColors: Record<string, string> = {
    FUTURE: 'bg-blue-500/20 text-blue-400',
    IN_PROGRESS: 'bg-green-500/20 text-green-400',
    PAST: 'bg-gray-500/20 text-gray-400',
  };

  return (
    <div className="bg-accent/30 rounded overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-2 text-left hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div>
            <span className="font-medium text-sm">{trip.name || trip.destination || 'Unnamed Trip'}</span>
            <span className={cn('ml-2 px-1.5 py-0.5 text-xs rounded', statusColors[trip.status])}>
              {trip.status}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">{trip.bookings.length} bookings</span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {formatDate(trip.start_date)} - {formatDate(trip.end_date)}
          {trip.purpose && ` · ${trip.purpose}`}
        </div>
      </button>
      {expanded && trip.bookings.length > 0 && (
        <div className="p-2 pt-0 space-y-2">
          {trip.bookings.map((booking) => (
            <BookingCard key={booking.id} booking={booking} onRefresh={onRefresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function WatchCard({ watch }: { watch: WatchView }) {
  const statusColors: Record<string, string> = {
    ACTIVE: 'bg-green-500/20 text-green-400',
    PAUSED: 'bg-yellow-500/20 text-yellow-400',
    ENDED: 'bg-gray-500/20 text-gray-400',
  };

  return (
    <div className="bg-accent/30 rounded p-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">{watch.watch_type}</span>
        <span className={cn('px-1.5 py-0.5 text-xs rounded', statusColors[watch.status] || 'bg-gray-500/20')}>
          {watch.status}
        </span>
        {watch.priority && (
          <span className="text-xs text-muted-foreground">{watch.priority}</span>
        )}
      </div>
      {watch.goal && <div className="text-xs text-muted-foreground mt-1">Goal: {watch.goal}</div>}
      {watch.threshold_amount && (
        <div className="text-xs mt-1">
          Threshold: {formatMoney(watch.threshold_amount, watch.threshold_currency)}
        </div>
      )}
      <div className="text-xs text-muted-foreground mt-1">
        Created {timeAgo(watch.created_at)}
        {watch.source && ` · Source: ${watch.source}`}
      </div>
    </div>
  );
}

function OpportunityCard({ opportunity, type }: { opportunity: FlightOpportunityView | HotelOpportunityView; type: 'flight' | 'hotel' }) {
  const isHotel = type === 'hotel';
  const hotelOpp = opportunity as HotelOpportunityView;

  return (
    <div className="bg-accent/30 rounded p-2 text-sm">
      <div className="flex items-center gap-2 mb-1">
        <span className={cn('px-1.5 py-0.5 text-xs rounded', isHotel ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400')}>
          {type.toUpperCase()}
        </span>
        <span className="font-medium">{opportunity.status}</span>
      </div>
      {isHotel && hotelOpp.hotel_name && (
        <div className="text-xs">{hotelOpp.hotel_name}</div>
      )}
      <div className="text-xs mt-1">
        {opportunity.old_price && opportunity.new_price && (
          <>
            <span className="line-through text-muted-foreground">
              {formatMoney(opportunity.old_price, opportunity.savings_currency)}
            </span>
            <span className="mx-1">→</span>
            <span className="text-green-400">{formatMoney(opportunity.new_price, opportunity.savings_currency)}</span>
          </>
        )}
        {opportunity.savings_amount && (
          <span className="ml-2 text-green-400">
            Save {formatMoney(opportunity.savings_amount, opportunity.savings_currency)}
          </span>
        )}
      </div>
      {isHotel && hotelOpp.payment_status && (
        <div className="text-xs mt-1">
          Payment: {hotelOpp.payment_status}
          {hotelOpp.payment_amount && ` - ${formatMoney(hotelOpp.payment_amount, hotelOpp.payment_currency)}`}
        </div>
      )}
      <div className="text-xs text-muted-foreground mt-1">{timeAgo(opportunity.created_at)}</div>
    </div>
  );
}

function EscalationCard({ escalation }: { escalation: EscalationSummary }) {
  const statusColors: Record<string, string> = {
    open: 'bg-red-500/20 text-red-400',
    claimed: 'bg-yellow-500/20 text-yellow-400',
    resolved: 'bg-green-500/20 text-green-400',
  };

  return (
    <div className="bg-accent/30 rounded p-2 text-sm">
      <div className="flex items-center gap-2">
        <span className={cn('px-1.5 py-0.5 text-xs rounded', statusColors[escalation.status] || 'bg-gray-500/20')}>
          {escalation.status}
        </span>
        <span className="font-medium">{escalation.type}</span>
      </div>
      <div className="text-xs text-muted-foreground mt-1">{escalation.reason}</div>
      <div className="text-xs text-muted-foreground mt-1">
        {timeAgo(escalation.created_at)}
        {escalation.resolved_at && ` · Resolved ${timeAgo(escalation.resolved_at)}`}
        {escalation.resolved_by && ` by ${escalation.resolved_by}`}
      </div>
    </div>
  );
}

function PaymentCard({ payment }: { payment: PaymentRecord }) {
  const statusColors: Record<string, string> = {
    completed: 'bg-green-500/20 text-green-400',
    pending: 'bg-yellow-500/20 text-yellow-400',
    failed: 'bg-red-500/20 text-red-400',
  };

  return (
    <div className="bg-accent/30 rounded p-2 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn('px-1.5 py-0.5 text-xs rounded', statusColors[payment.status] || 'bg-gray-500/20')}>
            {payment.status}
          </span>
          <span className="font-medium">{payment.type}</span>
        </div>
        <span className="font-medium">{formatMoney(payment.amount, payment.currency)}</span>
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {timeAgo(payment.created_at)}
        {payment.stripe_payment_intent_id && (
          <span className="ml-2 font-mono">{payment.stripe_payment_intent_id.slice(0, 20)}...</span>
        )}
      </div>
      {payment.failure_reason && (
        <div className="text-xs text-red-400 mt-1">{payment.failure_reason}</div>
      )}
    </div>
  );
}

function CommunicationCard({ comm }: { comm: CommunicationView }) {
  return (
    <div className={cn(
      'rounded p-2 text-sm max-w-[80%]',
      comm.direction === 'OUTBOUND' ? 'bg-primary/20 ml-auto' : 'bg-accent/50'
    )}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <span>{comm.channel}</span>
        <span>{timeAgo(comm.created_at)}</span>
      </div>
      <div className="text-sm whitespace-pre-wrap">{comm.content}</div>
    </div>
  );
}

function TaskCard({ task }: { task: PendingTaskView }) {
  const priorityColors: Record<string, string> = {
    urgent: 'text-red-400',
    high: 'text-orange-400',
    normal: 'text-foreground',
    low: 'text-muted-foreground',
  };

  return (
    <div className="bg-accent/30 rounded p-2 text-sm">
      <div className="flex items-center gap-2">
        <span className={cn('text-xs font-medium uppercase', priorityColors[task.priority])}>
          {task.priority}
        </span>
        <span className="font-medium">{task.capability}</span>
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {task.status} · {timeAgo(task.created_at)}
      </div>
    </div>
  );
}

// Main component
export function MemberDetail({
  member,
  context,
  onClose,
  onRefresh,
  loading,
  error,
}: {
  member: MemberSummary;
  context: MemberContext | null;
  onClose: () => void;
  onRefresh?: () => void;
  loading: boolean;
  error: string | null;
}) {
  const openEscalations = context?.escalations.filter(e => e.status === 'open').length || 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
      <div className="w-full max-w-3xl bg-card border-l border-border h-full overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-semibold">{member.name || 'Unknown'}</h2>
            <p className="text-sm text-muted-foreground">{member.email}</p>
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

        <div className="p-4 space-y-4">
          {/* Basic Info */}
          <div className="bg-accent/50 rounded-lg p-3 space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">ID</span>
                <span className="font-mono text-xs">{member.id.slice(0, 8)}...</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phone</span>
                <span>{member.phone_number || 'None'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className={cn(member.status === 'active' ? 'text-green-400' : '')}>{member.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Membership</span>
                <span>{member.membership_status || 'None'} {member.membership_plan ? `(${member.membership_plan})` : ''}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Joined</span>
                <span>{formatDate(member.created_at)}</span>
              </div>
              {context?.user_extras.stripe_customer_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stripe</span>
                  <span className="font-mono text-xs">{context.user_extras.stripe_customer_id.slice(0, 16)}...</span>
                </div>
              )}
            </div>
          </div>

          {/* Loading/Error */}
          {loading && (
            <div className="text-center text-muted-foreground py-8">
              Loading member context...
            </div>
          )}

          {error && (
            <div className="bg-red-500/20 text-red-400 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Full Context */}
          {context && (
            <>
              {/* User Settings & Activity */}
              <Section title="Settings & Preferences" defaultOpen>
                <UserSettingsCard context={context} />
              </Section>

              <Section title="Activity & Engagement">
                <UserContextCard userContext={context.user_context} />
              </Section>

              {/* Escalations - prominent if open */}
              {context.escalations.length > 0 && (
                <Section
                  title="Escalations"
                  count={context.escalations.length}
                  defaultOpen={openEscalations > 0}
                  badge={openEscalations > 0 ? { text: `${openEscalations} open`, variant: 'error' } : undefined}
                >
                  {context.escalations.map((esc) => (
                    <EscalationCard key={esc.id} escalation={esc} />
                  ))}
                </Section>
              )}

              {/* Pending Tasks */}
              {context.pending_tasks.length > 0 && (
                <Section title="Pending Tasks" count={context.pending_tasks.length} defaultOpen>
                  {context.pending_tasks.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </Section>
              )}

              {/* Trips & Bookings */}
              <Section title="Trips" count={context.trips.length} defaultOpen={context.trips.length > 0}>
                {context.trips.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No trips</p>
                ) : (
                  context.trips.map((trip) => <TripCard key={trip.id} trip={trip} onRefresh={onRefresh} />)
                )}
              </Section>

              {/* Watches */}
              <Section title="Watches" count={context.watches.length}>
                {context.watches.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active watches</p>
                ) : (
                  context.watches.map((watch) => <WatchCard key={watch.id} watch={watch} />)
                )}
              </Section>

              {/* Opportunities */}
              {(context.flight_opportunities.length > 0 || context.hotel_opportunities.length > 0) && (
                <Section
                  title="Opportunities"
                  count={context.flight_opportunities.length + context.hotel_opportunities.length}
                  badge={{ text: 'Active', variant: 'success' }}
                >
                  {context.flight_opportunities.map((opp) => (
                    <OpportunityCard key={opp.id} opportunity={opp} type="flight" />
                  ))}
                  {context.hotel_opportunities.map((opp) => (
                    <OpportunityCard key={opp.id} opportunity={opp} type="hotel" />
                  ))}
                </Section>
              )}

              {/* Travellers */}
              <Section title="Travellers" count={context.travellers.length}>
                {context.travellers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No travellers</p>
                ) : (
                  context.travellers.map((t) => <TravelerCard key={t.id} traveler={t} />)
                )}
              </Section>

              {/* Communications */}
              <Section title="Communications" count={context.communications.length}>
                {context.communications.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent communications</p>
                ) : (
                  <div className="space-y-2">
                    {context.communications.map((comm) => (
                      <CommunicationCard key={comm.id} comm={comm} />
                    ))}
                  </div>
                )}
              </Section>

              {/* Payment History */}
              <Section title="Payment History" count={context.payment_records.length}>
                {context.payment_records.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No payment records</p>
                ) : (
                  context.payment_records.map((pay) => <PaymentCard key={pay.id} payment={pay} />)
                )}
              </Section>

              {/* Airline Credits */}
              {context.airline_credits.length > 0 && (
                <Section title="Airline Credits" count={context.airline_credits.length}>
                  {context.airline_credits.map((credit) => (
                    <div key={credit.id} className="bg-accent/30 rounded p-2 text-sm">
                      <div className="flex justify-between">
                        <span className="font-medium">{credit.airline}</span>
                        <span>{formatMoney(credit.amount * 100, credit.currency)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {credit.status}
                        {credit.expiry_date && ` · Expires ${formatDate(credit.expiry_date)}`}
                      </div>
                    </div>
                  ))}
                </Section>
              )}

              {/* Referral Stats */}
              {context.referral_stats && (
                <Section title="Referrals">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Code</span>
                      <span className="font-mono">{context.referral_stats.referral_code}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total</span>
                      <span>{context.referral_stats.total_referrals}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Successful</span>
                      <span className="text-green-400">{context.referral_stats.successful_referrals}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Earnings</span>
                      <span>{formatMoney(context.referral_stats.total_earnings * 100, context.referral_stats.earnings_currency)}</span>
                    </div>
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
