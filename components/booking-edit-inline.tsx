'use client';

import { useState, useEffect } from 'react';
import { cn, fromMinorUnits } from '@/lib/utils';
import {
  BookingView,
  FlightBookingView,
  HotelBookingView,
  FlightBookingPatchRequest,
  HotelBookingPatchRequest,
  HotelPatchData,
  RoomTypePatchData,
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
  'w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary text-sm transition-all';
const labelCls = 'block text-xs font-medium text-muted-foreground mb-1';
const sectionCls = 'border border-border/50 rounded-xl p-4 space-y-3';

// ─── Collapsible Section ──────────────────────────────────────────────────────

function Section({
  title,
  icon,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={sectionCls}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full group"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <span className="text-sm font-semibold">{title}</span>
          {badge && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-primary/15 text-primary">
              {badge}
            </span>
          )}
        </div>
        <svg
          className={cn(
            'w-4 h-4 text-muted-foreground transition-transform duration-200',
            open ? 'rotate-180' : ''
          )}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="space-y-3 pt-1">{children}</div>}
    </div>
  );
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full py-1 group"
    >
      <div className="flex flex-col items-start">
        <span className="text-sm">{label}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </div>
      <div
        className={cn(
          'relative w-9 h-5 rounded-full transition-colors duration-200',
          checked ? 'bg-primary' : 'bg-border'
        )}
      >
        <div
          className={cn(
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
            checked ? 'translate-x-4' : 'translate-x-0'
          )}
        />
      </div>
    </button>
  );
}

// ─── Number Stepper ───────────────────────────────────────────────────────────

function NumberStepper({
  value,
  onChange,
  label,
  min = 0,
  max = 99,
}: {
  value: number;
  onChange: (val: number) => void;
  label: string;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="w-7 h-7 flex items-center justify-center rounded-lg bg-accent/50 hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-medium"
        >
          −
        </button>
        <span className="w-8 text-center text-sm font-semibold tabular-nums">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="w-7 h-7 flex items-center justify-center rounded-lg bg-accent/50 hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-medium"
        >
          +
        </button>
      </div>
    </div>
  );
}

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
    <div className="flex gap-1 flex-wrap">
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

// ─── Inline Email Viewer ──────────────────────────────────────────────────────

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
    return <div className="text-xs text-muted-foreground py-2">Loading source email...</div>;
  if (error) return <div className="text-xs text-red-400 py-2">{error}</div>;
  if (!email)
    return (
      <div className="text-xs text-muted-foreground py-2">
        No source email found for this booking.
      </div>
    );

  return (
    <div className="space-y-2 text-xs">
      <div className="space-y-1 text-muted-foreground">
        {email.from_address && (
          <div>
            <span className="font-medium text-foreground">From:</span> {email.from_address}
          </div>
        )}
        {email.to_address && (
          <div>
            <span className="font-medium text-foreground">To:</span> {email.to_address}
          </div>
        )}
        {email.subject && (
          <div>
            <span className="font-medium text-foreground">Subject:</span> {email.subject}
          </div>
        )}
      </div>

      {email.body_html && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-primary hover:underline mb-1"
          >
            {expanded ? '▾ Collapse email body' : '▸ Expand email body'}
          </button>
          {expanded && (
            <div
              className="bg-white text-black p-2 rounded text-xs max-h-[300px] overflow-y-auto"
              dangerouslySetInnerHTML={{ __html: email.body_html }}
            />
          )}
        </div>
      )}

      {email.attachments && email.attachments.length > 0 && (
        <div className="text-muted-foreground">
          {email.attachments.length} attachment{email.attachments.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

// ─── Hotel Lookup Panel ───────────────────────────────────────────────────────

function HotelLookupPanel({
  initialName,
  onSelect,
  onClose,
}: {
  initialName: string;
  onSelect: (match: HotelMatchResult) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialName);
  const [address, setAddress] = useState('');
  const [results, setResults] = useState<HotelMatchResult[]>([]);
  const [searching, setSearching] = useState(false);

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await api.matchHotel({ hotel_name: query, address: address || undefined });
      setResults(res.matches || []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="mt-2 border border-border rounded-xl p-3 space-y-2 bg-accent/20">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Hotel name"
          className={cn(inputCls, 'flex-1')}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Address (optional)"
          className={cn(inputCls, 'flex-1')}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSearch}
          disabled={searching}
          className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {searching ? 'Searching...' : 'Search'}
        </button>
        <button onClick={onClose} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
      </div>
      {results.length > 0 && (
        <div className="space-y-1 max-h-[200px] overflow-y-auto">
          {results.map((m, i) => (
            <button
              key={i}
              onClick={() => onSelect(m)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-accent/50 transition-colors text-xs"
            >
              <div className="font-medium">{m.name}</div>
              <div className="text-muted-foreground">
                Confidence: {m.confidence_score} · {m.match_type}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Traveler ID resolver ─────────────────────────────────────────────────────

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
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id);
  if (isUuid) {
    return { first_name: '', last_name: '', is_primary: false };
  }
  const parts = id.split(' ');
  return {
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' ') || '',
    is_primary: false,
  };
}

// ─── Meal Plan Options ────────────────────────────────────────────────────────

const MEAL_PLANS = [
  { value: '', label: '— None —' },
  { value: 'room_only', label: 'Room Only' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'half_board', label: 'Half Board' },
  { value: 'full_board', label: 'Full Board' },
  { value: 'all_inclusive', label: 'All Inclusive' },
];

// ─── Main Component ──────────────────────────────────────────────────────────

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
  const hotelTabs = ['Details', 'Stay', 'Hotel & Room', 'Guests'];
  const tabs = isHotel ? hotelTabs : flightTabs;

  const [activeTab, setActiveTab] = useState(tabs[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successFields, setSuccessFields] = useState<string[] | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(isHotel);

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

  // ── Hotel stay fields ─────────────────────────────────────────────────
  const [hotelId, setHotelId] = useState(hotelData?.hotel_id || '');
  const [hotelName, setHotelName] = useState(hotelData?.hotel_name || '');
  const [checkInDate, setCheckInDate] = useState(hotelData?.check_in || hotelData?.check_in_date || '');
  const [checkOutDate, setCheckOutDate] = useState(hotelData?.check_out || hotelData?.check_out_date || '');
  const [roomType, setRoomType] = useState(hotelData?.room_type || '');
  const [showHotelLookup, setShowHotelLookup] = useState(false);

  // ── Occupancy fields ───────────────────────────────────────────────────
  const [rooms, setRooms] = useState(1);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [childrenAges, setChildrenAges] = useState<number[]>([]);
  const [refundable, setRefundable] = useState(false);
  const [mealPlan, setMealPlan] = useState('');

  // ── Hotel property fields ──────────────────────────────────────────────
  const [hotelChain, setHotelChain] = useState('');
  const [hotelBrand, setHotelBrand] = useState('');
  const [hotelCity, setHotelCity] = useState('');
  const [hotelCountry, setHotelCountry] = useState('');
  const [hotelAddress, setHotelAddress] = useState('');
  const [hotelPostalCode, setHotelPostalCode] = useState('');
  const [hotelLat, setHotelLat] = useState('');
  const [hotelLng, setHotelLng] = useState('');
  const [hotelStarRating, setHotelStarRating] = useState('');
  const [hotelPhone, setHotelPhone] = useState('');
  const [hotelEmail, setHotelEmail] = useState('');

  // ── Room type fields ───────────────────────────────────────────────────
  const [rtName, setRtName] = useState('');
  const [rtBedType, setRtBedType] = useState('');
  const [rtBedCount, setRtBedCount] = useState('');
  const [rtMaxOccupancy, setRtMaxOccupancy] = useState('');
  const [rtMaxAdults, setRtMaxAdults] = useState('');
  const [rtMaxChildren, setRtMaxChildren] = useState('');
  const [rtSqft, setRtSqft] = useState('');
  const [rtSqm, setRtSqm] = useState('');
  const [rtView, setRtView] = useState('');
  const [rtSmoking, setRtSmoking] = useState(false);
  const [rtAccessible, setRtAccessible] = useState(false);

  // ── Hotel guests ──────────────────────────────────────────────────────
  // Initialize synchronously from trip view data (string[] names or UUIDs resolved via traveller profiles)
  const [guests, setGuests] = useState<BookingTravelerPatch[]>(() => {
    if (!hotelData?.guests || hotelData.guests.length === 0) return [];
    return hotelData.guests.map((g) => {
      const resolved = resolveTravelerId(typeof g === 'string' ? g : '', travellers);
      return { ...resolved, is_adult: true };
    });
  });

  // ── Fetch hotel booking data to enrich fields ──────────────────────────
  // NOTE: GET /bookings/hotel/{id} doesn't exist in the admin gateway.
  // Use the hotel-bookings list endpoint with search to find this booking.
  useEffect(() => {
    if (!isHotel) return;
    let cancelled = false;
    (async () => {
      try {
        // Try the list endpoint with booking ID as search query
        const listResult = await api.listHotelBookings({ q: booking.id, limit: 1 });
        const match = listResult?.bookings?.find((b) => b.id === booking.id);
        if (cancelled) return;

        if (match) {
          // Hydrate hotel property fields
          if (match.hotel_chain) setHotelChain(match.hotel_chain);
          if (match.city) setHotelCity(match.city);
          if (match.country) setHotelCountry(match.country);
          if (match.confirmation_code && !confirmationCode) setConfirmationCode(match.confirmation_code);
          if (match.booking_provider && !bookingProvider) setBookingProvider(match.booking_provider);
          if (match.room_type && !roomType) setRoomType(match.room_type);

          // Hydrate guests from the list item (has name, is_primary, citizenship)
          if (match.guests && match.guests.length > 0) {
            setGuests(match.guests.map((g) => {
              const nameParts = (g.name || '').trim().split(/\s+/);
              const firstName = nameParts[0] || '';
              const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
              return {
                first_name: firstName,
                last_name: lastName,
                is_primary: g.is_primary,
                citizenship: g.citizenship || undefined,
                is_adult: true,
              };
            }));
          }
        }
      } catch (e) {
        if (!cancelled) console.warn('Failed to fetch hotel booking data for edit form:', e);
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.id]);

  // ── Flight itinerary ──────────────────────────────────────────────────
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

  // ── Flight tickets/passengers ─────────────────────────────────────────
  const [tickets, setTickets] = useState<FlightTicketPatch[]>(() => {
    if (!flightData?.passengers || flightData.passengers.length === 0) return [];
    return flightData.passengers.map((name) => {
      const resolved = resolveTravelerId(typeof name === 'string' ? name : '', travellers);
      return {
        traveler: resolved,
        loyalty_program: '',
        loyalty_number: '',
      };
    });
  });

  // ── Source email state (side panel) ───────────────────────────────────
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
          setEmailError(null);
        } else {
          setEmailError(err instanceof Error ? err.message : 'Failed to load email');
        }
      })
      .finally(() => setEmailLoading(false));
  }, [showEmailPanel, emailFetched, isHotel, booking.id]);

  // ── Auto-fetch hotel_id if missing ────────────────────────────────────
  // Hotel ID is hydrated from the list endpoint fetch above — no separate call needed

  // ── Sync children ages array with children count ──────────────────────
  useEffect(() => {
    setChildrenAges((prev) => {
      if (children === 0) return [];
      if (prev.length === children) return prev;
      if (prev.length < children) return [...prev, ...Array(children - prev.length).fill(5)];
      return prev.slice(0, children);
    });
  }, [children]);

  // ── Save handler ──────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccessFields(null);

    try {
      if (isHotel) {
        const patch: HotelBookingPatchRequest = {};

        const origConf = getConfirmationCode(null, hotelData) || '';
        const origProvider = getBookingProvider(null, hotelData) || '';

        if (confirmationCode && confirmationCode !== origConf) patch.confirmation_code = confirmationCode;
        if (bookingProvider && bookingProvider !== origProvider) patch.booking_provider = bookingProvider;
        if (verificationStatus) patch.verification_status = verificationStatus;

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

        // Build stay patch
        const stay: HotelBookingPatchRequest['stay'] = {};

        // Hotel identity
        if (hotelId !== origHotelId || hotelName !== origHotelName) {
          const hotel: HotelPatchData = {};
          if (hotelId) hotel.id = hotelId;
          if (hotelName) hotel.name = hotelName;
          if (hotelChain) hotel.chain = hotelChain;
          if (hotelBrand) hotel.brand = hotelBrand;
          if (hotelCity) hotel.city = hotelCity;
          if (hotelCountry) hotel.country = hotelCountry;
          if (hotelAddress) hotel.address = hotelAddress;
          if (hotelPostalCode) hotel.postal_code = hotelPostalCode;
          if (hotelLat) hotel.latitude = parseFloat(hotelLat);
          if (hotelLng) hotel.longitude = parseFloat(hotelLng);
          if (hotelStarRating) hotel.star_rating = parseFloat(hotelStarRating);
          if (hotelPhone) hotel.phone = hotelPhone;
          if (hotelEmail) hotel.email = hotelEmail;
          if (Object.keys(hotel).length > 0) stay.hotel = hotel;
        } else {
          // Even if name/id didn't change, still send property updates
          const hotel: HotelPatchData = {};
          if (hotelChain) hotel.chain = hotelChain;
          if (hotelBrand) hotel.brand = hotelBrand;
          if (hotelCity) hotel.city = hotelCity;
          if (hotelCountry) hotel.country = hotelCountry;
          if (hotelAddress) hotel.address = hotelAddress;
          if (hotelPostalCode) hotel.postal_code = hotelPostalCode;
          if (hotelLat) hotel.latitude = parseFloat(hotelLat);
          if (hotelLng) hotel.longitude = parseFloat(hotelLng);
          if (hotelStarRating) hotel.star_rating = parseFloat(hotelStarRating);
          if (hotelPhone) hotel.phone = hotelPhone;
          if (hotelEmail) hotel.email = hotelEmail;
          if (Object.keys(hotel).length > 0) stay.hotel = hotel;
        }

        if (checkInDate && checkInDate !== origCheckIn) stay.check_in = checkInDate;
        if (checkOutDate && checkOutDate !== origCheckOut) stay.check_out = checkOutDate;
        if (roomType && roomType !== origRoomType) stay.room_type_name = roomType;

        // Occupancy
        stay.rooms = rooms;
        stay.adults = adults;
        if (children > 0) {
          stay.children = children;
          if (childrenAges.length > 0) stay.children_ages = childrenAges;
        }
        stay.refundable = refundable;
        if (mealPlan) stay.meal_plan = mealPlan;

        // Room type structured data
        const rt: RoomTypePatchData = {};
        if (rtName) rt.name = rtName;
        if (rtBedType) rt.bed_type = rtBedType;
        if (rtBedCount) rt.bed_count = parseInt(rtBedCount);
        if (rtMaxOccupancy) rt.max_occupancy = parseInt(rtMaxOccupancy);
        if (rtMaxAdults) rt.max_adults = parseInt(rtMaxAdults);
        if (rtMaxChildren) rt.max_children = parseInt(rtMaxChildren);
        if (rtSqft) rt.sqft = parseInt(rtSqft);
        if (rtSqm) rt.sqm = parseInt(rtSqm);
        if (rtView) rt.view = rtView;
        rt.smoking = rtSmoking;
        rt.accessible = rtAccessible;
        if (Object.keys(rt).length > 0) stay.room_type = rt;

        if (Object.keys(stay).length > 0) patch.stay = stay;

        // Guests – sanitize before sending to match backend BookingTraveler schema
        // (extra="forbid", date_of_birth: date | None — empty strings crash Pydantic)
        if (guests.length > 0) {
          const ALLOWED_GUEST_FIELDS = [
            'first_name', 'middle_name', 'last_name', 'date_of_birth',
            'age', 'is_adult', 'is_primary', 'citizenship', 'traveller_profile_id',
          ] as const;
          patch.guests = guests.map((g) => {
            const clean: Record<string, unknown> = {};
            for (const key of ALLOWED_GUEST_FIELDS) {
              const val = (g as Record<string, unknown>)[key];
              if (val === undefined) continue;
              // Convert empty strings to null for nullable fields
              if (val === '' && (key === 'date_of_birth' || key === 'middle_name' || key === 'citizenship' || key === 'traveller_profile_id')) {
                clean[key] = null;
              } else {
                clean[key] = val;
              }
            }
            return clean as BookingTravelerPatch;
          });
        }

        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }

        const res = await api.patchHotelBooking(booking.id, patch);
        setSuccessFields(res.updated_fields);
        setTimeout(() => {
          onSave();
          onClose();
        }, 800);
      } else {
        // Flight
        const patch: FlightBookingPatchRequest = {};

        const origConf = getConfirmationCode(flightData, null) || '';
        const origProvider = getBookingProvider(flightData, null) || '';

        if (confirmationCode && confirmationCode !== origConf) patch.confirmation_code = confirmationCode;
        if (bookingProvider && bookingProvider !== origProvider) patch.booking_provider = bookingProvider;
        if (verificationStatus) patch.verification_status = verificationStatus;

        const newPrice = priceAmount ? parseFloat(priceAmount) : null;
        if (newPrice !== null && !isNaN(newPrice) && newPrice > 0) {
          patch.customer_price = { amount: newPrice, currency: priceCurrency };
        }

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

        if (tickets.length > 0) {
          patch.tickets = tickets;
        }

        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }

        await api.patchFlightBooking(booking.id, patch);
        onSave();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // ── Segment helpers ───────────────────────────────────────────────────
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

  // ── Ticket helpers ────────────────────────────────────────────────────
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

  // ── Guest helpers ─────────────────────────────────────────────────────
  function updateGuest(idx: number, field: keyof BookingTravelerPatch, value: string | boolean) {
    setGuests((prev) =>
      prev.map((g, i) => (i === idx ? { ...g, [field]: value } : g))
    );
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="bg-card border-2 border-primary/30 rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center text-base',
            isHotel ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'
          )}>
            {isHotel ? '🏨' : '✈️'}
          </div>
          <div>
            <h4 className="text-sm font-semibold">
              Edit {isHotel ? 'Hotel' : 'Flight'} Booking
            </h4>
            <button
              onClick={() => navigator.clipboard.writeText(booking.id)}
              title="Click to copy"
              className="text-xs text-muted-foreground font-mono hover:text-foreground transition-colors"
            >{booking.id}</button>
          </div>
        </div>
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
            {showEmailPanel ? '✉ Hide Email' : '✉ Source Email'}
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
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
      <div className={cn('max-h-[600px] overflow-y-auto pr-1 space-y-4', showEmailPanel ? 'flex-1 min-w-0' : 'w-full')}>

        {loadingDetail && (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading booking details...
          </div>
        )}

        {/* ── DETAILS TAB ──────────────────────────────────────────────── */}
        {activeTab === 'Details' && (
          <div className="space-y-4">
            <Section title="Booking Info" icon="📋" defaultOpen={true}>
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
            </Section>

            <Section title="Pricing" icon="💰" defaultOpen={true}>
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
                    {['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'MXN', 'BRL'].map((c) => (
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
            </Section>
          </div>
        )}

        {/* ── ITINERARY TAB (flights) ────────────────────────────────── */}
        {activeTab === 'Itinerary' && !isHotel && (
          <div className="space-y-4">
            {legs.map((leg, li) => (
              <div key={li} className="border border-border rounded-xl p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">{leg.direction} Leg</span>
                  <span className="text-xs text-muted-foreground">{leg.segments.length} segment{leg.segments.length !== 1 ? 's' : ''}</span>
                </div>

                {leg.segments.map((seg, si) => (
                  <div key={si} className="bg-accent/20 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Segment {si + 1}</span>
                      {leg.segments.length > 1 && (
                        <button onClick={() => removeSegment(li, si)} className="text-xs text-red-400 hover:underline">Remove</button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className={labelCls}>Origin</label>
                        <input type="text" value={seg.origin} onChange={(e) => updateSegment(li, si, 'origin', e.target.value.toUpperCase())} maxLength={3} placeholder="JFK" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Destination</label>
                        <input type="text" value={seg.destination} onChange={(e) => updateSegment(li, si, 'destination', e.target.value.toUpperCase())} maxLength={3} placeholder="LAX" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Cabin</label>
                        <input type="text" value={seg.cabin} onChange={(e) => updateSegment(li, si, 'cabin', e.target.value)} placeholder="Economy" className={inputCls} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={labelCls}>Departure</label>
                        <input type="datetime-local" value={seg.departure} onChange={(e) => updateSegment(li, si, 'departure', e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Arrival</label>
                        <input type="datetime-local" value={seg.arrival} onChange={(e) => updateSegment(li, si, 'arrival', e.target.value)} className={inputCls} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={labelCls}>Airline</label>
                        <input type="text" value={seg.airline} onChange={(e) => updateSegment(li, si, 'airline', e.target.value.toUpperCase())} placeholder="AA" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Flight #</label>
                        <input type="text" value={seg.flight_number} onChange={(e) => updateSegment(li, si, 'flight_number', e.target.value)} placeholder="AA123" className={inputCls} />
                      </div>
                    </div>
                  </div>
                ))}

                <button onClick={() => addSegment(li)} className="text-xs text-primary hover:underline">
                  + Add Segment
                </button>
              </div>
            ))}

            <button
              onClick={addLeg}
              className="w-full py-2 text-sm text-primary border border-dashed border-primary/30 rounded-lg hover:bg-primary/5 transition-colors"
            >
              + Add Leg
            </button>
          </div>
        )}

        {/* ── STAY TAB (hotels) ──────────────────────────────────────── */}
        {activeTab === 'Stay' && isHotel && (
          <div className="space-y-4">
            <Section title="Hotel Identity" icon="🏨" badge="required for repricing" defaultOpen={true}>
              <div>
                <label className={labelCls}>Hotel ID</label>
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
                    className="px-3 py-2 text-xs font-medium bg-accent hover:bg-accent/80 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {showHotelLookup ? 'Close' : '🔍 Lookup'}
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
            </Section>

            <Section title="Dates & Room" icon="📅" defaultOpen={true}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Check-in</label>
                  <input type="date" value={checkInDate} onChange={(e) => setCheckInDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Check-out</label>
                  <input type="date" value={checkOutDate} onChange={(e) => setCheckOutDate(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Room Type</label>
                <input type="text" value={roomType} onChange={(e) => setRoomType(e.target.value)} placeholder="e.g. Deluxe King" className={inputCls} />
              </div>
            </Section>

            <Section title="Occupancy" icon="👥" defaultOpen={true}>
              <NumberStepper label="Rooms" value={rooms} onChange={setRooms} min={1} max={10} />
              <div className="border-t border-border/30 pt-2">
                <NumberStepper label="Adults" value={adults} onChange={setAdults} min={1} max={20} />
                <NumberStepper label="Children" value={children} onChange={setChildren} min={0} max={10} />
              </div>
              {children > 0 && (
                <div className="bg-accent/20 rounded-lg p-3 space-y-2">
                  <label className={labelCls}>Children Ages</label>
                  <div className="flex gap-2 flex-wrap">
                    {childrenAges.map((age, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">Child {i + 1}:</span>
                        <input
                          type="number"
                          min={0}
                          max={17}
                          value={age}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setChildrenAges((prev) => prev.map((a, j) => j === i ? val : a));
                          }}
                          className="w-14 px-2 py-1 bg-background border border-border rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            <Section title="Policy" icon="📜" defaultOpen={false}>
              <Toggle label="Refundable" checked={refundable} onChange={setRefundable} description="Whether this booking can be refunded" />
              <div>
                <label className={labelCls}>Meal Plan</label>
                <select value={mealPlan} onChange={(e) => setMealPlan(e.target.value)} className={inputCls}>
                  {MEAL_PLANS.map((mp) => (
                    <option key={mp.value} value={mp.value}>{mp.label}</option>
                  ))}
                </select>
              </div>
            </Section>
          </div>
        )}

        {/* ── HOTEL & ROOM TAB (hotels) ──────────────────────────────── */}
        {activeTab === 'Hotel & Room' && isHotel && (
          <div className="space-y-4">
            <Section title="Hotel Property" icon="🏢" defaultOpen={true}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Chain</label>
                  <input type="text" value={hotelChain} onChange={(e) => setHotelChain(e.target.value)} placeholder="e.g. Marriott" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Brand</label>
                  <input type="text" value={hotelBrand} onChange={(e) => setHotelBrand(e.target.value)} placeholder="e.g. Courtyard" className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Star Rating</label>
                <div className="flex items-center gap-2">
                  {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setHotelStarRating(r.toString())}
                      className={cn(
                        'px-2 py-1 text-xs rounded-lg transition-colors',
                        parseFloat(hotelStarRating) === r
                          ? 'bg-yellow-500/20 text-yellow-400 font-semibold ring-1 ring-yellow-500/40'
                          : 'bg-accent/50 text-muted-foreground hover:bg-accent'
                      )}
                    >
                      {r}★
                    </button>
                  ))}
                  {hotelStarRating && (
                    <button
                      type="button"
                      onClick={() => setHotelStarRating('')}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Phone</label>
                  <input type="tel" value={hotelPhone} onChange={(e) => setHotelPhone(e.target.value)} placeholder="+1 (555) 123-4567" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Email</label>
                  <input type="email" value={hotelEmail} onChange={(e) => setHotelEmail(e.target.value)} placeholder="front.desk@hotel.com" className={inputCls} />
                </div>
              </div>
            </Section>

            <Section title="Location" icon="📍" defaultOpen={false}>
              <div>
                <label className={labelCls}>Address</label>
                <input type="text" value={hotelAddress} onChange={(e) => setHotelAddress(e.target.value)} placeholder="123 Main Street" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>City</label>
                  <input type="text" value={hotelCity} onChange={(e) => setHotelCity(e.target.value)} placeholder="New York" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Country</label>
                  <input type="text" value={hotelCountry} onChange={(e) => setHotelCountry(e.target.value)} placeholder="US" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Postal Code</label>
                  <input type="text" value={hotelPostalCode} onChange={(e) => setHotelPostalCode(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Latitude</label>
                  <input type="text" value={hotelLat} onChange={(e) => setHotelLat(e.target.value)} placeholder="40.7128" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Longitude</label>
                  <input type="text" value={hotelLng} onChange={(e) => setHotelLng(e.target.value)} placeholder="-74.0060" className={inputCls} />
                </div>
              </div>
            </Section>

            <Section title="Room Details" icon="🛏️" defaultOpen={true}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Room Name</label>
                  <input type="text" value={rtName} onChange={(e) => setRtName(e.target.value)} placeholder="Deluxe King Room" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Bed Type</label>
                  <input type="text" value={rtBedType} onChange={(e) => setRtBedType(e.target.value)} placeholder="King, 2 Queens, etc." className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Bed Count</label>
                  <input type="number" min={0} value={rtBedCount} onChange={(e) => setRtBedCount(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Max Occupancy</label>
                  <input type="number" min={0} value={rtMaxOccupancy} onChange={(e) => setRtMaxOccupancy(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>View</label>
                  <input type="text" value={rtView} onChange={(e) => setRtView(e.target.value)} placeholder="Ocean, City..." className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Max Adults</label>
                  <input type="number" min={0} value={rtMaxAdults} onChange={(e) => setRtMaxAdults(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Max Children</label>
                  <input type="number" min={0} value={rtMaxChildren} onChange={(e) => setRtMaxChildren(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Size (sqft)</label>
                  <input type="number" min={0} value={rtSqft} onChange={(e) => setRtSqft(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Size (sqm)</label>
                  <input type="number" min={0} value={rtSqm} onChange={(e) => setRtSqm(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="border-t border-border/30 pt-2 space-y-1">
                <Toggle label="Smoking" checked={rtSmoking} onChange={setRtSmoking} />
                <Toggle label="Accessible" checked={rtAccessible} onChange={setRtAccessible} description="ADA/wheelchair accessible room" />
              </div>
            </Section>
          </div>
        )}

        {/* ── PASSENGERS TAB (flights) ───────────────────────────────── */}
        {activeTab === 'Passengers' && !isHotel && (
          <div className="space-y-3">
            {tickets.length === 0 && (
              <p className="text-sm text-muted-foreground">No passengers on this booking.</p>
            )}
            {tickets.map((ticket, i) => (
              <div key={i} className="border border-border rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Passenger {i + 1}</span>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs cursor-pointer">
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
                    <input type="text" value={ticket.traveler.first_name || ''} onChange={(e) => updateTicketTraveler(i, 'first_name', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Last Name</label>
                    <input type="text" value={ticket.traveler.last_name || ''} onChange={(e) => updateTicketTraveler(i, 'last_name', e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Loyalty Program</label>
                    <input type="text" value={ticket.loyalty_program || ''} onChange={(e) => updateTicket(i, { loyalty_program: e.target.value })} placeholder="e.g. AAdvantage" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Loyalty Number</label>
                    <input type="text" value={ticket.loyalty_number || ''} onChange={(e) => updateTicket(i, { loyalty_number: e.target.value })} className={inputCls} />
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
              className="w-full py-2 text-sm text-primary border border-dashed border-primary/30 rounded-lg hover:bg-primary/5 transition-colors"
            >
              + Add Passenger
            </button>
          </div>
        )}

        {/* ── GUESTS TAB (hotels) ────────────────────────────────────── */}
        {activeTab === 'Guests' && isHotel && (
          <div className="space-y-3">
            {guests.length === 0 && (
              <p className="text-sm text-muted-foreground">No guests on this booking.</p>
            )}
            {guests.map((guest, i) => (
              <div key={i} className="border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-accent/80 flex items-center justify-center text-xs font-semibold">
                      {i + 1}
                    </div>
                    <span className="text-sm font-medium">
                      {guest.first_name || guest.last_name
                        ? `${guest.first_name || ''} ${guest.last_name || ''}`.trim()
                        : `Guest ${i + 1}`
                      }
                    </span>
                    {guest.is_primary && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-primary/15 text-primary">
                        Primary
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
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

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className={labelCls}>First Name</label>
                    <input type="text" value={guest.first_name || ''} onChange={(e) => updateGuest(i, 'first_name', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Middle Name</label>
                    <input type="text" value={guest.middle_name || ''} onChange={(e) => updateGuest(i, 'middle_name', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Last Name</label>
                    <input type="text" value={guest.last_name || ''} onChange={(e) => updateGuest(i, 'last_name', e.target.value)} className={inputCls} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Date of Birth</label>
                    <input
                      type="date"
                      value={guest.date_of_birth || ''}
                      onChange={(e) => updateGuest(i, 'date_of_birth', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Citizenship</label>
                    <input
                      type="text"
                      value={guest.citizenship || ''}
                      onChange={(e) => updateGuest(i, 'citizenship', e.target.value.toUpperCase())}
                      maxLength={2}
                      placeholder="US"
                      className={inputCls}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4 pt-1 border-t border-border/30">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={guest.is_primary || false}
                      onChange={(e) => updateGuest(i, 'is_primary', e.target.checked)}
                      className="rounded"
                    />
                    Primary Guest
                  </label>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={guest.is_adult !== false}
                      onChange={(e) => updateGuest(i, 'is_adult', e.target.checked)}
                      className="rounded"
                    />
                    Adult
                  </label>
                </div>
              </div>
            ))}
            <button
              onClick={() =>
                setGuests((prev) => [...prev, { first_name: '', last_name: '', is_primary: false, is_adult: true }])
              }
              className="w-full py-2.5 text-sm text-primary border border-dashed border-primary/30 rounded-xl hover:bg-primary/5 transition-colors"
            >
              + Add Guest
            </button>
          </div>
        )}

      </div>

      {/* ── Email side panel ─────────────────────────────────────────── */}
      {showEmailPanel && (
        <div className="w-[400px] min-w-[300px] max-h-[600px] overflow-y-auto border-l border-border pl-4">
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

      {/* ── Footer ───────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span className="text-red-400 text-sm">{error}</span>
        </div>
      )}

      {successFields && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-green-400 text-sm">
            Saved! Updated: {successFields.join(', ') || 'booking'}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-border">
        <span className="text-xs text-muted-foreground">
          {isHotel ? '4 tabs' : '3 tabs'} · Only changed fields are sent
        </span>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !!successFields}
            className="px-5 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving...
              </span>
            ) : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
