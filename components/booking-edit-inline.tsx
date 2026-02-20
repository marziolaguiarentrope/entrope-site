'use client';

import { useState, useEffect } from 'react';
import { cn, fromMinorUnits } from '@/lib/utils';
import {
  BookingView,
  FlightBookingView,
  HotelBookingView,
  FlightBookingPatchRequest,
  HotelBookingPatchRequest,
  FlightTicketPatch,
  BookingTravelerPatch,
  VerificationStatus,
  HotelMatchResult,
  TravelerProfile,
  RawEmail,
  api,
} from '@/lib/api';

// ─── Helpers (duplicated from member-detail to avoid circular imports) ────────

function getBookingPrice(
  flight: FlightBookingView | null,
  hotel: HotelBookingView | null
): { amount: number | null; currency: string } {
  if (flight) {
    if (flight.total_price?.amount !== undefined)
      return { amount: flight.total_price.amount, currency: flight.total_price.currency };
    if (flight.customer_price !== undefined)
      return { amount: flight.customer_price, currency: flight.currency || 'USD' };
  }
  if (hotel) {
    if (hotel.total_price?.amount !== undefined)
      return { amount: hotel.total_price.amount, currency: hotel.total_price.currency };
    if (hotel.customer_price !== undefined)
      return { amount: hotel.customer_price, currency: hotel.currency || 'USD' };
  }
  return { amount: null, currency: 'USD' };
}

function getConfirmationCode(
  flight: FlightBookingView | null,
  hotel: HotelBookingView | null
): string | null {
  if (flight) return flight.confirmation_code ?? flight.confirmation_number ?? null;
  if (hotel) return hotel.confirmation_code ?? hotel.confirmation_number ?? null;
  return null;
}

function getBookingProvider(
  flight: FlightBookingView | null,
  hotel: HotelBookingView | null
): string | null {
  if (flight) return flight.booked_with ?? flight.booking_provider ?? null;
  if (hotel) return hotel.booked_with ?? hotel.booking_provider ?? null;
  return null;
}

function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return 'N/A';
  const curr = currency || 'USD';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: curr,
  }).format(fromMinorUnits(amount, curr));
}

// ─── Shared field classes ─────────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm';
const labelCls = 'block text-sm text-muted-foreground mb-1';

// ─── Tab pill component ───────────────────────────────────────────────────────

function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}) {
  return (
    <div className="flex gap-1 mb-4 flex-wrap">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-full transition-colors',
            active === t
              ? 'bg-primary text-primary-foreground'
              : 'bg-accent/50 text-muted-foreground hover:bg-accent'
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// ─── Email viewer (adapted from task-detail.tsx) ──────────────────────────────

function InlineEmailViewer({
  email,
  loading,
  error,
}: {
  email: RawEmail | null;
  loading: boolean;
  error: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  if (loading)
    return <p className="text-sm text-muted-foreground py-4">Loading email...</p>;

  if (error)
    return (
      <div className="bg-red-500/10 rounded p-3">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );

  if (!email)
    return (
      <div className="bg-accent/30 rounded p-3">
        <p className="text-sm text-muted-foreground">No source email found for this booking.</p>
      </div>
    );

  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <div>
          <span className="text-muted-foreground">From: </span>
          <span>{email.from_address || 'N/A'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">To: </span>
          <span>{email.to_address || 'N/A'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Subject: </span>
          <span className="font-medium">{email.subject || 'N/A'}</span>
        </div>
        {email.received_at && (
          <div>
            <span className="text-muted-foreground">Received: </span>
            <span>{new Date(email.received_at).toLocaleString()}</span>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground font-medium">Email Body</span>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-primary hover:underline"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        <div
          className={cn(
            'bg-background rounded p-3 overflow-y-auto text-sm whitespace-pre-wrap',
            expanded ? 'max-h-[600px]' : 'max-h-48'
          )}
          dangerouslySetInnerHTML={{ __html: email.body || 'No content' }}
        />
      </div>

      {email.attachments && email.attachments.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="text-xs text-muted-foreground mb-1">Attachments:</p>
          <div className="flex flex-wrap gap-2">
            {email.attachments.map((att, i) => (
              <span key={i} className="px-2 py-1 bg-background text-xs rounded">
                {att.filename}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Hotel lookup panel ───────────────────────────────────────────────────────

function HotelLookupPanel({
  initialName,
  onSelect,
  onClose,
}: {
  initialName: string;
  onSelect: (match: HotelMatchResult) => void;
  onClose: () => void;
}) {
  const [searchName, setSearchName] = useState(initialName);
  const [searchAddress, setSearchAddress] = useState('');
  const [results, setResults] = useState<HotelMatchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    if (!searchName.trim()) return;
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const resp = await api.matchHotel({
        hotel_name: searchName.trim(),
        address: searchAddress.trim() || undefined,
      });
      setResults(resp.matches);
      if (resp.matches.length === 0) setError('No matches found. Try adjusting the hotel name or address.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search hotels');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2 border border-border rounded-lg p-3 bg-accent/20 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Find Hotel ID</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Hotel Name</label>
          <input
            type="text"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            placeholder="e.g. Marriott Downtown"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Address (optional)</label>
          <input
            type="text"
            value={searchAddress}
            onChange={(e) => setSearchAddress(e.target.value)}
            placeholder="e.g. 123 Main St, New York"
            className={inputCls}
          />
        </div>
      </div>
      <button
        onClick={handleSearch}
        disabled={!searchName.trim() || loading}
        className="w-full px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 transition-colors text-sm"
      >
        {loading ? 'Searching...' : 'Search'}
      </button>
      {error && <p className="text-sm text-yellow-400">{error}</p>}
      {results.length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          <p className="text-xs text-muted-foreground">{results.length} match{results.length !== 1 ? 'es' : ''}</p>
          {results.map((m, i) => (
            <button
              key={i}
              onClick={() => onSelect(m)}
              className="w-full text-left p-2 bg-accent/30 hover:bg-accent/50 rounded transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{m.name}</span>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded',
                    m.confidence_score >= 0.8
                      ? 'bg-green-500/20 text-green-400'
                      : m.confidence_score >= 0.5
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-red-500/20 text-red-400'
                  )}
                >
                  {Math.round(m.confidence_score * 100)}%
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {m.match_type} · {m.matched_fields.join(', ')}
              </div>
              <div className="text-xs text-muted-foreground font-mono mt-0.5">{m.hotel_id}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

// ─── Traveler ID resolver ────────────────────────────────────────────────────

function resolveTravelerId(
  id: string,
  travellers?: TravelerProfile[]
): { first_name: string; last_name: string; is_primary: boolean } {
  if (travellers && travellers.length > 0) {
    const match = travellers.find((t) => t.id === id);
    if (match) {
      return {
        first_name: match.first_name || '',
        last_name: match.last_name || '',
        is_primary: false,
      };
    }
  }
  // If no match found and it looks like a UUID, return empty names
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id);
  if (isUuid) {
    return { first_name: '', last_name: '', is_primary: false };
  }
  // Otherwise treat as a "First Last" name string
  const parts = id.split(' ');
  return {
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' ') || '',
    is_primary: false,
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface BookingEditInlineProps {
  booking: BookingView;
  travellers?: TravelerProfile[];
  onClose: () => void;
  onSave: () => void;
}

export function BookingEditInline({ booking, travellers, onClose, onSave }: BookingEditInlineProps) {
  const isHotel = booking.type?.toLowerCase() === 'hotel';
  const flightData = booking.flight;
  const hotelData = booking.hotel;

  const flightTabs = ['Details', 'Itinerary', 'Passengers'];
  const hotelTabs = ['Details', 'Stay', 'Guests'];
  const tabs = isHotel ? hotelTabs : flightTabs;

  const [activeTab, setActiveTab] = useState(tabs[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Details fields ──────────────────────────────────────────────────────
  const [confirmationCode, setConfirmationCode] = useState(
    getConfirmationCode(flightData, hotelData) || ''
  );
  const [bookingProvider, setBookingProvider] = useState(
    getBookingProvider(flightData, hotelData) || ''
  );
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | ''>('');

  const currentPrice = getBookingPrice(flightData, hotelData);
  const initCurrency = currentPrice.currency || 'USD';
  const [priceAmount, setPriceAmount] = useState(
    currentPrice.amount !== null ? fromMinorUnits(currentPrice.amount, initCurrency).toFixed(2) : ''
  );
  const [priceCurrency, setPriceCurrency] = useState(initCurrency);

  // ── Hotel stay fields ───────────────────────────────────────────────────
  const [hotelId, setHotelId] = useState(hotelData?.hotel_id || '');
  const [hotelName, setHotelName] = useState(hotelData?.hotel_name || '');
  const [checkInDate, setCheckInDate] = useState(hotelData?.check_in || hotelData?.check_in_date || '');
  const [checkOutDate, setCheckOutDate] = useState(hotelData?.check_out || hotelData?.check_out_date || '');
  const [roomType, setRoomType] = useState(hotelData?.room_type || '');
  const [showHotelLookup, setShowHotelLookup] = useState(false);

  // ── Hotel guests ────────────────────────────────────────────────────────
  const [guests, setGuests] = useState<BookingTravelerPatch[]>(() => {
    if (!hotelData?.guests || hotelData.guests.length === 0) return [];
    return hotelData.guests.map((g) => {
      // guests from the API are traveler profile IDs — resolve to names
      return resolveTravelerId(typeof g === 'string' ? g : '', travellers);
    });
  });

  // ── Flight itinerary ────────────────────────────────────────────────────
  type SegmentDraft = {
    origin: string;
    destination: string;
    departure: string;
    arrival: string;
    airline: string;
    flight_number: string;
    cabin: string;
  };
  type LegDraft = { direction: string; segments: SegmentDraft[] };

  const [legs, setLegs] = useState<LegDraft[]>(() => {
    if (!flightData?.legs || flightData.legs.length === 0) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return flightData.legs.map((leg: any) => {
      const dir = leg.direction || 'OUTBOUND';
      if (leg.segments?.length > 0) {
        return {
          direction: dir,
          segments: leg.segments.map((s: {
            origin?: string;
            destination?: string;
            departure?: string;
            arrival?: string;
            airline?: string;
            flight_number?: string;
            cabin?: string;
          }) => ({
            origin: s.origin || '',
            destination: s.destination || '',
            departure: (s.departure || '').slice(0, 16),
            arrival: (s.arrival || '').slice(0, 16),
            airline: s.airline || '',
            flight_number: s.flight_number || '',
            cabin: s.cabin || '',
          })),
        };
      }
      // Old schema
      return {
        direction: dir,
        segments: [
          {
            origin: leg.departure_airport || '',
            destination: leg.arrival_airport || '',
            departure: (leg.departure_time || '').slice(0, 16),
            arrival: (leg.arrival_time || '').slice(0, 16),
            airline: leg.airline || '',
            flight_number: leg.flight_number || '',
            cabin: leg.cabin_class || '',
          },
        ],
      };
    });
  });

  // ── Flight tickets/passengers ───────────────────────────────────────────
  const [tickets, setTickets] = useState<FlightTicketPatch[]>(() => {
    if (!flightData?.passengers || flightData.passengers.length === 0) return [];
    return flightData.passengers.map((name) => {
      // passengers might be IDs or names — resolve via travellers
      const resolved = resolveTravelerId(typeof name === 'string' ? name : '', travellers);
      return {
        traveler: resolved,
        loyalty_program: '',
        loyalty_number: '',
      };
    });
  });

  // ── Source email state (side panel) ─────────────────────────────────────
  const [showEmailPanel, setShowEmailPanel] = useState(false);
  const [email, setEmail] = useState<RawEmail | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailFetched, setEmailFetched] = useState(false);

  // Lazy-load email when panel is first opened
  useEffect(() => {
    if (!showEmailPanel || emailFetched) return;
    setEmailFetched(true);
    setEmailLoading(true);
    setEmailError(null);
    const bookingType = isHotel ? 'hotel' : 'flight';
    api
      .getEmailForBooking(bookingType, booking.id)
      .then((data) => setEmail(data))
      .catch((err) => {
        if (err?.status === 404) {
          setEmailError(null); // email will be null → shows "no email" message
        } else {
          setEmailError(err instanceof Error ? err.message : 'Failed to load email');
        }
      })
      .finally(() => setEmailLoading(false));
  }, [showEmailPanel, emailFetched, isHotel, booking.id]);

  // ── Auto-fetch hotel_id if missing ─────────────────────────────────────
  useEffect(() => {
    if (!isHotel || hotelId) return; // only fetch for hotels with missing hotel_id
    let cancelled = false;
    api
      .getHotelBookingDetail(booking.id)
      .then((detail) => {
        if (!cancelled && detail.hotel_id) {
          setHotelId(detail.hotel_id);
        }
      })
      .catch(() => {
        // Silently ignore — hotel_id stays empty, operator can use Lookup
      });
    return () => { cancelled = true; };
  }, [isHotel, booking.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save handler ────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    setError(null);

    try {
      if (isHotel) {
        const patch: HotelBookingPatchRequest = {};

        const origConf = getConfirmationCode(null, hotelData) || '';
        const origProvider = getBookingProvider(null, hotelData) || '';

        if (confirmationCode && confirmationCode !== origConf) patch.confirmation_code = confirmationCode;
        if (bookingProvider && bookingProvider !== origProvider) patch.booking_provider = bookingProvider;
        if (verificationStatus) patch.verification_status = verificationStatus;

        // Price — send display amount as-is; BE converts to minor units via Money.from_decimal()
        const newPrice = priceAmount ? parseFloat(priceAmount) : null;
        if (newPrice !== null && !isNaN(newPrice) && newPrice > 0) {
          patch.customer_price = { amount: newPrice, currency: priceCurrency };
        }

        // Stay changes
        const origHotelId = hotelData?.hotel_id || '';
        const origCheckIn = hotelData?.check_in || hotelData?.check_in_date || '';
        const origCheckOut = hotelData?.check_out || hotelData?.check_out_date || '';
        const origRoomType = hotelData?.room_type || '';
        const origHotelName = hotelData?.hotel_name || '';

        const stayChanged =
          hotelId !== origHotelId ||
          hotelName !== origHotelName ||
          checkInDate !== origCheckIn ||
          checkOutDate !== origCheckOut ||
          roomType !== origRoomType;

        if (stayChanged) {
          const stay: HotelBookingPatchRequest['stay'] = {};
          if (hotelId !== origHotelId || hotelName !== origHotelName) {
            stay.hotel = {};
            if (hotelId) stay.hotel.id = hotelId;
            if (hotelName) stay.hotel.name = hotelName;
          }
          if (checkInDate && checkInDate !== origCheckIn) stay.check_in = checkInDate;
          if (checkOutDate && checkOutDate !== origCheckOut) stay.check_out = checkOutDate;
          if (roomType && roomType !== origRoomType) stay.room_type_name = roomType;
          if (Object.keys(stay).length > 0) patch.stay = stay;
        }

        // Guests
        if (guests.length > 0) {
          patch.guests = guests;
        }

        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }

        await api.patchHotelBooking(booking.id, patch);
      } else {
        // Flight
        const patch: FlightBookingPatchRequest = {};

        const origConf = getConfirmationCode(flightData, null) || '';
        const origProvider = getBookingProvider(flightData, null) || '';

        if (confirmationCode && confirmationCode !== origConf) patch.confirmation_code = confirmationCode;
        if (bookingProvider && bookingProvider !== origProvider) patch.booking_provider = bookingProvider;
        if (verificationStatus) patch.verification_status = verificationStatus;

        // Price — send display amount as-is; BE converts to minor units via Money.from_decimal()
        const newPrice = priceAmount ? parseFloat(priceAmount) : null;
        if (newPrice !== null && !isNaN(newPrice) && newPrice > 0) {
          patch.customer_price = { amount: newPrice, currency: priceCurrency };
        }

        // Itinerary — send full legs array if anything changed
        if (legs.length > 0) {
          patch.itinerary = {
            legs: legs.map((leg) => ({
              segments: leg.segments.map((s) => ({
                origin: s.origin || undefined,
                destination: s.destination || undefined,
                departure_time: s.departure ? s.departure.slice(11, 16) + ':00' : undefined,
                departure_date: s.departure ? s.departure.slice(0, 10) : undefined,
                arrival_time: s.arrival ? s.arrival.slice(11, 16) + ':00' : undefined,
                arrival_date: s.arrival ? s.arrival.slice(0, 10) : undefined,
                operating_carrier: s.airline || undefined,
                flight_number: s.flight_number || undefined,
                cabin: s.cabin || undefined,
              })),
            })),
          };
        }

        // Tickets
        if (tickets.length > 0) {
          patch.tickets = tickets;
        }

        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }

        await api.patchFlightBooking(booking.id, patch);
      }

      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // ── Segment helpers ─────────────────────────────────────────────────────
  function updateSegment(legIdx: number, segIdx: number, field: keyof SegmentDraft, value: string) {
    setLegs((prev) => {
      const next = prev.map((l) => ({ ...l, segments: l.segments.map((s) => ({ ...s })) }));
      next[legIdx].segments[segIdx][field] = value;
      return next;
    });
  }

  function addSegment(legIdx: number) {
    setLegs((prev) => {
      const next = prev.map((l) => ({ ...l, segments: [...l.segments] }));
      next[legIdx].segments.push({ origin: '', destination: '', departure: '', arrival: '', airline: '', flight_number: '', cabin: '' });
      return next;
    });
  }

  function removeSegment(legIdx: number, segIdx: number) {
    setLegs((prev) => {
      const next = prev.map((l) => ({ ...l, segments: [...l.segments] }));
      next[legIdx].segments.splice(segIdx, 1);
      return next;
    });
  }

  function addLeg() {
    setLegs((prev) => [
      ...prev,
      { direction: 'RETURN', segments: [{ origin: '', destination: '', departure: '', arrival: '', airline: '', flight_number: '', cabin: '' }] },
    ]);
  }

  // ── Ticket helpers ──────────────────────────────────────────────────────
  function updateTicket(idx: number, updates: Partial<FlightTicketPatch>) {
    setTickets((prev) =>
      prev.map((t, i) => (i === idx ? { ...t, ...updates } : t))
    );
  }

  function updateTicketTraveler(idx: number, field: keyof BookingTravelerPatch, value: string | boolean) {
    setTickets((prev) =>
      prev.map((t, i) =>
        i === idx
          ? { ...t, traveler: { ...t.traveler, [field]: value } }
          : t
      )
    );
  }

  // ── Guest helpers ───────────────────────────────────────────────────────
  function updateGuest(idx: number, field: keyof BookingTravelerPatch, value: string | boolean) {
    setGuests((prev) =>
      prev.map((g, i) => (i === idx ? { ...g, [field]: value } : g))
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="bg-card border-2 border-primary/30 rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">
          Edit {isHotel ? 'Hotel' : 'Flight'} Booking
          <span className="text-xs text-muted-foreground ml-2 font-mono">{booking.id.slice(0, 8)}</span>
        </h4>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEmailPanel(!showEmailPanel)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-full transition-colors',
              showEmailPanel
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-accent/50 text-muted-foreground hover:bg-accent'
            )}
          >
            {showEmailPanel ? '✉ Hide Email' : '✉ Show Email'}
          </button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {/* Side-by-side layout: edit form + optional email panel */}
      <div className={cn('flex gap-4', showEmailPanel ? 'flex-row' : 'flex-col')}>

      {/* Scrollable edit content area */}
      <div className={cn('max-h-[500px] overflow-y-auto pr-1', showEmailPanel ? 'flex-1 min-w-0' : 'w-full')}>
        {/* ── DETAILS TAB ──────────────────────────────────────────────── */}
        {activeTab === 'Details' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Confirmation Code</label>
                <input type="text" value={confirmationCode} onChange={(e) => setConfirmationCode(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Booking Provider</label>
                <input type="text" value={bookingProvider} onChange={(e) => setBookingProvider(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Verification Status</label>
              <select
                value={verificationStatus}
                onChange={(e) => setVerificationStatus(e.target.value as VerificationStatus | '')}
                className={inputCls}
              >
                <option value="">— No change —</option>
                <option value="UNVERIFIED">UNVERIFIED</option>
                <option value="VERIFIED">VERIFIED</option>
                <option value="REVIEW_PENDING">REVIEW_PENDING</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={priceAmount}
                  onChange={(e) => setPriceAmount(e.target.value)}
                  placeholder="0.00"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Currency</label>
                <select value={priceCurrency} onChange={(e) => setPriceCurrency(e.target.value)} className={inputCls}>
                  {['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {currentPrice.amount !== null && (
              <p className="text-xs text-muted-foreground">
                Current: {formatMoney(currentPrice.amount, currentPrice.currency)}
              </p>
            )}
          </div>
        )}

        {/* ── ITINERARY TAB (flights) ──────────────────────────────────── */}
        {activeTab === 'Itinerary' && !isHotel && (
          <div className="space-y-4">
            {legs.map((leg, li) => (
              <div key={li} className="border border-border rounded p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">{leg.direction} Leg</span>
                  <span className="text-xs text-muted-foreground">{leg.segments.length} segment{leg.segments.length !== 1 ? 's' : ''}</span>
                </div>

                {leg.segments.map((seg, si) => (
                  <div key={si} className="bg-accent/20 rounded p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Segment {si + 1}</span>
                      {leg.segments.length > 1 && (
                        <button onClick={() => removeSegment(li, si)} className="text-xs text-red-400 hover:underline">Remove</button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className={labelCls}>Origin</label>
                        <input
                          type="text"
                          value={seg.origin}
                          onChange={(e) => updateSegment(li, si, 'origin', e.target.value.toUpperCase())}
                          maxLength={3}
                          placeholder="JFK"
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Destination</label>
                        <input
                          type="text"
                          value={seg.destination}
                          onChange={(e) => updateSegment(li, si, 'destination', e.target.value.toUpperCase())}
                          maxLength={3}
                          placeholder="LAX"
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Cabin</label>
                        <input
                          type="text"
                          value={seg.cabin}
                          onChange={(e) => updateSegment(li, si, 'cabin', e.target.value)}
                          placeholder="Economy"
                          className={inputCls}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={labelCls}>Departure</label>
                        <input
                          type="datetime-local"
                          value={seg.departure}
                          onChange={(e) => updateSegment(li, si, 'departure', e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Arrival</label>
                        <input
                          type="datetime-local"
                          value={seg.arrival}
                          onChange={(e) => updateSegment(li, si, 'arrival', e.target.value)}
                          className={inputCls}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={labelCls}>Airline</label>
                        <input
                          type="text"
                          value={seg.airline}
                          onChange={(e) => updateSegment(li, si, 'airline', e.target.value.toUpperCase())}
                          placeholder="AA"
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Flight #</label>
                        <input
                          type="text"
                          value={seg.flight_number}
                          onChange={(e) => updateSegment(li, si, 'flight_number', e.target.value)}
                          placeholder="AA123"
                          className={inputCls}
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => addSegment(li)}
                  className="text-xs text-primary hover:underline"
                >
                  + Add Segment
                </button>
              </div>
            ))}

            <button
              onClick={addLeg}
              className="w-full py-2 text-sm text-primary border border-dashed border-primary/30 rounded hover:bg-primary/5 transition-colors"
            >
              + Add Leg
            </button>
          </div>
        )}

        {/* ── STAY TAB (hotels) ────────────────────────────────────────── */}
        {activeTab === 'Stay' && isHotel && (
          <div className="space-y-4">
            <div>
              <label className={labelCls}>
                Hotel ID <span className="text-xs text-yellow-400">(required for repricing — use Lookup to find)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={hotelId}
                  onChange={(e) => setHotelId(e.target.value)}
                  placeholder="Content service hotel ID"
                  className={cn(inputCls, 'flex-1 font-mono')}
                />
                <button
                  type="button"
                  onClick={() => setShowHotelLookup(!showHotelLookup)}
                  className="px-3 py-2 text-sm bg-accent hover:bg-accent/80 rounded transition-colors whitespace-nowrap"
                >
                  {showHotelLookup ? 'Close' : 'Lookup'}
                </button>
              </div>

              {showHotelLookup && (
                <HotelLookupPanel
                  initialName={hotelName}
                  onSelect={(m) => {
                    setHotelId(m.hotel_id);
                    setHotelName(m.name);
                    setShowHotelLookup(false);
                  }}
                  onClose={() => setShowHotelLookup(false)}
                />
              )}
            </div>

            <div>
              <label className={labelCls}>Hotel Name</label>
              <input type="text" value={hotelName} onChange={(e) => setHotelName(e.target.value)} className={inputCls} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Check-in Date</label>
                <input type="date" value={checkInDate} onChange={(e) => setCheckInDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Check-out Date</label>
                <input type="date" value={checkOutDate} onChange={(e) => setCheckOutDate(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Room Type</label>
              <input type="text" value={roomType} onChange={(e) => setRoomType(e.target.value)} className={inputCls} />
            </div>
          </div>
        )}

        {/* ── PASSENGERS TAB (flights) ─────────────────────────────────── */}
        {activeTab === 'Passengers' && !isHotel && (
          <div className="space-y-3">
            {tickets.length === 0 && (
              <p className="text-sm text-muted-foreground">No passengers on this booking.</p>
            )}
            {tickets.map((ticket, i) => (
              <div key={i} className="border border-border rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Passenger {i + 1}</span>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={ticket.traveler.is_primary || false}
                        onChange={(e) => updateTicketTraveler(i, 'is_primary', e.target.checked)}
                        className="rounded"
                      />
                      Primary
                    </label>
                    {tickets.length > 1 && (
                      <button
                        onClick={() => setTickets((prev) => prev.filter((_, j) => j !== i))}
                        className="text-xs text-red-400 hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>First Name</label>
                    <input
                      type="text"
                      value={ticket.traveler.first_name || ''}
                      onChange={(e) => updateTicketTraveler(i, 'first_name', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Last Name</label>
                    <input
                      type="text"
                      value={ticket.traveler.last_name || ''}
                      onChange={(e) => updateTicketTraveler(i, 'last_name', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Loyalty Program</label>
                    <input
                      type="text"
                      value={ticket.loyalty_program || ''}
                      onChange={(e) => updateTicket(i, { loyalty_program: e.target.value })}
                      placeholder="e.g. AAdvantage"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Loyalty Number</label>
                    <input
                      type="text"
                      value={ticket.loyalty_number || ''}
                      onChange={(e) => updateTicket(i, { loyalty_number: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={() =>
                setTickets((prev) => [
                  ...prev,
                  { traveler: { first_name: '', last_name: '', is_primary: false }, loyalty_program: '', loyalty_number: '' },
                ])
              }
              className="w-full py-2 text-sm text-primary border border-dashed border-primary/30 rounded hover:bg-primary/5 transition-colors"
            >
              + Add Passenger
            </button>
          </div>
        )}

        {/* ── GUESTS TAB (hotels) ──────────────────────────────────────── */}
        {activeTab === 'Guests' && isHotel && (
          <div className="space-y-3">
            {guests.length === 0 && (
              <p className="text-sm text-muted-foreground">No guests on this booking.</p>
            )}
            {guests.map((guest, i) => (
              <div key={i} className="border border-border rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Guest {i + 1}</span>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={guest.is_primary || false}
                        onChange={(e) => updateGuest(i, 'is_primary', e.target.checked)}
                        className="rounded"
                      />
                      Primary
                    </label>
                    {guests.length > 1 && (
                      <button
                        onClick={() => setGuests((prev) => prev.filter((_, j) => j !== i))}
                        className="text-xs text-red-400 hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>First Name</label>
                    <input
                      type="text"
                      value={guest.first_name || ''}
                      onChange={(e) => updateGuest(i, 'first_name', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Last Name</label>
                    <input
                      type="text"
                      value={guest.last_name || ''}
                      onChange={(e) => updateGuest(i, 'last_name', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={() =>
                setGuests((prev) => [...prev, { first_name: '', last_name: '', is_primary: false }])
              }
              className="w-full py-2 text-sm text-primary border border-dashed border-primary/30 rounded hover:bg-primary/5 transition-colors"
            >
              + Add Guest
            </button>
          </div>
        )}

      </div>

      {/* ── Email side panel ───────────────────────────────────────────── */}
      {showEmailPanel && (
        <div className="w-[400px] min-w-[300px] max-h-[500px] overflow-y-auto border-l border-border pl-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Source Email</span>
            <button
              onClick={() => setShowEmailPanel(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <InlineEmailViewer email={email} loading={emailLoading} error={emailError} />
        </div>
      )}

      </div> {/* end side-by-side flex container */}

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      {error && <div className="text-red-400 text-sm">{error}</div>}

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
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
  );
}
