'use client';

import { useState } from 'react';
import Link from 'next/link';
import { cn, fromMinorUnits, parseLocalDate } from '@/lib/utils';
import { HotelBookingListItem, UserBasicInfo } from '@/lib/api';

// ── Copy Button ──────────────────────────────────────────

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
      className="text-muted-foreground hover:text-foreground transition-colors"
      title="Copy"
    >
      {copied ? (
        <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth={2} />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function IdPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-mono text-muted-foreground/80 truncate max-w-[120px]">{value.slice(0, 8)}&hellip;</span>
      <CopyButton value={value} />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────

function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const cur = currency || 'USD';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: cur,
  }).format(fromMinorUnits(amount, cur));
}

function nightsBetween(checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  const a = parseLocalDate(checkIn);
  const b = parseLocalDate(checkOut);
  const diff = Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : null;
}

function formatFullDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return parseLocalDate(dateStr).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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

// ── Status Badge ─────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    confirmed: 'bg-green-500/20 text-green-400',
    in_progress: 'bg-blue-500/20 text-blue-400',
    pending: 'bg-yellow-500/20 text-yellow-400',
    cancelled: 'bg-red-500/20 text-red-400',
    completed: 'bg-zinc-500/20 text-zinc-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap', colors[status] || 'bg-zinc-500/20 text-zinc-400')}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function VerificationBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const colors: Record<string, string> = {
    complete: 'bg-green-500/20 text-green-400',
    functional: 'bg-blue-500/20 text-blue-400',
    unverified: 'bg-yellow-500/20 text-yellow-400',
    importing: 'bg-zinc-500/20 text-zinc-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap', colors[status] || 'bg-zinc-500/20 text-zinc-400')}>
      {status}
    </span>
  );
}

// ── Section Component ────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-4 border-b border-border last:border-0">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </section>
  );
}

function InfoRow({ label, value, mono, copyable }: { label: string; value: string | React.ReactNode; mono?: boolean; copyable?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        {typeof value === 'string' ? (
          <span className={cn('text-sm text-right truncate', mono && 'font-mono text-xs')}>{value}</span>
        ) : (
          value
        )}
        {copyable && <CopyButton value={copyable} />}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────

interface HotelBookingDetailProps {
  booking: HotelBookingListItem;
  userInfo?: UserBasicInfo;
  onClose: () => void;
}

export function HotelBookingDetail({ booking, userInfo, onClose }: HotelBookingDetailProps) {
  const [showIds, setShowIds] = useState(false);
  const [showCancellationPolicy, setShowCancellationPolicy] = useState(false);

  const nights = nightsBetween(booking.check_in_date, booking.check_out_date);

  // Cancellation urgency
  const cancellationUrgency = (() => {
    if (!booking.free_cancellation_until) return null;
    const until = new Date(booking.free_cancellation_until);
    const now = new Date();
    const diffMs = until.getTime() - now.getTime();
    if (diffMs < 0) return 'past';
    if (diffMs < 48 * 60 * 60 * 1000) return 'imminent';
    return 'ok';
  })();

  // Margin calculation
  const margin = (() => {
    if (booking.customer_price_amount == null || booking.supplier_cost_amount == null) return null;
    const diff = booking.customer_price_amount - booking.supplier_cost_amount;
    const pct = booking.supplier_cost_amount > 0 ? ((diff / booking.supplier_cost_amount) * 100).toFixed(1) : null;
    return { amount: diff, currency: booking.customer_price_currency || 'USD', pct };
  })();

  const content = (
    <div className="p-6 space-y-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-border">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold truncate">{booking.hotel_name || 'Unknown Hotel'}</h2>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge status={booking.status} />
            {booking.verification_status && <VerificationBadge status={booking.verification_status} />}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-1"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Customer */}
      <Section title="Customer">
        {userInfo ? (
          <div className="space-y-1">
            <InfoRow label="Name" value={userInfo.name || '—'} />
            <InfoRow label="Email" value={userInfo.email || '—'} />
            <InfoRow label="Phone" value={userInfo.phone || '—'} />
            <Link
              href={`/users-list/${booking.user_id}`}
              className="text-xs text-primary hover:underline mt-2 inline-block"
            >
              View Profile &rarr;
            </Link>
          </div>
        ) : (
          <div className="space-y-1">
            <InfoRow label="User ID" value={booking.user_id.slice(0, 8) + '...'} mono copyable={booking.user_id} />
            <Link
              href={`/users-list/${booking.user_id}`}
              className="text-xs text-primary hover:underline mt-2 inline-block"
            >
              View Profile &rarr;
            </Link>
          </div>
        )}
      </Section>

      {/* Hotel Details */}
      <Section title="Hotel Details">
        <div className="space-y-1">
          <InfoRow label="Hotel" value={booking.hotel_name || '—'} />
          {booking.hotel_chain && <InfoRow label="Chain" value={booking.hotel_chain} />}
          {booking.room_type && <InfoRow label="Room Type" value={booking.room_type} />}
          <InfoRow
            label="Location"
            value={[booking.city, booking.state, booking.country].filter(Boolean).join(', ') || '—'}
          />
          <InfoRow label="Check-in" value={formatFullDate(booking.check_in_date)} />
          <InfoRow label="Check-out" value={formatFullDate(booking.check_out_date)} />
          {nights && <InfoRow label="Duration" value={`${nights} night${nights !== 1 ? 's' : ''}`} />}
          {booking.booked_at && <InfoRow label="Booked at" value={new Date(booking.booked_at).toLocaleString()} />}
        </div>
      </Section>

      {/* Guests */}
      {booking.guests && booking.guests.length > 0 && (
        <Section title="Guests">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 text-muted-foreground font-medium">Name</th>
                  <th className="text-left py-1 text-muted-foreground font-medium">Primary</th>
                  <th className="text-left py-1 text-muted-foreground font-medium">Citizenship</th>
                </tr>
              </thead>
              <tbody>
                {booking.guests.map((g, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="py-1.5">{g.name}</td>
                    <td className="py-1.5">
                      {g.is_primary && <span className="text-green-400">Yes</span>}
                    </td>
                    <td className="py-1.5 text-muted-foreground">{g.citizenship || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Pricing */}
      <Section title="Pricing">
        <div className="space-y-1">
          <InfoRow
            label="Customer Price"
            value={
              <span className="text-sm font-medium">
                {formatMoney(booking.customer_price_amount, booking.customer_price_currency)}
              </span>
            }
          />
          {booking.original_price_amount != null && booking.original_price_amount !== booking.customer_price_amount && (
            <InfoRow
              label="Original Price"
              value={
                <span className="text-sm text-muted-foreground line-through">
                  {formatMoney(booking.original_price_amount, booking.original_price_currency)}
                </span>
              }
            />
          )}
          {nights && booking.customer_price_amount != null && (
            <InfoRow
              label="Per Night"
              value={formatMoney(Math.round(booking.customer_price_amount / nights), booking.customer_price_currency)}
            />
          )}
        </div>
      </Section>

      {/* Booking Info */}
      <Section title="Booking Info">
        <div className="space-y-1">
          <InfoRow
            label="Axel Confirmation"
            value={booking.confirmation_code || '—'}
            mono
            copyable={booking.confirmation_code || undefined}
          />
          {booking.verification_status && (
            <InfoRow label="Verification" value={<VerificationBadge status={booking.verification_status} />} />
          )}
          {booking.booked_at && (
            <InfoRow label="Booked" value={new Date(booking.booked_at).toLocaleString()} />
          )}
        </div>
      </Section>

      {/* Supplier / RateHawk */}
      <Section title="Supplier / RateHawk">
        <div className="space-y-1">
          <InfoRow label="Supplier" value={booking.supplier || '—'} />
          {booking.internal_supplier_reference && (
            <InfoRow
              label="ETG Order ID"
              value={booking.internal_supplier_reference}
              mono
              copyable={booking.internal_supplier_reference}
            />
          )}
          {booking.supplier_confirmation_code && (
            <InfoRow
              label="Hotel Confirmation"
              value={booking.supplier_confirmation_code}
              mono
              copyable={booking.supplier_confirmation_code}
            />
          )}
          <InfoRow
            label="Supplier Cost"
            value={formatMoney(booking.supplier_cost_amount, booking.supplier_cost_currency)}
          />
          {margin && (
            <InfoRow
              label="Margin"
              value={
                <span className={cn('text-sm font-medium', margin.amount >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {formatMoney(margin.amount, margin.currency)}
                  {margin.pct && <span className="text-xs text-muted-foreground ml-1">({margin.pct}%)</span>}
                </span>
              }
            />
          )}
        </div>
      </Section>

      {/* Cancellation */}
      <Section title="Cancellation">
        <div className="space-y-1">
          <InfoRow
            label="Axel Can Cancel"
            value={
              booking.axel_can_cancel
                ? <span className="text-green-400 text-xs font-medium">Yes</span>
                : <span className="text-red-400 text-xs font-medium">No</span>
            }
          />
          {booking.free_cancellation_until && (
            <InfoRow
              label="Free Cancel Until"
              value={
                <span className={cn(
                  'text-xs font-medium',
                  cancellationUrgency === 'past' ? 'text-red-400' :
                  cancellationUrgency === 'imminent' ? 'text-yellow-400' :
                  'text-muted-foreground'
                )}>
                  {new Date(booking.free_cancellation_until).toLocaleString()}
                  {cancellationUrgency === 'past' && ' (expired)'}
                  {cancellationUrgency === 'imminent' && ' (< 48h)'}
                </span>
              }
            />
          )}
          {booking.cancelled_at && (
            <InfoRow label="Cancelled At" value={new Date(booking.cancelled_at).toLocaleString()} />
          )}
          {booking.cancellation_policy && (
            <div className="mt-2">
              <button
                onClick={() => setShowCancellationPolicy(!showCancellationPolicy)}
                className="text-xs text-primary hover:underline"
              >
                {showCancellationPolicy ? 'Hide' : 'Show'} cancellation policy
              </button>
              {showCancellationPolicy && (
                <pre className="mt-2 text-[10px] font-mono text-muted-foreground bg-background/50 rounded p-2 overflow-x-auto max-h-40">
                  {JSON.stringify(booking.cancellation_policy, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* Loyalty (conditional) */}
      {(booking.is_award_booking || booking.loyalty_program) && (
        <Section title="Loyalty">
          <div className="space-y-1">
            {booking.loyalty_program && <InfoRow label="Program" value={booking.loyalty_program} />}
            {booking.loyalty_number && <InfoRow label="Number" value={booking.loyalty_number} mono />}
            {booking.points_paid != null && <InfoRow label="Points Paid" value={booking.points_paid.toLocaleString()} />}
            {booking.is_award_booking && (
              <InfoRow label="Award Booking" value={<span className="text-xs text-yellow-400 font-medium">Yes</span>} />
            )}
          </div>
        </Section>
      )}

      {/* Repricing (conditional) */}
      {(booking.replaced_by_booking_id || (booking.total_savings_amount != null && booking.total_savings_amount > 0)) && (
        <Section title="Repricing">
          <div className="space-y-1">
            {booking.total_savings_amount != null && booking.total_savings_amount > 0 && (
              <InfoRow
                label="Total Savings"
                value={
                  <span className="text-sm font-medium text-green-400">
                    {formatMoney(booking.total_savings_amount, booking.customer_price_currency)}
                  </span>
                }
              />
            )}
            {booking.replaced_by_booking_id && (
              <InfoRow
                label="Replaced By"
                value={booking.replaced_by_booking_id.slice(0, 8) + '...'}
                mono
                copyable={booking.replaced_by_booking_id}
              />
            )}
            <Link
              href="/hotel-repricing-tracking"
              className="text-xs text-primary hover:underline mt-1 inline-block"
            >
              Hotel Repricings &rarr;
            </Link>
          </div>
        </Section>
      )}

      {/* IDs (collapsible) */}
      <div className="pt-4 border-t border-border">
        <button
          onClick={() => setShowIds(!showIds)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showIds ? '▾' : '▸'} Debug IDs
        </button>
        {showIds && (
          <div className="mt-2 space-y-1">
            <IdPill label="Booking" value={booking.id} />
            <IdPill label="User" value={booking.user_id} />
            {booking.conv_trip_id && <IdPill label="Trip" value={booking.conv_trip_id} />}
            {booking.internal_supplier_reference && <IdPill label="ETG Order" value={booking.internal_supplier_reference} />}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-card border-l border-border h-full overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {content}
      </div>
    </div>
  );
}
