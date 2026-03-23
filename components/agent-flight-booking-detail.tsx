'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Loader2,
  Plane,
  Undo2,
  User,
  XCircle,
} from 'lucide-react';
import {
  AgentFlightBookingDetail,
  AgentFlightBookingSegment,
  AgentFlightBookingTraveler,
  api,
  FlightBookingPatchRequest,
  MemberContext,
  PassengerSummary,
  PaymentRecord,
  Task,
  ThoughtView,
  TravelerProfile,
  WatchView,
} from '@/lib/api';
import { cn } from '@/lib/utils';

/* ─── Constants ─── */

const PLACEHOLDER_CONFIRMATION_CODES = new Set(['PENDING']);

const AIRLINE_NAMES: Record<string, string> = {
  AA: 'American Airlines',
  DL: 'Delta',
  UA: 'United',
  WN: 'Southwest',
  F9: 'Frontier',
  NK: 'Spirit',
  B6: 'JetBlue',
  AS: 'Alaska',
  MX: 'Breeze',
  G4: 'Allegiant',
  SY: 'Sun Country',
  HA: 'Hawaiian',
  BA: 'British Airways',
  EK: 'Emirates',
  QR: 'Qatar Airways',
  TK: 'Turkish Airlines',
  LH: 'Lufthansa',
  AF: 'Air France',
  KL: 'KLM',
  AC: 'Air Canada',
  AM: 'Aeromexico',
  VS: 'Virgin Atlantic',
  IB: 'Iberia',
  AY: 'Finnair',
  SK: 'SAS',
  LX: 'Swiss',
  OS: 'Austrian',
  SQ: 'Singapore Airlines',
  CX: 'Cathay Pacific',
  QF: 'Qantas',
  NZ: 'Air New Zealand',
  JL: 'Japan Airlines',
  NH: 'ANA',
  KE: 'Korean Air',
  OZ: 'Asiana',
  CI: 'China Airlines',
  BR: 'EVA Air',
  AI: 'Air India',
  ET: 'Ethiopian',
  SA: 'South African',
  LA: 'LATAM',
  AV: 'Avianca',
  CM: 'Copa',
  WS: 'WestJet',
  TS: 'Air Transat',
  FI: 'Icelandair',
  TP: 'TAP Portugal',
  EI: 'Aer Lingus',
};

/* ─── Helpers ─── */

function resolveAirlineName(code: string | null | undefined, name: string | null | undefined): string {
  // If name is provided and isn't just an IATA code, use it
  if (name && name.trim()) {
    const trimmed = name.trim();
    const upperName = trimmed.toUpperCase();
    // If the "name" is actually just an IATA code (2-3 uppercase letters), resolve it
    if (trimmed.length <= 3 && AIRLINE_NAMES[upperName]) return AIRLINE_NAMES[upperName];
    if (trimmed.length > 3) return trimmed;
  }
  if (!code) return 'Carrier unavailable';
  const upper = code.trim().toUpperCase();
  return AIRLINE_NAMES[upper] || code;
}

function formatAirlineWithCode(code: string | null | undefined, name: string | null | undefined): string {
  const resolved = resolveAirlineName(code, name);
  const upper = code?.trim().toUpperCase() || '';
  if (upper && resolved !== upper && !resolved.includes(`(${upper})`)) {
    return `${resolved} (${upper})`;
  }
  return resolved;
}

function formatFlightTime(date: string | null | undefined, time: string | null | undefined): string {
  if (!date && !time) return '—';

  let datePart = '';
  if (date) {
    const parsed = new Date(date + 'T00:00:00');
    if (!Number.isNaN(parsed.getTime())) {
      datePart = parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } else {
      datePart = date;
    }
  }

  let timePart = '';
  let ampmPart = '';
  if (time) {
    timePart = time;
    // Parse HH:MM to get AM/PM
    const match = time.match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      const h = parseInt(match[1], 10);
      const m = match[2];
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      ampmPart = `${h12}:${m} ${ampm}`;
    }
  }

  const parts = [datePart, timePart].filter(Boolean).join(' ');
  if (ampmPart) return `${parts} (${ampmPart})`;
  return parts || '—';
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const datePart = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, '0');
  const mil = `${h.toString().padStart(2, '0')}:${m}`;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${datePart} ${mil} (${h12}:${m} ${ampm})`;
}

function formatDateTimeShort(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDuration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return '—';
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return '—';
  const diffMs = endDate.getTime() - startDate.getTime();
  if (diffMs < 0) return '—';

  const totalMinutes = Math.round(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    days > 0 ? `${days}d` : null,
    hours > 0 ? `${hours}h` : null,
    minutes > 0 ? `${minutes}m` : null,
  ].filter(Boolean);

  return parts.join(' ') || '0m';
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

function formatMoney(value: { amount: number; currency: string } | null | undefined): string {
  if (!value) return '—';
  return formatMoneyCents(value.amount, value.currency);
}

function routeLabel(origin: string | null | undefined, destination: string | null | undefined): string {
  if (origin && destination) return `${origin} → ${destination}`;
  if (origin) return origin;
  if (destination) return destination;
  return 'Route unavailable';
}

function humanizeToken(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function travelerName(traveler: AgentFlightBookingTraveler): string {
  const first = typeof traveler.first_name === 'string' ? traveler.first_name : null;
  const last = typeof traveler.last_name === 'string' ? traveler.last_name : null;
  const full = [first, last].filter(Boolean).join(' ').trim();
  return full || 'Traveler';
}

function normalizeName(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function travelerProfileName(traveler: TravelerProfile): string {
  const full = [traveler.first_name, traveler.middle_name, traveler.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return full || traveler.email || traveler.id;
}

function travelerAddress(traveler: TravelerProfile): string {
  return [
    traveler.address_line_1, traveler.address_line_2,
    traveler.city, traveler.state, traveler.postal_code, traveler.address_country,
  ].filter(Boolean).join(', ') || '—';
}

function travelerPassportSummary(traveler: TravelerProfile): string {
  if (traveler.passports && traveler.passports.length > 0) {
    return traveler.passports
      .map((passport) => [passport.country, passport.number, passport.expiry].filter(Boolean).join(' · '))
      .join(' | ');
  }
  return [traveler.passport_country, traveler.passport_number, traveler.passport_expiry]
    .filter(Boolean).join(' · ') || '—';
}

function travelerLoyaltySummary(traveler: TravelerProfile): string {
  if (traveler.loyalty_memberships && traveler.loyalty_memberships.length > 0) {
    return traveler.loyalty_memberships
      .map((membership) => `${membership.program_id}: ${membership.number}`)
      .join(' | ');
  }
  return Object.entries(traveler.loyalty_programs || {})
    .map(([program, number]) => `${program}: ${number}`)
    .join(' | ') || '—';
}

function matchingPassengerSummary(
  traveler: TravelerProfile | AgentFlightBookingTraveler,
  passengers: PassengerSummary[] | null | undefined,
): PassengerSummary | null {
  if (!passengers || passengers.length === 0) return null;
  const travelerId = 'id' in traveler && typeof traveler.id === 'string' ? traveler.id : null;
  if (travelerId) {
    const byId = passengers.find((passenger) => passenger.id === travelerId);
    if (byId) return byId;
  }
  const primaryName = normalizeName(
    'middle_name' in traveler
      ? [traveler.first_name, traveler.middle_name, traveler.last_name].filter(Boolean).join(' ')
      : [traveler.first_name, traveler.last_name].filter(Boolean).join(' '),
  );
  const fallbackName = normalizeName(
    [traveler.first_name, traveler.last_name].filter(Boolean).join(' '),
  );
  return passengers.find((passenger) => {
    const passengerName = normalizeName(passenger.name);
    return passengerName === primaryName || passengerName === fallbackName;
  }) || null;
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

function userPhone(user: AgentFlightBookingDetail['user']): string | null {
  if (!user) return null;
  const phone = typeof user.phone_number === 'string' && user.phone_number.trim()
    ? user.phone_number
    : user.phone;
  return typeof phone === 'string' && phone.trim() ? phone : null;
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
  if (PLACEHOLDER_CONFIRMATION_CODES.has(normalized.toUpperCase())) return 'Pending';
  return normalized;
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

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function mergeTravelerProfiles(
  detailProfiles: TravelerProfile[] | null | undefined,
  memberProfiles: TravelerProfile[] | null | undefined,
): TravelerProfile[] {
  const merged = new Map<string, TravelerProfile>();
  for (const traveler of [...(memberProfiles || []), ...(detailProfiles || [])]) {
    const key = traveler.id || traveler.email || travelerProfileName(traveler);
    const existing = merged.get(key);
    merged.set(key, { ...(existing || {}), ...traveler } as TravelerProfile);
  }
  return Array.from(merged.values());
}

/* ─── Small UI components ─── */

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
  containerClassName,
  valueClassName,
}: {
  label: string;
  value: string | null | undefined;
  monospace?: boolean;
  containerClassName?: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-border bg-accent/20 p-3', containerClassName)}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-sm', monospace && 'font-mono text-xs break-all', valueClassName)}>{value || '—'}</div>
    </div>
  );
}

function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="rounded-lg border border-border bg-accent/20">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        {count === undefined ? title : `${title} (${count})`}
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  );
}

function JsonDisclosure({
  title,
  value,
  defaultOpen = false,
}: {
  title: string;
  value: unknown;
  defaultOpen?: boolean;
}) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0) return null;

  return (
    <details open={defaultOpen} className="rounded-lg border border-border bg-accent/20 p-4">
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-background/80 p-3 text-xs text-muted-foreground">
        {stringifyJson(value)}
      </pre>
    </details>
  );
}

function RelatedThoughts({ thoughts }: { thoughts: ThoughtView[] }) {
  if (thoughts.length === 0) {
    return <div className="text-sm text-muted-foreground">No visible thoughts.</div>;
  }
  return (
    <div className="space-y-2">
      {thoughts.map((thought) => (
        <div key={`${thought.text}-${thought.created_at}`} className="rounded-lg border border-border bg-accent/20 p-3">
          <div className="text-sm">{thought.text}</div>
          <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(thought.created_at)}</div>
        </div>
      ))}
    </div>
  );
}

function WatchSummary({ watch }: { watch: WatchView }) {
  return (
    <div className="rounded-lg border border-border bg-accent/20 p-3 text-sm">
      <div className="font-medium">{humanizeToken(watch.watch_type)} · {humanizeToken(watch.status)}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {[
          watch.goal,
          watch.latest_observed_price ? formatMoney(watch.latest_observed_price) : null,
          watch.latest_observed_at ? `Observed ${formatDateTime(watch.latest_observed_at)}` : null,
        ].filter(Boolean).join(' · ') || 'No extra watch metadata'}
      </div>
    </div>
  );
}

function PaymentSummary({ payment }: { payment: PaymentRecord }) {
  return (
    <div className="rounded-lg border border-border bg-accent/20 p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{humanizeToken(payment.type)}</span>
        <span>{formatMoney({ amount: payment.amount, currency: payment.currency })}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {[
          humanizeToken(payment.status),
          payment.booking_id ? `Booking ${payment.booking_id}` : null,
          formatDateTime(payment.completed_at || payment.created_at),
        ].filter(Boolean).join(' · ')}
      </div>
      {payment.failure_reason && <div className="mt-1 text-xs text-red-300">{payment.failure_reason}</div>}
    </div>
  );
}

/* ─── Main Component ─── */

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
  const taskFailureReason = typeof task.response_data?.failure_reason === 'string' ? task.response_data.failure_reason : null;
  const taskNotes = typeof task.response_data?.notes === 'string' ? task.response_data.notes : null;
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
  const [memberContext, setMemberContext] = useState<MemberContext | null>(null);
  const [memberContextLoading, setMemberContextLoading] = useState(false);
  const [memberContextError, setMemberContextError] = useState<string | null>(null);
  const [showFailureForm, setShowFailureForm] = useState(false);
  const [quickFailureReason, setQuickFailureReason] = useState('');

  useEffect(() => {
    setConfirmationCode(normalizeConfirmationCode(flightBooking?.record_locator || summary.record_locator));
    setBookingProvider(flightBooking?.booking_provider || '');
  }, [task.id, flightBooking?.record_locator, flightBooking?.booking_provider, summary.record_locator]);

  useEffect(() => {
    setFailureReason(initialFailureReason);
    setCompletionNotes(initialNotes);
  }, [initialFailureReason, initialNotes, task.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadMemberContext() {
      setMemberContextLoading(true);
      setMemberContextError(null);
      setMemberContext(null);
      try {
        const context = await api.getMember(task.user_id);
        if (!cancelled) setMemberContext(context);
      } catch (err) {
        if (!cancelled) {
          setMemberContext(null);
          setMemberContextError(err instanceof Error ? err.message : 'Failed to load member context');
        }
      } finally {
        if (!cancelled) setMemberContextLoading(false);
      }
    }
    void loadMemberContext();
    return () => { cancelled = true; };
  }, [task.user_id]);

  const bookingId = flightBooking?.id || summary.booking_id || task.booking_id || null;
  const travelerProfiles = useMemo(
    () => mergeTravelerProfiles(detail.traveler_profiles, memberContext?.travellers),
    [detail.traveler_profiles, memberContext?.travellers],
  );
  const relatedTrips = useMemo(
    () => bookingId
      ? (memberContext?.trips || []).filter((trip) => trip.bookings.some((booking) => booking.id === bookingId))
      : [],
    [bookingId, memberContext?.trips],
  );
  const axelConfirmationCode = useMemo(() => {
    if (!bookingId) return null;
    for (const trip of relatedTrips) {
      const match = trip.bookings.find((b) => b.id === bookingId);
      if (match?.flight?.confirmation_code) return match.flight.confirmation_code;
    }
    return null;
  }, [bookingId, relatedTrips]);
  const relatedWatches = useMemo(
    () => (memberContext?.watches || []).filter(
      (watch) =>
        (bookingId && watch.booking_id === bookingId) ||
        (watch.trip_id && relatedTrips.some((trip) => trip.id === watch.trip_id)),
    ),
    [bookingId, memberContext?.watches, relatedTrips],
  );
  const relatedPayments = useMemo(
    () => bookingId
      ? (memberContext?.payment_records || []).filter((payment) => payment.booking_id === bookingId)
      : [],
    [bookingId, memberContext?.payment_records],
  );
  const relatedThoughts = useMemo(() => {
    const thoughts = new Map<string, ThoughtView>();
    for (const trip of relatedTrips) {
      for (const thought of trip.visible_thoughts || []) {
        thoughts.set(`${thought.text}-${thought.created_at}`, thought);
      }
      const matchingBooking = trip.bookings.find((booking) => booking.id === bookingId);
      for (const thought of matchingBooking?.visible_thoughts || []) {
        thoughts.set(`${thought.text}-${thought.created_at}`, thought);
      }
    }
    return Array.from(thoughts.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [bookingId, relatedTrips]);
  const memberPhone = userPhone(detail.user) || memberContext?.user_extras.phone || null;
  const memberEmail = detail.user?.email || memberContext?.user_extras.email || null;
  const currentRecordLocator = normalizeConfirmationCode(rawRecordLocator);
  const currentBookingProvider = (flightBooking?.booking_provider || '').trim();
  const normalizedConfirmationCode = normalizeConfirmationCode(confirmationCode);
  const normalizedBookingProvider = bookingProvider.trim();
  const effectiveConfirmationCode = normalizedConfirmationCode || currentRecordLocator;
  const effectiveBookingProvider = normalizedBookingProvider || currentBookingProvider;
  const hasPendingBookingChanges =
    normalizedConfirmationCode !== currentRecordLocator ||
    normalizedBookingProvider !== currentBookingProvider;

  const canUnclaim = task.status === 'claimed';
  const canBlock = task.status === 'pending' || task.status === 'claimed' || task.status === 'failed';
  const canComplete = task.status === 'pending' || task.status === 'claimed' || task.status === 'failed' || task.status === 'blocked';
  const completionNeedsConfirmation = completionOutcome === 'success' && !effectiveConfirmationCode;
  const completionNeedsFailureReason =
    completionOutcome === 'failure' &&
    task.valid_failure_reasons.length > 0 &&
    !failureReason.trim();

  async function autoClaimIfNeeded(): Promise<boolean> {
    if (task.status === 'claimed') return true;
    if (task.status !== 'pending' && task.status !== 'failed' && task.status !== 'blocked') return false;
    try {
      const updated = await api.claimAgentFlightBookingTask(task.id);
      onTaskUpdate(updated);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to auto-claim task');
      return false;
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
      const claimed = await autoClaimIfNeeded();
      if (!claimed) return;
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
    if (hasPendingBookingChanges && completionOutcome !== 'failure') {
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
      const claimed = await autoClaimIfNeeded();
      if (!claimed) return;
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

  async function handleQuickFail() {
    if (!quickFailureReason.trim()) {
      setError('Select a failure reason');
      return;
    }
    setActionLoading('fail');
    setError(null);
    setSuccess(null);
    try {
      const claimed = await autoClaimIfNeeded();
      if (!claimed) return;
      const updated = await api.completeAgentFlightBookingTask(task.id, {
        outcome: 'failure',
        failure_reason: quickFailureReason.trim(),
        notes: completionNotes.trim() || undefined,
      });
      onTaskUpdate(updated);
      await onRefreshDetail();
      setSuccess('Task marked as failed');
      setShowFailureForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark task as failed');
    } finally {
      setActionLoading(null);
    }
  }

  const carrierDisplay = formatAirlineWithCode(
    summary.carrier_code || flightBooking?.airline_code,
    summary.carrier_name || flightBooking?.airline,
  );
  const paxCount = flightBooking?.passengers?.length || summary.traveler_count || 0;
  const tripDates = summary.outbound_departure
    ? `${formatDateTimeShort(summary.outbound_departure)}${summary.return_departure ? ` – ${formatDateTimeShort(summary.return_departure)}` : ' (one-way)'}`
    : 'Dates unavailable';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-card">
        {/* ─── Sticky Header ─── */}
        <div className="sticky top-0 z-10 border-b border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold truncate">{routeLabel(summary.origin, summary.destination)}</h2>
                <StatusBadge status={task.status} />
                <OutcomeBadge outcome={task.outcome} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground truncate">{carrierDisplay} · {task.id.slice(0, 8)}</p>
              {(memberEmail || memberPhone) && (
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {memberEmail && <span>{memberEmail}</span>}
                  {memberPhone && <span>{memberPhone}</span>}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {canUnclaim && (
                <button
                  onClick={() => void handleUnclaim()}
                  disabled={actionLoading !== null}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent/70 disabled:opacity-50"
                >
                  {actionLoading === 'unclaim' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                  Unclaim
                </button>
              )}
              <Link
                href={`/users-list/${task.user_id}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent/70"
              >
                <User className="h-3.5 w-3.5" />
                Profile
              </Link>
              <button onClick={onClose} className="rounded-md p-1.5 transition-colors hover:bg-accent">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-4">
          {/* ─── Error/Success Messages ─── */}
          {(error || success) && (
            <div className={cn('rounded-lg border p-2.5 text-sm', error ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-green-500/30 bg-green-500/10 text-green-300')}>
              {error || success}
            </div>
          )}

          {/* ─── Key Info Bar ─── */}
          <div className="rounded-lg border border-border bg-accent/30 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-semibold">{carrierDisplay}</span>
              <span className="text-muted-foreground">·</span>
              <span>{tripDates}</span>
              <span className="text-muted-foreground">·</span>
              <span>{paxCount} pax</span>
              <span className="text-muted-foreground">·</span>
              <span>{[summary.cabin, summary.fare_family].filter(Boolean).join(' ') || 'Economy'}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-semibold text-green-400">{formatMoneyCents(summary.price_paid_cents, summary.currency || 'USD')}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
              {axelConfirmationCode && <span>Axel: <span className="font-mono font-semibold text-foreground">{axelConfirmationCode}</span></span>}
              <span>Confirmation: <span className="font-mono">{displayConfirmationCode(rawRecordLocator)}</span></span>
              <span>Provider: {flightBooking?.booking_provider || summary.booking_provider || '—'}</span>
              <span>Status: {flightBooking?.status || summary.booking_status || '—'}</span>
            </div>
          </div>

          {/* ─── Compact Segments Table ─── */}
          <section>
            <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
              <Plane className="h-4 w-4" />
              Segments ({summary.segments.length})
            </div>
            {summary.segments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                Segment-level routing was not included on this task.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-accent/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">#</th>
                      <th className="px-3 py-2 text-left font-medium">Route</th>
                      <th className="px-3 py-2 text-left font-medium">Depart</th>
                      <th className="px-3 py-2 text-left font-medium">Arrive</th>
                      <th className="px-3 py-2 text-left font-medium">Flight</th>
                      <th className="px-3 py-2 text-left font-medium">Fare</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.segments.map((segment, index) => {
                      const operatingFlight = formatSegmentFlightCode(segment.operating_carrier, segment.flight_number);
                      const marketedFlight = segmentMarketingDisplay(segment);
                      const segmentFare = [segment.cabin, segment.fare_family].filter(Boolean).join(' ');

                      return (
                        <tr key={`${segment.origin}-${segment.destination}-${index}`} className="border-t border-border">
                          <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                          <td className="px-3 py-2 font-medium whitespace-nowrap">{routeLabel(segment.origin, segment.destination)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{formatFlightTime(segment.departure_date, segment.departure_time)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{formatFlightTime(segment.arrival_date, segment.arrival_time)}</td>
                          <td className="px-3 py-2 font-mono whitespace-nowrap">
                            {operatingFlight || '—'}
                            {marketedFlight && (
                              <span className="ml-1 text-xs text-muted-foreground">(mktd {marketedFlight})</span>
                            )}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">{segmentFare || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ─── Travelers (collapsed) ─── */}
          <CollapsibleSection title="Travelers" count={paxCount}>
            {flightBooking?.passengers && flightBooking.passengers.length > 0 ? (
              <div className="space-y-2">
                {flightBooking.passengers.map((passenger) => {
                  const profile = passenger.id
                    ? travelerProfiles.find((p) => p.id === passenger.id)
                    : travelerProfiles.find((p) => {
                        const profileName = normalizeName([p.first_name, p.last_name].filter(Boolean).join(' '));
                        const profileFullName = normalizeName(travelerProfileName(p));
                        const passengerName = normalizeName(passenger.name);
                        return passengerName === profileName || passengerName === profileFullName;
                      });
                  const ticket = flightBooking.tickets?.find((t) => {
                    const traveler = t as Record<string, unknown>;
                    const inner = traveler.traveler as Record<string, unknown> | undefined;
                    if (passenger.id && inner?.traveller_profile_id === passenger.id) return true;
                    if (!passenger.id && inner) {
                      const ticketName = normalizeName(
                        [inner.first_name as string, inner.last_name as string].filter(Boolean).join(' '),
                      );
                      return ticketName === normalizeName(passenger.name);
                    }
                    return false;
                  }) as Record<string, unknown> | undefined;

                  return (
                    <div key={passenger.id || passenger.name} className="rounded-lg border border-border bg-background/50 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium">{passenger.name}</div>
                        {passenger.is_primary && (
                          <span className="rounded-full border border-blue-500/30 bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium text-blue-300">Primary</span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {[passenger.date_of_birth, profile?.gender, passenger.citizenship].filter(Boolean).join(' · ') || 'No metadata'}
                      </div>
                      {(profile?.email || profile?.phone || profile?.known_traveler_number || (profile && travelerLoyaltySummary(profile) !== '—')) && (
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {profile?.email && <DetailField label="Email" value={profile.email} />}
                          {profile?.phone && <DetailField label="Phone" value={profile.phone} />}
                          {(profile?.known_traveler_number || (ticket?.known_traveler_number as string | undefined)) && (
                            <DetailField label="Known Traveler" value={profile?.known_traveler_number || (ticket?.known_traveler_number as string | undefined)} monospace />
                          )}
                          {profile && travelerLoyaltySummary(profile) !== '—' && (
                            <DetailField label="Frequent Flyer" value={travelerLoyaltySummary(profile)} monospace />
                          )}
                          {profile && travelerPassportSummary(profile) !== '—' && (
                            <DetailField label="Passports" value={travelerPassportSummary(profile)} />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : travelerProfiles.length > 0 ? (
              <div className="space-y-2">
                {travelerProfiles.map((traveler) => (
                  <div key={traveler.id} className="rounded-lg border border-border bg-background/50 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{travelerProfileName(traveler)}</div>
                      {traveler.is_account_holder && (
                        <span className="rounded-full border border-border bg-background/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Account holder</span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {[traveler.date_of_birth, traveler.gender, traveler.citizenship].filter(Boolean).join(' · ') || 'No metadata'}
                    </div>
                    {travelerLoyaltySummary(traveler) !== '—' && (
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <DetailField label="Frequent Flyer" value={travelerLoyaltySummary(traveler)} monospace />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : summary.travelers.length > 0 ? (
              <div className="space-y-2">
                {summary.travelers.map((traveler, index) => (
                  <div key={`${travelerName(traveler)}-${index}`} className="rounded-lg border border-border bg-background/50 p-3 text-sm">
                    <div className="font-medium">{travelerName(traveler)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {[
                        typeof traveler.date_of_birth === 'string' ? traveler.date_of_birth : null,
                        typeof traveler.gender === 'string' ? traveler.gender : null,
                      ].filter(Boolean).join(' · ') || 'No metadata'}
                    </div>
                    {typeof (traveler as Record<string, unknown>).frequent_flyer_number === 'string' && (traveler as Record<string, unknown>).frequent_flyer_number && (
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <DetailField label="Frequent Flyer" value={(traveler as Record<string, unknown>).frequent_flyer_number as string} monospace />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No traveler details available.</div>
            )}
          </CollapsibleSection>

          {/* ─── Operator Actions (always open) ─── */}
          <section className="space-y-3">
            <div className="text-sm font-semibold">Operator Actions</div>

            <div className="rounded-lg border border-border bg-accent/20 p-3 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium text-xs">Confirmation code</span>
                  <input
                    type="text"
                    value={confirmationCode}
                    onChange={(e) => setConfirmationCode(e.target.value)}
                    placeholder="ABC123"
                    className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium text-xs">Booking provider</span>
                  <input
                    type="text"
                    value={bookingProvider}
                    onChange={(e) => setBookingProvider(e.target.value)}
                    placeholder="delta.com"
                    className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </label>
              </div>
              <button
                onClick={() => void handleSaveBooking()}
                disabled={actionLoading !== null || !flightBooking}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {actionLoading === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Save booking
              </button>
            </div>

            <div className="rounded-lg border border-border bg-accent/20 p-3 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium text-xs">Completion outcome</span>
                  <select
                    value={completionOutcome}
                    onChange={(e) => setCompletionOutcome(e.target.value as 'success' | 'partial' | 'failure')}
                    className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="success">Success</option>
                    <option value="partial">Partial</option>
                    <option value="failure">Failure</option>
                  </select>
                </label>
                {completionOutcome === 'failure' && (
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium text-xs">Failure reason</span>
                    <select
                      value={failureReason}
                      onChange={(e) => setFailureReason(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Select a reason</option>
                      {task.valid_failure_reasons.map((reason) => (
                        <option key={reason} value={reason}>{reason}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <label className="space-y-1.5 text-sm">
                <span className="font-medium text-xs">Operator notes</span>
                <textarea
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  placeholder="Optional notes"
                  rows={2}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </label>

              {((hasPendingBookingChanges && completionOutcome !== 'failure') || completionNeedsConfirmation || completionNeedsFailureReason) && (
                <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2.5 text-xs text-yellow-200">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div>
                      {hasPendingBookingChanges && completionOutcome !== 'failure' && <div>Save booking edits first.</div>}
                      {completionNeedsConfirmation && <div>Confirmation code required for success.</div>}
                      {completionNeedsFailureReason && <div>Select a failure reason.</div>}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void handleComplete()}
                  disabled={actionLoading !== null || !canComplete || (hasPendingBookingChanges && completionOutcome !== 'failure') || completionNeedsConfirmation || completionNeedsFailureReason}
                  className="inline-flex items-center gap-1.5 rounded-md bg-green-500/15 px-3 py-1.5 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/25 disabled:opacity-50"
                >
                  {actionLoading === 'complete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Complete task
                </button>

                {canComplete && !showFailureForm && (
                  <button
                    onClick={() => setShowFailureForm(true)}
                    disabled={actionLoading !== null}
                    className="inline-flex items-center gap-1.5 rounded-md bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/25 disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Mark as failed
                  </button>
                )}
              </div>

              {showFailureForm && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 space-y-2">
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium text-xs text-red-300">Failure reason</span>
                    <select
                      value={quickFailureReason}
                      onChange={(e) => setQuickFailureReason(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      <option value="">Select a reason</option>
                      {task.valid_failure_reasons.map((reason) => (
                        <option key={reason} value={reason}>{reason}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleQuickFail()}
                      disabled={actionLoading !== null || !quickFailureReason}
                      className="inline-flex items-center gap-1.5 rounded-md bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/30 disabled:opacity-50"
                    >
                      {actionLoading === 'fail' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                      Confirm failure
                    </button>
                    <button
                      onClick={() => { setShowFailureForm(false); setQuickFailureReason(''); }}
                      className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-accent/20 p-3 space-y-2">
              <label className="space-y-1.5 text-sm">
                <span className="font-medium text-xs">Block reason</span>
                <textarea
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Why this task should stay blocked"
                  rows={2}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </label>
              <button
                onClick={() => void handleBlock()}
                disabled={actionLoading !== null || !canBlock}
                className="inline-flex items-center gap-1.5 rounded-md bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/25 disabled:opacity-50"
              >
                {actionLoading === 'block' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                Block task
              </button>
            </div>
          </section>

          {/* ─── Collapsed Sections ─── */}

          <CollapsibleSection title="Booking State">
            <div className="grid gap-2 md:grid-cols-2">
              <DetailField label="Travel Status" value={flightBooking?.status || summary.booking_status} />
              <DetailField label="Verification" value={humanizeToken(flightBooking?.verification_status)} />
              <DetailField label="Record Locator" value={displayConfirmationCode(rawRecordLocator)} monospace />
              <DetailField label="Booking Provider" value={flightBooking?.booking_provider || summary.booking_provider} />
              <DetailField label="Booking Source" value={humanizeToken(flightBooking?.source)} />
              <DetailField label="Booked At" value={formatDateTime(flightBooking?.booked_at)} />
              <DetailField label="Travel Begins" value={flightBooking?.travel_begins_date || '—'} />
              <DetailField label="Supplier" value={flightBooking?.supplier} />
              <DetailField label="Supplier Ref" value={flightBooking?.internal_supplier_reference} monospace />
              <DetailField label="Award Booking" value={flightBooking?.is_award_booking === undefined ? '—' : flightBooking.is_award_booking ? 'Yes' : 'No'} />
              <DetailField label="Loyalty" value={[flightBooking?.loyalty_program, flightBooking?.loyalty_number].filter(Boolean).join(' · ') || '—'} />
              <DetailField label="Miles Paid" value={flightBooking?.miles_paid?.toLocaleString() || '—'} />
            </div>
            {task.blocked_reason && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                <div className="font-medium">Blocked reason</div>
                <div className="mt-1">{task.blocked_reason}</div>
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Financials">
            {flightBooking?.margin && flightBooking.margin.amount < 0 && (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-200">
                Underwater booking. Margin: {formatMoney(flightBooking.margin)}.
              </div>
            )}
            <div className="grid gap-2 md:grid-cols-2">
              <DetailField label="Customer Paid" value={formatMoney(flightBooking?.cash_paid)} />
              <DetailField label="Supplier Cost" value={formatMoney(flightBooking?.supplier_cost)} />
              <DetailField
                label="Margin"
                value={formatMoney(flightBooking?.margin)}
                containerClassName={flightBooking?.margin && flightBooking.margin.amount < 0 ? 'border-red-500/30 bg-red-500/10' : undefined}
                valueClassName={flightBooking?.margin && flightBooking.margin.amount < 0 ? 'font-semibold text-red-300' : undefined}
              />
              <DetailField label="Original Price" value={formatMoney(flightBooking?.original_price)} />
              <DetailField label="Total Savings" value={formatMoney(flightBooking?.total_savings)} />
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Member Context">
            {memberContextLoading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : memberContextError ? (
              <div className="text-sm text-red-300">{memberContextError}</div>
            ) : memberContext ? (
              <div className="space-y-3">
                <div className="grid gap-2 md:grid-cols-2">
                  <CollapsibleSection title="Visible Thoughts" count={relatedThoughts.length} defaultOpen={relatedThoughts.length > 0}>
                    <RelatedThoughts thoughts={relatedThoughts.slice(0, 6)} />
                  </CollapsibleSection>
                  <CollapsibleSection title="Related Watches" count={relatedWatches.length} defaultOpen={relatedWatches.length > 0}>
                    {relatedWatches.length === 0 ? (
                      <div className="text-sm text-muted-foreground">None.</div>
                    ) : (
                      <div className="space-y-2">
                        {relatedWatches.slice(0, 4).map((watch) => (
                          <WatchSummary key={watch.id} watch={watch} />
                        ))}
                      </div>
                    )}
                  </CollapsibleSection>
                  <CollapsibleSection title="Related Payments" count={relatedPayments.length}>
                    {relatedPayments.length === 0 ? (
                      <div className="text-sm text-muted-foreground">None.</div>
                    ) : (
                      <div className="space-y-2">
                        {relatedPayments.slice(0, 4).map((payment) => (
                          <PaymentSummary key={payment.id} payment={payment} />
                        ))}
                      </div>
                    )}
                  </CollapsibleSection>
                  <CollapsibleSection title="Escalations" count={memberContext.escalations.length}>
                    {memberContext.escalations.length === 0 ? (
                      <div className="text-sm text-muted-foreground">None.</div>
                    ) : (
                      <div className="space-y-2">
                        {memberContext.escalations.slice(0, 4).map((escalation) => (
                          <div key={escalation.id} className="rounded-lg border border-border bg-background/50 p-3 text-sm">
                            <div className="font-medium">{humanizeToken(escalation.type)} · {humanizeToken(escalation.status)}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {[escalation.reason, formatDateTime(escalation.resolved_at || escalation.created_at)].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CollapsibleSection>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Member context not available.</div>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Task Resolution">
            <div className="grid gap-2 md:grid-cols-2">
              <DetailField label="Claimed By" value={task.claimed_by} />
              <DetailField label="Claimed At" value={formatDateTime(task.claimed_at)} />
              <DetailField label="Completed At" value={formatDateTime(task.completed_at)} />
              <DetailField label="Fulfillment Time" value={formatDuration(task.claimed_at, task.completed_at)} />
              <DetailField label="Failure Reason" value={taskFailureReason ? humanizeToken(taskFailureReason) : '—'} />
              <DetailField label="Task ID" value={task.id} monospace />
              <DetailField label="Booking ID" value={summary.booking_id} monospace />
              <DetailField label="Created" value={formatDateTime(task.created_at)} />
            </div>
            {taskNotes && (
              <div className="mt-3 rounded-lg border border-border bg-background/50 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Operator Notes</div>
                <div className="mt-1 whitespace-pre-wrap text-sm">{taskNotes}</div>
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Raw Data">
            <div className="space-y-3">
              <JsonDisclosure title="Task Request Data" value={task.request_data} defaultOpen />
              <JsonDisclosure title="Task Response Data" value={task.response_data} />
              <JsonDisclosure title="Traveler Profiles" value={detail.traveler_profiles} />
              <JsonDisclosure title="Itinerary JSON" value={flightBooking?.itinerary} />
              <JsonDisclosure title="Tickets JSON" value={flightBooking?.tickets} />
              <JsonDisclosure title="Ancillaries JSON" value={flightBooking?.ancillaries} />
              <JsonDisclosure title="Access Credentials" value={flightBooking?.access_credentials} />
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}
