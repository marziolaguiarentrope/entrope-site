'use client';

import { useState, useEffect } from 'react';
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
  RawEmail,
  CreditAdjustmentRequest,
  IntercomContact,
  IntercomConversation,
  CustomerIoPerson,
  CustomerIoActivity,
} from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { BookingEditInline } from './booking-edit-inline';

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

// Credit Adjustment Modal with double confirmation
function CreditAdjustmentModal({
  userId,
  currentBalance,
  currentCurrency,
  operatorEmail,
  onClose,
  onSuccess,
}: {
  userId: string;
  currentBalance: number;
  currentCurrency: string;
  operatorEmail: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  // Ensure currentBalance is always a number (API may return string)
  const safeBalance = Number(currentBalance) || 0;

  const [adjustmentType, setAdjustmentType] = useState<'add' | 'subtract'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [step, setStep] = useState<'input' | 'confirm'>('input');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonOptions = [
    'Goodwill credit',
    'Refund adjustment',
    'Billing correction',
    'Promotional credit',
    'Referral bonus',
    'Service recovery',
    'Other',
  ];

  const parsedAmount = parseFloat(amount) || 0;

  // Delta in dollars (positive = add, negative = subtract)
  const deltaDollars = adjustmentType === 'add' ? parsedAmount : -parsedAmount;
  const newBalance = safeBalance + deltaDollars;

  // Delta in cents for the API
  const deltaCents = Math.round(deltaDollars * 100);

  // Build the full reason string (reason + notes, must be >= 10 chars)
  const fullReason = notes.trim()
    ? `${reason}: ${notes.trim()}`
    : reason;

  function handleProceedToConfirm() {
    if (!amount || parsedAmount <= 0) return;
    if (!reason) return;
    if (fullReason.length < 10) return;
    setStep('confirm');
  }

  async function handleConfirmAndSubmit() {
    setSaving(true);
    setError(null);

    try {
      // Generate idempotency key to prevent double-submits
      const idempotencyKey = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const requestData: CreditAdjustmentRequest = {
        user_id: userId,
        amount_cents: deltaCents,
        reason: fullReason,
        idempotency_key: idempotencyKey,
      };

      await api.adjustCredit(requestData);
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Credit adjustment failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to adjust credit');
      setStep('input'); // Go back to input on error
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]">
      <div className="bg-card border border-border rounded-lg p-5 w-full max-w-md">
        {step === 'input' ? (
          <>
            <h3 className="text-lg font-semibold mb-1">Adjust Credit Balance</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Current balance: <span className="font-medium text-foreground">${safeBalance.toFixed(2)} {currentCurrency}</span>
            </p>

            <div className="space-y-4">
              {/* Adjustment type */}
              <div>
                <label className="block text-sm text-muted-foreground mb-2">Adjustment Type</label>
                <div className="flex gap-1">
                  {([
                    { value: 'add', label: 'Add Credit' },
                    { value: 'subtract', label: 'Remove Credit' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setAdjustmentType(opt.value)}
                      className={cn(
                        'flex-1 px-3 py-2 text-sm font-medium rounded transition-colors',
                        adjustmentType === opt.value
                          ? opt.value === 'subtract' ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30' :
                            'bg-green-500/20 text-green-400 ring-1 ring-green-500/30'
                          : 'bg-accent/50 text-muted-foreground hover:bg-accent'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-sm text-muted-foreground mb-1">
                  Amount ({currentCurrency})
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-7 pr-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    autoFocus
                  />
                </div>
              </div>

              {/* Preview */}
              {parsedAmount > 0 && (
                <div className="bg-accent/30 rounded p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Current</span>
                    <span>${safeBalance.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Change</span>
                    <span className={deltaDollars >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {deltaDollars >= 0 ? '+' : ''}{deltaDollars.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between font-medium border-t border-border mt-1 pt-1">
                    <span>New Balance</span>
                    <span className={newBalance < 0 ? 'text-red-400' : ''}>${newBalance.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Reason</label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                >
                  <option value="">Select a reason...</option>
                  {reasonOptions.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional context for this adjustment..."
                  rows={2}
                  className="w-full px-3 py-2 bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary text-sm resize-none"
                />
              </div>

              {error && (
                <div className="text-red-400 text-sm">{error}</div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm border border-border rounded hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleProceedToConfirm}
                disabled={!parsedAmount || parsedAmount <= 0 || !reason || newBalance < 0 || fullReason.length < 10}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                Review Changes
              </button>
            </div>
          </>
        ) : (
          <>
            {/* CONFIRMATION STEP */}
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <h3 className="text-lg font-semibold">Confirm Credit Adjustment</h3>
            </div>

            <div className="space-y-3 mb-4">
              <div className="bg-accent/30 rounded p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Balance</span>
                  <span className="font-medium">${safeBalance.toFixed(2)} {currentCurrency}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Adjustment</span>
                  <span className={cn('font-medium', deltaDollars >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {deltaDollars >= 0 ? '+' : ''}{deltaDollars.toFixed(2)} {currentCurrency}
                  </span>
                </div>
                <div className="flex justify-between border-t border-border pt-2">
                  <span className="font-medium">New Balance</span>
                  <span className="font-bold text-base">${newBalance.toFixed(2)} {currentCurrency}</span>
                </div>
              </div>

              <div className="bg-accent/30 rounded p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reason</span>
                  <span className="text-right max-w-[200px]">{fullReason}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Performed by</span>
                  <span className="font-mono text-xs">{operatorEmail}</span>
                </div>
              </div>

              <p className="text-sm text-yellow-400">
                This action will immediately update the member&apos;s credit balance. Are you sure?
              </p>
            </div>

            {error && (
              <div className="text-red-400 text-sm mb-3">{error}</div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setStep('input')}
                disabled={saving}
                className="px-4 py-2 text-sm border border-border rounded hover:bg-accent transition-colors"
              >
                Go Back
              </button>
              <button
                onClick={handleConfirmAndSubmit}
                disabled={saving}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors font-medium"
              >
                {saving ? 'Submitting...' : 'Confirm & Apply'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Intercom integration card
function IntercomCard({ userId, email }: { userId: string; email: string | null }) {
  const [contact, setContact] = useState<IntercomContact | null>(null);
  const [conversations, setConversations] = useState<IntercomConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchIntercom() {
      setLoading(true);
      setError(null);
      try {
        const [contactData, convData] = await Promise.all([
          api.getIntercomContact(userId),
          api.getIntercomConversations(userId),
        ]);
        if (cancelled) return;
        setContact(contactData);
        setConversations(convData);
      } catch {
        if (!cancelled) setError('Failed to load Intercom data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchIntercom();
    return () => { cancelled = true; };
  }, [userId]);

  // Build Intercom deep link — opens the contact search by email in Intercom dashboard
  const intercomSearchUrl = email
    ? `https://app.intercom.com/a/apps/_/users/segments/all-users?searchTerm=${encodeURIComponent(email)}`
    : null;

  const intercomContactUrl = contact?.intercom_id
    ? `https://app.intercom.com/a/apps/_/users/${contact.intercom_id}`
    : null;

  const profileUrl = intercomContactUrl || intercomSearchUrl;

  const conversationStateColors: Record<string, string> = {
    open: 'bg-blue-500/20 text-blue-400',
    closed: 'bg-zinc-500/20 text-zinc-400',
    snoozed: 'bg-yellow-500/20 text-yellow-400',
  };

  return (
    <div className="space-y-3">
      {/* Profile link */}
      {profileUrl && (
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 bg-accent/50 hover:bg-accent rounded-lg transition-colors text-sm group"
        >
          <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
          </svg>
          <span className="flex-1">View in Intercom</span>
          <svg className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}

      {/* Contact details */}
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading Intercom data...</p>
      ) : error ? (
        <p className="text-xs text-muted-foreground">{error}</p>
      ) : contact ? (
        <div className="space-y-2 text-sm">
          {contact.last_seen_at && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last seen</span>
              <span>{timeAgo(contact.last_seen_at)}</span>
            </div>
          )}
          {contact.location && (contact.location.city || contact.location.country) && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Location</span>
              <span>{[contact.location.city, contact.location.country].filter(Boolean).join(', ')}</span>
            </div>
          )}
          {contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {contact.tags.map((tag) => (
                <span key={tag} className="px-1.5 py-0.5 text-xs bg-accent rounded">{tag}</span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {email ? 'No Intercom contact found' : 'No email to search Intercom'}
        </p>
      )}

      {/* Recent conversations */}
      {conversations.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs text-muted-foreground font-medium">Recent Conversations</span>
          {conversations.slice(0, 5).map((conv) => (
            <a
              key={conv.id}
              href={`https://app.intercom.com/a/apps/_/inbox/inbox/all/conversations/${conv.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-accent/30 hover:bg-accent/50 rounded p-2 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className={cn('px-1.5 py-0.5 text-[10px] rounded', conversationStateColors[conv.state] || 'bg-zinc-500/20 text-zinc-400')}>
                  {conv.state}
                </span>
                <span className="text-xs truncate flex-1">
                  {conv.title || conv.source?.author?.name || 'Conversation'}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(conv.updated_at)}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomerIoCard({ email }: { email: string | null }) {
  const [person, setPerson] = useState<CustomerIoPerson | null>(null);
  const [activities, setActivities] = useState<CustomerIoActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!email) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchCustomerIo() {
      setLoading(true);
      try {
        const [personData, activityData] = await Promise.all([
          api.getCustomerIoPerson(email!),
          api.getCustomerIoActivities(email!),
        ]);
        if (cancelled) return;
        setPerson(personData);
        setActivities(activityData);
      } catch {
        // Silently fail — endpoints may not exist yet
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchCustomerIo();
    return () => { cancelled = true; };
  }, [email]);

  // Filter to just email-related activities
  const emailActivities = activities.filter(a =>
    ['sent_email', 'opened_email', 'clicked_email', 'bounced_email', 'delivered_email', 'dropped_email', 'spammed_email', 'unsubscribed_email'].includes(a.type)
  );

  // Compute email stats
  const sent = emailActivities.filter(a => a.type === 'sent_email').length;
  const opened = emailActivities.filter(a => a.type === 'opened_email').length;
  const clicked = emailActivities.filter(a => a.type === 'clicked_email').length;
  const bounced = emailActivities.filter(a => a.type === 'bounced_email').length;

  // Group recent emails by subject/name (dedupe opens/clicks per message)
  const recentMessages: { name: string; subject: string | null; timestamp: number; states: string[] }[] = [];
  const seen = new Set<string>();
  for (const a of emailActivities) {
    const key = a.delivery_id || `${a.campaign_id}-${a.subject}-${a.timestamp}`;
    if (!seen.has(key)) {
      seen.add(key);
      recentMessages.push({
        name: a.name || 'Unknown',
        subject: a.subject,
        timestamp: a.timestamp,
        states: emailActivities.filter(b => (b.delivery_id || `${b.campaign_id}-${b.subject}-${b.timestamp}`) === key).map(b => b.type),
      });
    }
  }
  // Sort newest first, limit to 8
  recentMessages.sort((a, b) => b.timestamp - a.timestamp);
  const displayMessages = recentMessages.slice(0, 8);

  const activityTypeIcons: Record<string, { color: string; label: string }> = {
    sent_email: { color: 'text-blue-400', label: 'Sent' },
    delivered_email: { color: 'text-green-400', label: 'Delivered' },
    opened_email: { color: 'text-green-400', label: 'Opened' },
    clicked_email: { color: 'text-emerald-400', label: 'Clicked' },
    bounced_email: { color: 'text-red-400', label: 'Bounced' },
    dropped_email: { color: 'text-red-400', label: 'Dropped' },
    spammed_email: { color: 'text-orange-400', label: 'Spam' },
    unsubscribed_email: { color: 'text-yellow-400', label: 'Unsub' },
  };

  // Customer.io deep link — search by email
  const cioProfileUrl = email
    ? `https://fly.customer.io/env/last/people?email=${encodeURIComponent(email)}`
    : null;

  return (
    <div className="space-y-3">
      {/* Profile link */}
      {cioProfileUrl && (
        <a
          href={cioProfileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 bg-accent/50 hover:bg-accent rounded-lg transition-colors text-sm group"
        >
          <svg className="w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          <span className="flex-1">View in Customer.io</span>
          <svg className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading email data...</p>
      ) : emailActivities.length === 0 && !person ? (
        <p className="text-xs text-muted-foreground">
          {email ? 'No email activity found' : 'No email to look up'}
        </p>
      ) : (
        <>
          {/* Email stats */}
          {sent > 0 && (
            <div className="grid grid-cols-4 gap-1.5">
              <div className="bg-accent/30 rounded p-1.5 text-center">
                <div className="text-sm font-semibold">{sent}</div>
                <div className="text-[10px] text-muted-foreground">Sent</div>
              </div>
              <div className="bg-accent/30 rounded p-1.5 text-center">
                <div className="text-sm font-semibold text-green-400">{opened}</div>
                <div className="text-[10px] text-muted-foreground">Opened</div>
              </div>
              <div className="bg-accent/30 rounded p-1.5 text-center">
                <div className="text-sm font-semibold text-emerald-400">{clicked}</div>
                <div className="text-[10px] text-muted-foreground">Clicked</div>
              </div>
              <div className="bg-accent/30 rounded p-1.5 text-center">
                <div className={cn("text-sm font-semibold", bounced > 0 ? "text-red-400" : "text-muted-foreground")}>{bounced}</div>
                <div className="text-[10px] text-muted-foreground">Bounced</div>
              </div>
            </div>
          )}

          {/* Subscription status */}
          {person && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Subscribed</span>
              <span className={person.unsubscribed ? 'text-red-400' : 'text-green-400'}>
                {person.unsubscribed ? 'Unsubscribed' : 'Yes'}
              </span>
            </div>
          )}

          {/* Recent messages */}
          {displayMessages.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground font-medium">Recent Emails</span>
              {displayMessages.map((msg, i) => {
                const bestState = msg.states.includes('clicked_email') ? 'clicked_email'
                  : msg.states.includes('opened_email') ? 'opened_email'
                  : msg.states.includes('bounced_email') ? 'bounced_email'
                  : msg.states.includes('delivered_email') ? 'delivered_email'
                  : 'sent_email';
                const info = activityTypeIcons[bestState] || { color: 'text-zinc-400', label: bestState };
                const dateStr = new Date(msg.timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                return (
                  <div key={`${msg.name}-${msg.timestamp}-${i}`} className="bg-accent/30 rounded p-2">
                    <div className="flex items-center gap-2">
                      <span className={cn('px-1.5 py-0.5 text-[10px] rounded bg-accent/50', info.color)}>
                        {info.label}
                      </span>
                      <span className="text-xs truncate flex-1">
                        {msg.subject || msg.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{dateStr}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Sub-components for each data type

function UserSettingsCard({ context, userId, onRefresh }: { context: MemberContext; userId: string; onRefresh?: () => void }) {
  const user = context.user;
  const { user: authUser } = useAuth();
  const [showCreditModal, setShowCreditModal] = useState(false);

  if (!user) return <p className="text-sm text-muted-foreground">No user settings available</p>;

  const displayBalance = Number(user.credit_balance) || 0;

  return (
    <>
    <div className="grid grid-cols-2 gap-2 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Subscription</span>
        <span className={cn(
          user.subscription_status === 'PAYING' ? 'text-green-400' : 'text-muted-foreground'
        )}>{user.subscription_status}</span>
      </div>
      <div className="col-span-2 flex justify-between items-center">
        <span className="text-muted-foreground">Credit Balance</span>
        <div className="flex items-center gap-2">
          <span>{formatMoney(displayBalance * 100, user.credit_currency)}</span>
          <button
            onClick={() => setShowCreditModal(true)}
            className="px-2 py-0.5 text-xs bg-accent hover:bg-accent/80 rounded transition-colors"
          >
            Adjust
          </button>
        </div>
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

    {showCreditModal && (
      <CreditAdjustmentModal
        userId={userId}
        currentBalance={displayBalance}
        currentCurrency={user.credit_currency}
        operatorEmail={authUser?.email || 'unknown'}
        onClose={() => setShowCreditModal(false)}
        onSuccess={() => {
          onRefresh?.();
        }}
      />
    )}
    </>
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

// EditBookingModal removed — replaced by BookingEditInline (see booking-edit-inline.tsx)

function BookingCard({ booking, watch, travellers, onRefresh }: { booking: BookingView; watch?: WatchView; travellers?: TravelerProfile[]; onRefresh?: () => void }) {
  const isHotel = booking.type?.toLowerCase() === 'hotel';
  const data = isHotel ? booking.hotel : booking.flight;

  const [showActions, setShowActions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [emailData, setEmailData] = useState<RawEmail | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailFetched, setEmailFetched] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleViewEmail() {
    if (emailFetched) {
      setShowEmail(!showEmail);
      return;
    }
    setShowEmail(true);
    setEmailFetched(true);
    setEmailLoading(true);
    setEmailError(null);
    const bookingType = isHotel ? 'hotel' as const : 'flight' as const;
    try {
      const data = await api.getEmailForBooking(bookingType, booking.id);
      setEmailData(data);
    } catch (err) {
      if ((err as { status?: number })?.status === 404) {
        setEmailError(null);
      } else {
        setEmailError(err instanceof Error ? err.message : 'Failed to load email');
      }
    } finally {
      setEmailLoading(false);
    }
  }

  const statusColors: Record<string, string> = {
    CONFIRMED: 'bg-green-500/20 text-green-400',
    CANCELLED: 'bg-red-500/20 text-red-400',
    PENDING: 'bg-yellow-500/20 text-yellow-400',
    IN_PROGRESS: 'bg-blue-500/20 text-blue-400',
  };

  async function handleRegenerateWatch() {
    setActionLoading('regenerate');
    setActionError(null);
    try {
      await api.regenerateWatch(booking.id);
      setShowActions(false);
      onRefresh?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to regenerate watch');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRetryWatch() {
    if (!watch) return;
    setActionLoading('retry');
    setActionError(null);
    try {
      await api.retryWatchNow(watch.id);
      onRefresh?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to retry watch');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTerminateWatch() {
    if (!watch) return;
    setActionLoading('terminate');
    setActionError(null);
    try {
      await api.terminateWatch(watch.id);
      onRefresh?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to terminate watch');
    } finally {
      setActionLoading(null);
    }
  }

  const watchHealth = watch ? getWatchHealthStatus(watch) : null;
  const isWatchActive = watch?.status?.toLowerCase() === 'active';

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
                setIsEditing(true);
                setShowActions(false);
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
            >
              Edit Booking
            </button>
            <button
              onClick={() => {
                handleViewEmail();
                setShowActions(false);
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
            >
              View Email
            </button>
          </div>
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

        {/* Embedded Watch Info */}
        {watch && isWatchActive ? (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">Watch</span>
                {watchHealth && (
                  <span className={cn('flex items-center gap-1 px-1.5 py-0.5 text-xs rounded', watchHealth.color)}>
                    <span>{watchHealth.icon}</span>
                    <span>{watchHealth.label}</span>
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              {watch.latest_observed_price && (
                <div>
                  <span className="text-muted-foreground">Last price: </span>
                  <span className="font-medium">
                    {formatMoney(watch.latest_observed_price.amount, watch.latest_observed_price.currency)}
                  </span>
                  {watch.latest_observed_at && (
                    <span className="text-muted-foreground"> ({timeAgo(watch.latest_observed_at)})</span>
                  )}
                </div>
              )}
              {!watch.latest_observed_price && watch.last_executed_at && (
                <div>
                  <span className="text-muted-foreground">Last price: </span>
                  <span>--</span>
                </div>
              )}
              {watch.next_due_at && (
                <div>
                  <span className="text-muted-foreground">Next check: </span>
                  <span>{formatTimeUntil(watch.next_due_at)}</span>
                </div>
              )}
              {watch.last_executed_at && (
                <div>
                  <span className="text-muted-foreground">Last check: </span>
                  <span>{timeAgo(watch.last_executed_at)}</span>
                  {watch.last_result && watch.last_result !== 'success' && (
                    <span className="text-yellow-400"> ({watch.last_result})</span>
                  )}
                </div>
              )}
            </div>
            {/* Watch actions */}
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleRetryWatch}
                disabled={!!actionLoading}
                className="px-2 py-1 text-xs bg-primary/20 text-primary hover:bg-primary/30 rounded transition-colors disabled:opacity-50"
              >
                {actionLoading === 'retry' ? 'Retrying...' : 'Retry Now'}
              </button>
              <button
                onClick={handleRegenerateWatch}
                disabled={!!actionLoading}
                className="px-2 py-1 text-xs bg-accent hover:bg-accent/80 rounded transition-colors disabled:opacity-50"
              >
                {actionLoading === 'regenerate' ? 'Regenerating...' : 'Regenerate'}
              </button>
              <button
                onClick={handleTerminateWatch}
                disabled={!!actionLoading}
                className="px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-colors disabled:opacity-50"
              >
                {actionLoading === 'terminate' ? 'Terminating...' : 'Terminate'}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-xs mt-2 pt-2 border-t border-border/50">
            <span className="text-yellow-400">No active monitoring</span>
            <button
              onClick={handleRegenerateWatch}
              disabled={!!actionLoading}
              className="ml-2 px-2 py-0.5 text-xs bg-accent hover:bg-accent/80 rounded transition-colors disabled:opacity-50"
            >
              {actionLoading === 'regenerate' ? 'Creating...' : 'Create Watch'}
            </button>
          </div>
        )}

        {actionError && (
          <div className="text-red-400 text-xs mt-1">{actionError}</div>
        )}
      </div>

      {/* Inline email viewer (from dropdown "View Email") */}
      {showEmail && !isEditing && (
        <div className="mt-2">
          {emailLoading && <p className="text-xs text-muted-foreground py-2">Loading email...</p>}
          {emailError && <div className="bg-red-500/10 rounded p-2 text-xs text-red-400">{emailError}</div>}
          {!emailLoading && !emailError && !emailData && emailFetched && (
            <div className="bg-accent/30 rounded p-2 text-xs text-muted-foreground">No source email found.</div>
          )}
          {emailData && !emailLoading && (
            <div className="bg-accent/30 rounded p-2 text-xs space-y-1">
              <div><span className="text-muted-foreground">From: </span>{emailData.from_address || 'N/A'}</div>
              <div><span className="text-muted-foreground">Subject: </span><span className="font-medium">{emailData.subject || 'N/A'}</span></div>
              {emailData.received_at && (
                <div><span className="text-muted-foreground">Received: </span>{new Date(emailData.received_at).toLocaleString()}</div>
              )}
              <div
                className="bg-background rounded p-2 mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs"
                dangerouslySetInnerHTML={{ __html: emailData.body || 'No content' }}
              />
            </div>
          )}
        </div>
      )}

      {/* Inline edit form */}
      {isEditing && (
        <div className="mt-2">
          <BookingEditInline
            booking={booking}
            travellers={travellers}
            onClose={() => setIsEditing(false)}
            onSave={() => onRefresh?.()}
          />
        </div>
      )}
    </>
  );
}

function TripCard({ trip, watches, travellers, onRefresh }: { trip: TripView; watches?: WatchView[]; travellers?: TravelerProfile[]; onRefresh?: () => void }) {
  const [expanded, setExpanded] = useState(false); // Default collapsed — click to expand

  const statusColors: Record<string, string> = {
    FUTURE: 'bg-blue-500/20 text-blue-400',
    IN_PROGRESS: 'bg-green-500/20 text-green-400',
    PAST: 'bg-gray-500/20 text-gray-400',
  };

  // Create a map of booking_id -> watch for quick lookup
  const watchByBookingId = new Map<string, WatchView>();
  watches?.forEach(w => {
    if (w.booking_id) {
      watchByBookingId.set(w.booking_id, w);
    }
  });

  return (
    <div className="bg-accent/30 rounded overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-2 text-left hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <svg
              className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', expanded && 'rotate-90')}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="font-medium text-sm">{trip.name || trip.destination || 'Unnamed Trip'}</span>
            <span className={cn('ml-1 px-1.5 py-0.5 text-xs rounded', statusColors[trip.status])}>
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
            <BookingCard
              key={booking.id}
              booking={booking}
              watch={watchByBookingId.get(booking.id) || (booking.watch_id ? watches?.find(w => w.id === booking.watch_id) : undefined)}
              travellers={travellers}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
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

function WatchCard({ watch, onRefresh }: { watch: WatchView; onRefresh?: () => void }) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const statusColors: Record<string, string> = {
    ACTIVE: 'bg-green-500/20 text-green-400',
    active: 'bg-green-500/20 text-green-400',
    PAUSED: 'bg-yellow-500/20 text-yellow-400',
    paused: 'bg-yellow-500/20 text-yellow-400',
    ENDED: 'bg-gray-500/20 text-gray-400',
    ended: 'bg-gray-500/20 text-gray-400',
  };

  const health = getWatchHealthStatus(watch);
  const isActive = watch.status?.toLowerCase() === 'active';

  async function handleRetryNow() {
    setActionLoading('retry');
    setActionError(null);
    try {
      await api.retryWatchNow(watch.id);
      onRefresh?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to retry watch');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTerminate() {
    setActionLoading('terminate');
    setActionError(null);
    try {
      await api.terminateWatch(watch.id);
      onRefresh?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to terminate watch');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRegenerate() {
    if (!watch.booking_id) return;
    setActionLoading('regenerate');
    setActionError(null);
    try {
      await api.regenerateWatch(watch.booking_id);
      onRefresh?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to regenerate watch');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="bg-accent/30 rounded p-3 text-sm">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{watch.watch_type}</span>
          <span className={cn('px-1.5 py-0.5 text-xs rounded', statusColors[watch.status] || 'bg-gray-500/20')}>
            {watch.status}
          </span>
          {watch.priority && (
            <span className="text-xs text-muted-foreground">{watch.priority}</span>
          )}
        </div>
        {/* Health indicator */}
        <div className={cn('flex items-center gap-1 px-2 py-0.5 text-xs rounded', health.color)}>
          <span>{health.icon}</span>
          <span>{health.label}</span>
        </div>
      </div>

      {/* Watch observability info */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
        {watch.latest_observed_price && (
          <div>
            <span className="text-muted-foreground">Last price: </span>
            <span className="font-medium">
              {formatMoney(watch.latest_observed_price.amount, watch.latest_observed_price.currency)}
            </span>
            {watch.latest_observed_at && (
              <span className="text-muted-foreground"> ({timeAgo(watch.latest_observed_at)})</span>
            )}
          </div>
        )}
        {!watch.latest_observed_price && watch.last_executed_at && (
          <div>
            <span className="text-muted-foreground">Last price: </span>
            <span>--</span>
          </div>
        )}
        {watch.next_due_at && isActive && (
          <div>
            <span className="text-muted-foreground">Next check: </span>
            <span>{formatTimeUntil(watch.next_due_at)}</span>
          </div>
        )}
        {watch.last_executed_at && (
          <div>
            <span className="text-muted-foreground">Last check: </span>
            <span>{timeAgo(watch.last_executed_at)}</span>
            {watch.last_result && watch.last_result !== 'success' && (
              <span className="text-yellow-400"> ({watch.last_result})</span>
            )}
          </div>
        )}
      </div>

      {/* Goal and threshold */}
      {watch.goal && <div className="text-xs text-muted-foreground mb-1">Goal: {watch.goal}</div>}
      {watch.threshold_amount && (
        <div className="text-xs mb-1">
          Threshold: {formatMoney(watch.threshold_amount, watch.threshold_currency)}
        </div>
      )}

      {/* Meta info */}
      <div className="text-xs text-muted-foreground mb-2">
        Created {timeAgo(watch.created_at)}
        {watch.source && ` · Source: ${watch.source}`}
      </div>

      {/* Action buttons */}
      {isActive && (
        <div className="flex gap-2 mt-2 pt-2 border-t border-border">
          <button
            onClick={handleRetryNow}
            disabled={!!actionLoading}
            className="px-2 py-1 text-xs bg-primary/20 text-primary hover:bg-primary/30 rounded transition-colors disabled:opacity-50"
          >
            {actionLoading === 'retry' ? 'Retrying...' : 'Retry Now'}
          </button>
          {watch.booking_id && (
            <button
              onClick={handleRegenerate}
              disabled={!!actionLoading}
              className="px-2 py-1 text-xs bg-accent hover:bg-accent/80 rounded transition-colors disabled:opacity-50"
            >
              {actionLoading === 'regenerate' ? 'Regenerating...' : 'Regenerate'}
            </button>
          )}
          <button
            onClick={handleTerminate}
            disabled={!!actionLoading}
            className="px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-colors disabled:opacity-50"
          >
            {actionLoading === 'terminate' ? 'Terminating...' : 'Terminate'}
          </button>
        </div>
      )}

      {actionError && (
        <div className="text-red-400 text-xs mt-2">{actionError}</div>
      )}
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

// Main component - Full page layout
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
    <div className="w-full">
      {/* Header with back button */}
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={onClose}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="text-sm">Back to search</span>
        </button>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="ml-auto flex items-center gap-2 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
          >
            <svg className={cn('w-4 h-4', loading && 'animate-spin')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        )}
      </div>

      {/* Member header info */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{member.name || 'Unknown'}</h1>
        <p className="text-muted-foreground">{member.email}</p>
      </div>

      {/* Loading/Error */}
      {loading && (
        <div className="text-center text-muted-foreground py-8">
          Loading member context...
        </div>
      )}

      {error && (
        <div className="bg-red-500/20 text-red-400 p-3 rounded-lg text-sm mb-6">
          {error}
        </div>
      )}

      {/* Two-column layout: sidebar + main content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left column - Member info, settings, comms, payments */}
        <div className="lg:col-span-3 space-y-4">
          {/* Basic Info Card */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="text-sm font-medium mb-3">Member Info</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">ID</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(member.id); }}
                  title="Click to copy"
                  className="font-mono text-xs hover:text-foreground transition-colors cursor-pointer text-right break-all"
                >
                  {member.id}
                </button>
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
                <span>{member.membership_status || 'None'}</span>
              </div>
              {member.membership_plan && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Plan</span>
                  <span>{member.membership_plan}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Joined</span>
                <span>{formatDate(member.created_at)}</span>
              </div>
              {context?.user_extras?.stripe_customer_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stripe</span>
                  <span className="font-mono text-xs">{context.user_extras.stripe_customer_id.slice(0, 12)}...</span>
                </div>
              )}
            </div>
          </div>

          {/* Intercom Card */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="text-sm font-medium mb-3">Intercom</h3>
            <IntercomCard userId={member.id} email={member.email} />
          </div>

          {/* Customer.io Card */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="text-sm font-medium mb-3">Customer.io</h3>
            <CustomerIoCard email={member.email} />
          </div>

          {context && (
            <>
              {/* Settings Card */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-sm font-medium mb-3">Settings</h3>
                <UserSettingsCard context={context} userId={member.id} onRefresh={onRefresh} />
              </div>

              {/* Activity Card */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-sm font-medium mb-3">Activity</h3>
                <UserContextCard userContext={context.user_context} />
              </div>

              {/* Travellers Card */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-sm font-medium mb-3">Travellers ({context.travellers.length})</h3>
                {context.travellers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No travellers</p>
                ) : (
                  <div className="space-y-2">
                    {context.travellers.map((t) => <TravelerCard key={t.id} traveler={t} />)}
                  </div>
                )}
              </div>

              {/* Referral Stats */}
              {context.referral_stats && (
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="text-sm font-medium mb-3">Referrals</h3>
                  <div className="space-y-2 text-sm">
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
                </div>
              )}

              {/* Communications */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-sm font-medium mb-3">Communications ({context.communications.length})</h3>
                {context.communications.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent communications</p>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {context.communications.map((comm) => (
                      <CommunicationCard key={comm.id} comm={comm} />
                    ))}
                  </div>
                )}
              </div>

              {/* Payment History */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-sm font-medium mb-3">Payments ({context.payment_records.length})</h3>
                {context.payment_records.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No payment records</p>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {context.payment_records.map((pay) => <PaymentCard key={pay.id} payment={pay} />)}
                  </div>
                )}
              </div>

              {/* Airline Credits */}
              {context.airline_credits.length > 0 && (
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="text-sm font-medium mb-3">Airline Credits ({context.airline_credits.length})</h3>
                  <div className="space-y-2">
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
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Main column - Trips, escalations, tasks, opportunities (wider for edit + email) */}
        <div className="lg:col-span-9 space-y-4">
          {context && (
            <>
              {/* Trips & Bookings - main focus, always first */}
              <Section title="Trips" count={context.trips.length} defaultOpen={false}>
                {context.trips.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No trips</p>
                ) : (
                  <>
                    {context.trips.map((trip) => (
                      <TripCard
                        key={trip.id}
                        trip={trip}
                        watches={context.watches}
                        travellers={context.travellers}
                        onRefresh={onRefresh}
                      />
                    ))}
                  </>
                )}
              </Section>

              {/* Escalations - only show if any exist */}
              {context.escalations.length > 0 && (
                <Section
                  title="Escalations"
                  count={context.escalations.length}
                  defaultOpen={openEscalations > 0}
                  badge={openEscalations > 0 ? { text: `${openEscalations} open`, variant: 'error' } : undefined}
                >
                  <>
                    {context.escalations.map((esc, idx) => (
                      <EscalationCard key={esc.id ?? `esc-${idx}`} escalation={esc} />
                    ))}
                  </>
                </Section>
              )}

              {/* Pending Tasks */}
              {context.pending_tasks.length > 0 && (
                <Section title="Pending Tasks" count={context.pending_tasks.length} defaultOpen>
                  <>
                    {context.pending_tasks.map((task, idx) => (
                      <TaskCard key={task.id ?? `task-${idx}`} task={task} />
                    ))}
                  </>
                </Section>
              )}

              {/* Opportunities */}
              {(context.flight_opportunities.length > 0 || context.hotel_opportunities.length > 0) && (
                <Section
                  title="Opportunities"
                  count={context.flight_opportunities.length + context.hotel_opportunities.length}
                  badge={{ text: 'Active', variant: 'success' }}
                  defaultOpen
                >
                  {[
                    ...context.flight_opportunities.map((opp) => (
                      <OpportunityCard key={`flight-${opp.id}`} opportunity={opp} type="flight" />
                    )),
                    ...context.hotel_opportunities.map((opp) => (
                      <OpportunityCard key={`hotel-${opp.id}`} opportunity={opp} type="hotel" />
                    )),
                  ]}
                </Section>
              )}
            </>
          )}
        </div>

      </div>
    </div>
  );
}
