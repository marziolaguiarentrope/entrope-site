'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Task, api, RawEmail, UserBasicInfo } from '@/lib/api';
import { cn, parseLocalDate } from '@/lib/utils';

// ── Email Search Utilities ────────────────────────────────

function highlightSearchInHtml(html: string, query: string, currentIdx: number): { html: string; total: number } {
  if (!query || query.length < 1) return { html, total: 0 };

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const container = doc.body.firstChild as HTMLElement;
  if (!container) return { html, total: 0 };

  let matchCount = 0;
  const lowerQuery = query.toLowerCase();

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      const lower = text.toLowerCase();
      if (!lower.includes(lowerQuery)) return;

      const frag = doc.createDocumentFragment();
      let lastIdx = 0;
      let pos = lower.indexOf(lowerQuery, lastIdx);

      while (pos !== -1) {
        if (pos > lastIdx) frag.appendChild(doc.createTextNode(text.slice(lastIdx, pos)));
        const mark = doc.createElement('mark');
        mark.id = `search-match-${matchCount}`;
        mark.className = matchCount === currentIdx ? 'search-highlight-current' : 'search-highlight';
        mark.textContent = text.slice(pos, pos + query.length);
        frag.appendChild(mark);
        matchCount++;
        lastIdx = pos + query.length;
        pos = lower.indexOf(lowerQuery, lastIdx);
      }
      if (lastIdx < text.length) frag.appendChild(doc.createTextNode(text.slice(lastIdx)));
      node.parentNode?.replaceChild(frag, node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as HTMLElement).tagName?.toLowerCase();
      if (tag === 'mark') return; // skip already-highlighted
      // Walk children in reverse to avoid index shift issues
      const children = Array.from(node.childNodes);
      children.forEach(walk);
    }
  }

  walk(container);
  return { html: container.innerHTML, total: matchCount };
}

// ── Email Content Renderer ────────────────────────────────

/** Detect whether a string contains HTML tags */
function isHtml(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str);
}

interface EmailContentProps {
  email: RawEmail;
  searchQuery: string;
  currentMatch: number;
  maxHeight?: string;
  bodyRef?: React.RefObject<HTMLDivElement | null>;
}

function EmailContent({ email, searchQuery, currentMatch, maxHeight, bodyRef }: EmailContentProps) {
  // Determine available body versions
  // Backend may return body_text + body_html (new), or just body (legacy)
  const hasExplicitVersions = !!(email.body_text || email.body_html);
  const textBody = hasExplicitVersions ? email.body_text : (!isHtml(email.body || '') ? email.body : null);
  const htmlBody = hasExplicitVersions ? email.body_html : (isHtml(email.body || '') ? email.body : null);
  const hasBothVersions = !!(textBody && htmlBody);

  // If only one version available via legacy body field, detect what it is
  // and show both toggle options only when backend provides both
  const canToggle = hasBothVersions;

  const [viewMode, setViewMode] = useState<'html' | 'text'>(htmlBody ? 'html' : 'text');

  const activeBody = viewMode === 'html' ? (htmlBody || email.body || '') : (textBody || email.body || '');

  const { html: bodyHtml, total } = useMemo(
    () => highlightSearchInHtml(activeBody || 'No content', searchQuery, currentMatch),
    [activeBody, searchQuery, currentMatch]
  );

  // Scroll current match into view
  useEffect(() => {
    if (total > 0 && searchQuery) {
      const el = document.getElementById(`search-match-${currentMatch}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentMatch, total, searchQuery]);

  return (
    <>
      <style>{`
        .search-highlight { background: rgba(250, 204, 21, 0.4); padding: 1px 0; border-radius: 2px; }
        .search-highlight-current { background: rgba(249, 115, 22, 0.6); padding: 1px 0; border-radius: 2px; }
        .email-html-render img { max-width: 100%; height: auto; }
        .email-html-render table { border-collapse: collapse; max-width: 100%; }
        .email-html-render a { color: oklch(0.7 0.15 250); text-decoration: underline; }
      `}</style>
      <div className="space-y-2 text-sm">
        <div>
          <span className="text-muted-foreground">From: </span>
          <span>{email.from_address || 'N/A'}</span>
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
        {/* View mode toggle */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1 rounded-lg bg-accent/30 p-0.5">
            <button
              onClick={() => setViewMode('html')}
              className={cn(
                "px-2.5 py-1 text-xs rounded-md transition-colors",
                viewMode === 'html'
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              HTML
            </button>
            <button
              onClick={() => setViewMode('text')}
              className={cn(
                "px-2.5 py-1 text-xs rounded-md transition-colors",
                viewMode === 'text'
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Plain Text
            </button>
          </div>
          {!canToggle && (
            <span className="text-[10px] text-muted-foreground">
              {viewMode === 'html' ? 'HTML only' : 'Text only'} — {viewMode === 'html' ? 'no plain text' : 'no HTML'} available
            </span>
          )}
        </div>

        {viewMode === 'html' && htmlBody ? (
          <div
            ref={bodyRef}
            className={cn(
              "text-sm bg-white rounded p-3 overflow-y-auto email-html-render",
              maxHeight || "max-h-64"
            )}
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        ) : (
          <div
            ref={bodyRef}
            className={cn(
              "text-sm bg-background rounded p-3 overflow-y-auto whitespace-pre-wrap",
              maxHeight || "max-h-64"
            )}
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        )}
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
    </>
  );
}

// ── Email Search Bar ──────────────────────────────────────

function EmailSearchBar({ query, onChange, total, currentIdx, onPrev, onNext, onClose }: {
  query: string; onChange: (q: string) => void; total: number; currentIdx: number;
  onPrev: () => void; onNext: () => void; onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-accent/50 rounded-lg border border-border">
      <svg className="w-4 h-4 text-muted-foreground shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search in email..."
        className="flex-1 bg-transparent text-sm focus:outline-none"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.shiftKey ? onPrev() : onNext(); } if (e.key === 'Escape') onClose(); }}
      />
      {query && total > 0 && (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {currentIdx + 1}/{total}
        </span>
      )}
      {query && total === 0 && (
        <span className="text-xs text-red-400 whitespace-nowrap">No matches</span>
      )}
      <button onClick={onPrev} className="p-0.5 text-muted-foreground hover:text-foreground" title="Previous (Shift+Enter)">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>
      <button onClick={onNext} className="p-0.5 text-muted-foreground hover:text-foreground" title="Next (Enter)">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <button onClick={onClose} className="p-0.5 text-muted-foreground hover:text-foreground">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ── Inline Email Viewer (non-fullscreen) ──────────────────

interface EmailViewerProps {
  email: RawEmail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onExpand?: () => void;
}

function EmailViewer({ email, loading, error, onClose, onExpand }: EmailViewerProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatch, setCurrentMatch] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);

  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
    setCurrentMatch(0);
  }, []);

  // Count matches
  useEffect(() => {
    if (!email?.body || !searchQuery) { setTotalMatches(0); return; }
    const { total } = highlightSearchInHtml(email.body, searchQuery, 0);
    setTotalMatches(total);
  }, [email?.body, searchQuery]);

  if (loading) {
    return (
      <div className="bg-accent/50 rounded-lg p-4">
        <p className="text-sm text-muted-foreground">Loading email...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 rounded-lg p-4">
        <div className="flex justify-between items-start">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  if (!email) return null;

  return (
    <div className="bg-accent/50 rounded-lg p-4 space-y-3">
      <div className="flex justify-between items-start">
        <h4 className="text-sm font-medium">Original Email</h4>
        <div className="flex gap-1">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Search in email"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          {onExpand && (
            <button
              onClick={onExpand}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Expand to fullscreen"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            </button>
          )}
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      {showSearch && (
        <EmailSearchBar
          query={searchQuery}
          onChange={handleSearchChange}
          total={totalMatches}
          currentIdx={currentMatch}
          onPrev={() => setCurrentMatch(i => (i - 1 + totalMatches) % Math.max(totalMatches, 1))}
          onNext={() => setCurrentMatch(i => (i + 1) % Math.max(totalMatches, 1))}
          onClose={() => { setShowSearch(false); setSearchQuery(''); }}
        />
      )}
      <EmailContent email={email} searchQuery={searchQuery} currentMatch={currentMatch} />
    </div>
  );
}

interface TaskDetailProps {
  task: Task;
  onClose: () => void;
  onUpdate: (task: Task) => void;
  // Queue optimization props (optional — other consumers ignore them)
  autoClaimedEmail?: RawEmail | null;
  autoClaimedEmailLoading?: boolean;
  autoClaimedEmailError?: string | null;
  onAdvanceToNext?: () => void;
  queuePosition?: { current: number; total: number } | null;
  defaultFullscreen?: boolean;
  renderInline?: boolean;
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount / 100);
}

// ── Customer Info Section (shared by all detail views) ────

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

function FlightRepriceDetail({ task, onClose, onUpdate, renderInline }: TaskDetailProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = task.request_data as {
    pnr?: string;
    airline_code?: string;
    airline_name?: string;
    passenger_name?: string;
    passenger_dob?: string;
    original_price?: { amount: number; currency: string };
    target_price?: { amount: number; currency: string };
    expected_credit?: { amount: number; currency: string };
    loyalty_number?: string;
    booking_id?: string;
  } | null;

  // Form state for completion - default to expected values
  const [refundAmount, setRefundAmount] = useState(() =>
    data?.expected_credit?.amount ? (data.expected_credit.amount / 100).toFixed(2) : '0.00'
  );
  const [refundCurrency, setRefundCurrency] = useState(() =>
    data?.expected_credit?.currency || 'USD'
  );
  const [failReason, setFailReason] = useState('');
  const [failReasonOther, setFailReasonOther] = useState('');
  const [showFailForm, setShowFailForm] = useState(false);
  const [showSuccessConfirm, setShowSuccessConfirm] = useState(false);
  const [showFailConfirm, setShowFailConfirm] = useState(false);

  // Failure reasons from backend, plus "other" option
  const failureReasons = [
    ...(task.valid_failure_reasons || []).map(reason => ({
      value: reason.toLowerCase().replace(/\s+/g, '_'),
      label: reason,
    })),
    { value: 'other', label: 'Other (specify)' },
  ];

  // Email viewer state
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState<RawEmail | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const isClaimed = task.status === 'claimed';
  const isPending = task.status === 'pending';

  async function handleViewEmail() {
    setShowEmail(true);
    setEmailLoading(true);
    setEmailError(null);

    try {
      // Use getEmailForTask - requires operator to have claimed the task
      const result = await api.getEmailForTask(task.id);
      setEmail(result);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to load email');
    } finally {
      setEmailLoading(false);
    }
  }

  async function handleClaim() {
    setLoading(true);
    setError(null);
    try {
      const updated = await api.claimTask(task.id);
      onUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim');
    } finally {
      setLoading(false);
    }
  }

  async function handleUnclaim() {
    setLoading(true);
    setError(null);
    try {
      const updated = await api.unclaimTask(task.id);
      onUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unclaim');
    } finally {
      setLoading(false);
    }
  }

  function handleCompleteClick() {
    const amount = parseFloat(refundAmount);
    if (isNaN(amount) || amount <= 0) {
      setError('Valid refund amount required');
      return;
    }
    setError(null);
    setShowSuccessConfirm(true);
  }

  async function handleCompleteConfirmed() {
    const amount = parseFloat(refundAmount);
    setLoading(true);
    setError(null);
    try {
      const updated = await api.completeTask(task.id, 'success', {
        // Use credit_amount/credit_currency to match TaskResponseData schema
        credit_amount: amount,  // major units (e.g., 50.00)
        credit_currency: refundCurrency,
      });
      // onUpdate handles closing for completed/failed tasks
      onUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete');
      setShowSuccessConfirm(false);
    } finally {
      setLoading(false);
    }
  }

  function handleFailClick() {
    if (!failReason) {
      setError('Please select a failure reason');
      return;
    }
    if (failReason === 'other' && !failReasonOther.trim()) {
      setError('Please specify the failure reason');
      return;
    }
    setError(null);
    setShowFailConfirm(true);
  }

  function getFailReasonText(): string {
    if (failReason === 'other') {
      return failReasonOther.trim();
    }
    const selected = failureReasons.find(r => r.value === failReason);
    return selected?.label || failReason;
  }

  async function handleFailConfirmed() {
    setLoading(true);
    setError(null);
    try {
      // Complete with denied outcome (valid outcomes: success, denied, partial, not_found)
      const updated = await api.completeTask(task.id, 'denied', {
        failure_reason: getFailReasonText(),
      });
      // onUpdate handles closing for completed/failed tasks
      onUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark as failed');
      setShowFailConfirm(false);
    } finally {
      setLoading(false);
    }
  }

  const panelContent = (
    <div className={renderInline ? "h-full overflow-y-auto" : "w-full max-w-lg bg-card border-l border-border h-full overflow-y-auto"}>
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Flight Reprice</h2>
            <p className="text-sm text-muted-foreground">{data?.airline_code || 'N/A'} · {data?.pnr || 'N/A'}</p>
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

        <div className="p-4 space-y-6">
          {/* Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn(
                'px-2 py-1 text-xs font-medium rounded',
                task.status === 'pending' && 'bg-yellow-500/20 text-yellow-400',
                task.status === 'claimed' && 'bg-blue-500/20 text-blue-400',
                task.status === 'completed' && 'bg-green-500/20 text-green-400',
                task.status === 'blocked' && 'bg-red-500/20 text-red-400',
                task.status === 'failed' && 'bg-red-500/20 text-red-400',
              )}>
                {task.status.toUpperCase()}
              </span>
              {task.claimed_by && (
                <span className="text-sm text-muted-foreground">
                  by {task.claimed_by}
                </span>
              )}
            </div>
            {isClaimed && (
              <button
                onClick={handleUnclaim}
                disabled={loading}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Release claim
              </button>
            )}
          </div>

          {/* Customer Info */}
          <CustomerInfoSection userId={task.user_id} />

          {/* Passenger Info */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Passenger</h3>
            <div className="bg-accent/50 rounded-lg p-3 space-y-1">
              <p className="font-medium">{data?.passenger_name || 'N/A'}</p>
              {data?.passenger_dob && (
                <p className="text-sm text-muted-foreground">DOB: {data.passenger_dob}</p>
              )}
              {data?.loyalty_number && (
                <p className="text-sm text-muted-foreground">Loyalty: {data.loyalty_number}</p>
              )}
            </div>
          </section>

          {/* Booking Info */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Booking</h3>
            <div className="bg-accent/50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">PNR</span>
                <span className="font-mono font-medium">{data?.pnr || task.flight_booking?.record_locator || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Airline</span>
                <span className="font-medium">{data?.airline_name || task.flight_booking?.airline || data?.airline_code || 'N/A'}</span>
              </div>
              {task.flight_booking?.booking_provider && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Booked via</span>
                  <span>{task.flight_booking.booking_provider}</span>
                </div>
              )}
            </div>
          </section>

          {/* Flight Itinerary - from hydrated booking */}
          {task.flight_booking && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Flight Details</h3>
              <div className="bg-accent/50 rounded-lg p-3 space-y-2">
                {task.flight_booking.origin_airport && task.flight_booking.destination_airport && (
                  <div className="flex justify-between items-center">
                    <span className="font-medium">
                      {task.flight_booking.origin_airport} → {task.flight_booking.destination_airport}
                    </span>
                    {task.flight_booking.cabin_class && (
                      <span className="text-xs px-2 py-0.5 bg-background rounded capitalize">
                        {task.flight_booking.cabin_class.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                )}
                {task.flight_booking.departure_time && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Departure</span>
                    <span>{new Date(task.flight_booking.departure_time).toLocaleString()}</span>
                  </div>
                )}
                {task.flight_booking.arrival_time && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Arrival</span>
                    <span>{new Date(task.flight_booking.arrival_time).toLocaleString()}</span>
                  </div>
                )}
                {task.flight_booking.passengers && task.flight_booking.passengers.length > 0 && (
                  <div className="pt-2 border-t border-border">
                    <span className="text-sm text-muted-foreground">Passengers: </span>
                    <span className="text-sm">
                      {task.flight_booking.passengers.map(p => p.name).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* View Original Email - only show when claimed (backend enforces via 403) */}
          {isClaimed && (
            <section>
              {!showEmail ? (
                <button
                  onClick={handleViewEmail}
                  className="w-full py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  View Original Email
                </button>
              ) : (
                <EmailViewer
                  email={email}
                  loading={emailLoading}
                  error={emailError}
                  onClose={() => {
                    setShowEmail(false);
                    setEmail(null);
                    setEmailError(null);
                  }}
                />
              )}
            </section>
          )}

          {/* Pricing */}
          {(data?.original_price || data?.target_price || data?.expected_credit) && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Pricing</h3>
              <div className="bg-accent/50 rounded-lg p-3 space-y-2">
                {data?.original_price && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Original Price</span>
                    <span>{formatMoney(data.original_price.amount, data.original_price.currency)}</span>
                  </div>
                )}
                {data?.target_price && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Target Price</span>
                    <span>{formatMoney(data.target_price.amount, data.target_price.currency)}</span>
                  </div>
                )}
                {data?.expected_credit && (
                  <div className="flex justify-between pt-2 border-t border-border">
                    <span className="font-medium">Expected Credit</span>
                    <span className="font-medium text-green-400">
                      {formatMoney(data.expected_credit.amount, data.expected_credit.currency)}
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-500/20 text-red-400 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          {isPending && (
            <button
              onClick={handleClaim}
              disabled={loading}
              className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Claiming...' : 'Claim Task'}
            </button>
          )}

          {isClaimed && !showFailForm && !showSuccessConfirm && !showFailConfirm && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Actual Refund Amount</label>
                <div className="flex gap-2">
                  <select
                    value={refundCurrency}
                    onChange={(e) => setRefundCurrency(e.target.value)}
                    className="px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="CAD">CAD</option>
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    className="flex-1 px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                  />
                </div>
                {data?.expected_credit && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Expected: {formatMoney(data.expected_credit.amount, data.expected_credit.currency)}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCompleteClick}
                  disabled={loading}
                  className="flex-1 py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  Complete
                </button>
                <button
                  onClick={() => setShowFailForm(true)}
                  className="py-2 px-4 bg-red-600/20 text-red-400 rounded-lg font-medium hover:bg-red-600/30 transition-colors"
                >
                  Fail
                </button>
              </div>
            </div>
          )}

          {/* Success Confirmation */}
          {isClaimed && showSuccessConfirm && (
            <div className="space-y-4">
              <div className="bg-green-500/10 rounded-lg p-4">
                <h4 className="font-medium text-green-400 mb-2">Confirm Completion</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  You are marking this reprice as successful with a refund of:
                </p>
                <p className="text-lg font-medium">
                  {refundCurrency} {parseFloat(refundAmount).toFixed(2)}
                </p>
                {data?.expected_credit && parseFloat(refundAmount) !== data.expected_credit.amount / 100 && (
                  <p className="text-xs text-yellow-400 mt-2">
                    Note: This differs from the expected {formatMoney(data.expected_credit.amount, data.expected_credit.currency)}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCompleteConfirmed}
                  disabled={loading}
                  className="flex-1 py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Completing...' : 'Yes, Complete'}
                </button>
                <button
                  onClick={() => setShowSuccessConfirm(false)}
                  disabled={loading}
                  className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {isClaimed && showFailForm && !showFailConfirm && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Failure Reason *</label>
                <select
                  value={failReason}
                  onChange={(e) => setFailReason(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select a reason...</option>
                  {failureReasons.map((reason) => (
                    <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>
                  ))}
                </select>
              </div>
              {failReason === 'other' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Specify Reason *</label>
                  <textarea
                    value={failReasonOther}
                    onChange={(e) => setFailReasonOther(e.target.value)}
                    placeholder="Describe why the reprice couldn't be completed"
                    rows={2}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleFailClick}
                  disabled={loading}
                  className="flex-1 py-2 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  Mark as Failed
                </button>
                <button
                  onClick={() => {
                    setShowFailForm(false);
                    setFailReason('');
                    setFailReasonOther('');
                  }}
                  className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Fail Confirmation */}
          {isClaimed && showFailConfirm && (
            <div className="space-y-4">
              <div className="bg-red-500/10 rounded-lg p-4">
                <h4 className="font-medium text-red-400 mb-2">Confirm Failure</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  You are marking this reprice as failed. This will close the task without a refund.
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Reason: </span>
                  {getFailReasonText()}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleFailConfirmed}
                  disabled={loading}
                  className="flex-1 py-2 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Failing...' : 'Yes, Mark Failed'}
                </button>
                <button
                  onClick={() => setShowFailConfirm(false)}
                  disabled={loading}
                  className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {task.status === 'completed' && task.response_data && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Result</h3>
              <div className="bg-green-500/10 rounded-lg p-3 space-y-1">
                <p className="text-sm text-green-400">Completed successfully</p>
                <pre className="text-xs text-muted-foreground overflow-x-auto">
                  {JSON.stringify(task.response_data, null, 2)}
                </pre>
              </div>
            </section>
          )}

          {task.status === 'blocked' && task.blocked_reason && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Block Reason</h3>
              <div className="bg-red-500/10 rounded-lg p-3">
                <p className="text-sm text-red-400">{task.blocked_reason}</p>
              </div>
            </section>
          )}
        </div>
      </div>
  );

  if (renderInline) {
    return panelContent;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
      {panelContent}
    </div>
  );
}

// ── Known Booking Data Card ───────────────────────────────

const HOTEL_CORE_FIELDS = ['hotel_name', 'check_in_date', 'check_out_date'];
const FLIGHT_CORE_FIELDS = ['departure_date', 'origin_airport', 'destination_airport'];

const HOTEL_ALL_FIELDS = ['hotel_name', 'city', 'check_in_date', 'check_out_date', 'room_type', 'cash_paid', 'booking_provider', 'confirmation_number'];
const FLIGHT_ALL_FIELDS = ['airline', 'origin_airport', 'destination_airport', 'departure_time', 'arrival_time', 'cabin_class', 'cash_paid', 'record_locator', 'booking_provider'];

function KnownBookingData({ task, missingFields, bookingType }: { task: Task; missingFields: string[]; bookingType: 'hotel' | 'flight' }) {
  const booking = bookingType === 'hotel' ? task.hotel_booking : task.flight_booking;
  if (!booking) return null;

  const allFields = bookingType === 'hotel' ? HOTEL_ALL_FIELDS : FLIGHT_ALL_FIELDS;
  const coreFields = bookingType === 'hotel' ? HOTEL_CORE_FIELDS : FLIGHT_CORE_FIELDS;
  const missingCore = missingFields.filter(f => coreFields.includes(f));
  const missingEnrich = missingFields.filter(f => !coreFields.includes(f));
  const filledCount = allFields.length - missingFields.filter(f => allFields.includes(f)).length;
  const pct = Math.round((filledCount / allFields.length) * 100);

  const fieldLabels: Record<string, string> = {
    hotel_name: 'Hotel', city: 'City', check_in_date: 'Check-in', check_out_date: 'Check-out',
    room_type: 'Room', cash_paid: 'Price', booking_provider: 'Provider', confirmation_number: 'Confirmation #',
    airline: 'Airline', origin_airport: 'Origin', destination_airport: 'Destination',
    departure_time: 'Departure', arrival_time: 'Arrival', cabin_class: 'Cabin',
    record_locator: 'PNR',
  };

  function getFieldValue(field: string): string | null {
    const b = booking as unknown as Record<string, unknown>;
    if (field === 'cash_paid') {
      const cp = b.cash_paid as { amount: number; currency: string } | null;
      return cp ? formatMoney(cp.amount, cp.currency) : null;
    }
    if (field === 'departure_time' || field === 'arrival_time' || field === 'check_in_date' || field === 'check_out_date') {
      const v = b[field] as string | null;
      return v ? parseLocalDate(v).toLocaleDateString() : null;
    }
    if (field === 'airline') {
      const code = b.airline_code as string | null;
      const name = b.airline as string | null;
      return name ? `${name}${code ? ` (${code})` : ''}` : code || null;
    }
    return (b[field] as string | null) || null;
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-muted-foreground">Known Booking Data</h3>
        <div className="flex items-center gap-2">
          {booking.source && (
            <span className="px-2 py-0.5 text-[10px] bg-blue-500/20 text-blue-400 rounded font-medium">
              {(booking.source as string).replace('_', ' ').toUpperCase()}
            </span>
          )}
        </div>
      </div>

      {/* Completeness bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">{filledCount}/{allFields.length} fields complete</span>
          <span className={cn(pct >= 80 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400')}>{pct}%</span>
        </div>
        <div className="h-1.5 bg-accent rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Core vs Enrichment missing */}
      {missingCore.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          <span className="text-[10px] text-red-400 font-medium mr-1">CORE:</span>
          {missingCore.map(f => (
            <span key={f} className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] rounded">{fieldLabels[f] || f}</span>
          ))}
        </div>
      )}
      {missingEnrich.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          <span className="text-[10px] text-yellow-400 font-medium mr-1">ENRICHMENT:</span>
          {missingEnrich.map(f => (
            <span key={f} className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-[10px] rounded">{fieldLabels[f] || f}</span>
          ))}
        </div>
      )}

      {/* Data table */}
      <div className="bg-accent/50 rounded-lg p-3 space-y-1.5">
        {allFields.map(field => {
          const isMissing = missingFields.includes(field);
          const value = getFieldValue(field);
          return (
            <div key={field} className="flex justify-between text-sm">
              <span className="text-muted-foreground">{fieldLabels[field] || field}</span>
              {isMissing ? (
                <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-xs rounded">MISSING</span>
              ) : (
                <span className="text-right truncate max-w-[60%]">{value || '—'}</span>
              )}
            </div>
          );
        })}

        {/* Guests / Passengers */}
        {bookingType === 'hotel' && task.hotel_booking?.guests && task.hotel_booking.guests.length > 0 && (
          <div className="flex justify-between text-sm pt-1 border-t border-border">
            <span className="text-muted-foreground">Guests</span>
            <span className="text-right truncate max-w-[60%]">
              {task.hotel_booking.guests.map((g: { name: string }) => g.name).join(', ')}
            </span>
          </div>
        )}
        {bookingType === 'flight' && task.flight_booking?.passengers && task.flight_booking.passengers.length > 0 && (
          <div className="flex justify-between text-sm pt-1 border-t border-border">
            <span className="text-muted-foreground">Passengers</span>
            <span className="text-right truncate max-w-[60%]">
              {task.flight_booking.passengers.map((p: { name: string }) => p.name).join(', ')}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Missing Field Form ────────────────────────────────────

const FIELD_CONFIG: Record<string, { label: string; type: 'text' | 'date' | 'money'; placeholder: string }> = {
  hotel_name: { label: 'Hotel Name', type: 'text', placeholder: 'e.g., Marriott Downtown' },
  check_in_date: { label: 'Check-in Date', type: 'date', placeholder: '' },
  check_out_date: { label: 'Check-out Date', type: 'date', placeholder: '' },
  cash_paid: { label: 'Cash Paid', type: 'money', placeholder: '0.00' },
  booking_provider: { label: 'Booking Provider', type: 'text', placeholder: 'e.g., Expedia, Hotels.com' },
  airline: { label: 'Airline', type: 'text', placeholder: 'e.g., Delta' },
  airline_code: { label: 'Airline Code', type: 'text', placeholder: 'e.g., DL' },
  departure_date: { label: 'Departure Date', type: 'date', placeholder: '' },
  return_date: { label: 'Return Date', type: 'date', placeholder: '' },
  pnr: { label: 'PNR / Confirmation', type: 'text', placeholder: 'e.g., ABC123' },
  departure_time: { label: 'Departure Time', type: 'text', placeholder: 'e.g., 2024-03-15T14:00' },
  record_locator: { label: 'Record Locator', type: 'text', placeholder: 'e.g., ABC123' },
  origin_airport: { label: 'Origin Airport', type: 'text', placeholder: 'e.g., JFK' },
  destination_airport: { label: 'Destination Airport', type: 'text', placeholder: 'e.g., LAX' },
  outbound_flight_numbers: { label: 'Outbound Flight Numbers', type: 'text', placeholder: 'e.g., DL 2606, AA 100' },
  inbound_flight_numbers: { label: 'Return Flight Numbers', type: 'text', placeholder: 'e.g., DL 1547, AA 101' },
};

// Maps each optional field to the field it should appear after
const OPTIONAL_FIELD_POSITION: Record<string, string> = {
  return_date: 'departure_date',
  inbound_flight_numbers: 'return_date',  // auto-added with return_date
};

// Extra fields always rendered for a booking type, positioned after a specific field
const EXTRA_REQUIRED_FIELDS: Record<string, { after: string; bookingType: string }> = {
  outbound_flight_numbers: { after: 'destination_airport', bookingType: 'flight' },
};

function MissingFieldForm({ fields, fieldValues, currency, onFieldChange, onCurrencyChange, optionalFields, addedOptionalFields, onAddOptionalField, onRemoveOptionalField, bookingType }: {
  fields: string[];
  fieldValues: Record<string, string>;
  currency: string;
  onFieldChange: (field: string, value: string) => void;
  onCurrencyChange: (c: string) => void;
  optionalFields?: string[];
  addedOptionalFields?: string[];
  onAddOptionalField?: (field: string) => void;
  onRemoveOptionalField?: (field: string) => void;
  bookingType?: string;
}) {
  // Replace cancellation_policy with refundability + free_cancellation_until
  const resolvedFields = fields.flatMap(f =>
    f === 'cancellation_policy' ? ['refundability', 'free_cancellation_until'] :
    f === 'refundability' ? ['refundability', 'free_cancellation_until'] :
    [f]
  );
  const uniqueFields = [...new Set(resolvedFields)];
  const added = addedOptionalFields || [];
  const available = (optionalFields || []).filter(f => !uniqueFields.includes(f) && !added.includes(f));

  // Render a single field (required or optional)
  function renderField(field: string, isOptional: boolean) {
    // Refundability toggle
    if (field === 'refundability') {
      return (
        <div key={field}>
          <label className="block text-sm font-medium mb-1">Refundable?</label>
          <div className="flex items-center gap-2">
            {([
              { value: 'refundable', label: 'Yes', activeClass: 'bg-green-500/20 text-green-400 border-green-500/30' },
              { value: 'non_refundable', label: 'No', activeClass: 'bg-red-500/20 text-red-400 border-red-500/30' },
              { value: 'unknown', label: 'Unknown', activeClass: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
            ] as const).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onFieldChange('refundability', opt.value)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded border transition-colors',
                  fieldValues['refundability'] === opt.value
                    ? opt.activeClass
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      );
    }

    // Free cancellation date — only show when refundable
    if (field === 'free_cancellation_until') {
      if (fieldValues['refundability'] !== 'refundable') return null;
      return (
        <div key={field}>
          <label className="block text-sm font-medium mb-1">Free Cancellation Until</label>
          <input
            type="date"
            value={fieldValues[field] || ''}
            onChange={(e) => onFieldChange(field, e.target.value)}
            className="w-full px-3 py-1.5 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          />
        </div>
      );
    }

    const config = FIELD_CONFIG[field] || { label: field, type: 'text' as const, placeholder: '' };

    if (config.type === 'money') {
      return (
        <div key={field}>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium">{config.label}</label>
            {isOptional && onRemoveOptionalField && (
              <button type="button" onClick={() => onRemoveOptionalField(field)}
                className="text-xs text-muted-foreground hover:text-red-400 transition-colors">Remove</button>
            )}
          </div>
          <div className="flex gap-2">
            <select
              value={currency}
              onChange={(e) => onCurrencyChange(e.target.value)}
              className="px-2 py-1.5 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="CAD">CAD</option>
            </select>
            <input
              type="number"
              step="0.01"
              min="0"
              value={fieldValues[field]}
              onChange={(e) => onFieldChange(field, e.target.value)}
              placeholder={config.placeholder}
              className="flex-1 px-3 py-1.5 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
            />
          </div>
        </div>
      );
    }

    return (
      <div key={field}>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium">{config.label}</label>
          {isOptional && onRemoveOptionalField && (
            <button type="button" onClick={() => onRemoveOptionalField(field)}
              className="text-xs text-muted-foreground hover:text-red-400 transition-colors">Remove</button>
          )}
        </div>
        <input
          type={config.type === 'date' ? 'date' : 'text'}
          value={fieldValues[field] || ''}
          onChange={(e) => onFieldChange(field, e.target.value)}
          placeholder={config.placeholder}
          className="w-full px-3 py-1.5 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
        />
      </div>
    );
  }

  // Render an "add" button for an optional field
  function renderAddButton(field: string) {
    if (!onAddOptionalField) return null;
    const config = FIELD_CONFIG[field];
    return (
      <button
        key={`add-${field}`}
        type="button"
        onClick={() => onAddOptionalField(field)}
        className="w-full py-1.5 px-3 border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors flex items-center justify-center gap-1.5"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add {config?.label || field}
      </button>
    );
  }

  // Get optional fields that should appear after a given field
  function getOptionalsAfter(anchorField: string): string[] {
    return [...(optionalFields || [])].filter(f => OPTIONAL_FIELD_POSITION[f] === anchorField);
  }

  // Get extra required fields for this booking type, positioned after a given field
  function getExtrasAfter(anchorField: string): string[] {
    return Object.entries(EXTRA_REQUIRED_FIELDS)
      .filter(([, cfg]) => cfg.after === anchorField && cfg.bookingType === bookingType)
      .map(([field]) => field);
  }

  // Recursively render a field and everything that should follow it
  function renderFieldAndFollowers(field: string, isOptional: boolean) {
    elements.push(renderField(field, isOptional));

    // Extra required fields after this one
    for (const extraField of getExtrasAfter(field)) {
      elements.push(renderField(extraField, false));
    }

    // Optional fields after this one
    for (const optField of getOptionalsAfter(field)) {
      if (added.includes(optField)) {
        // Render the added optional and recurse for anything chained after it
        renderFieldAndFollowers(optField, true);
      } else if (available.includes(optField)) {
        elements.push(renderAddButton(optField));
      }
    }
  }

  // Build the rendered elements
  const elements: React.ReactNode[] = [];
  for (const field of uniqueFields) {
    renderFieldAndFollowers(field, false);
  }

  // Any optional fields whose anchor isn't in the required fields — render at end
  const allRenderedAnchors = [...uniqueFields, ...added];
  const unpositionedAdded = added.filter(f => {
    const anchor = OPTIONAL_FIELD_POSITION[f];
    return !allRenderedAnchors.includes(anchor) || !uniqueFields.includes(anchor);
  }).filter(f => !elements.some(el => el && typeof el === 'object' && 'key' in el && el.key === f));
  const unpositioned = available.filter(f => {
    const anchor = OPTIONAL_FIELD_POSITION[f];
    return !uniqueFields.includes(anchor) && !added.includes(anchor);
  });

  return (
    <div className="space-y-3">
      {elements}
    </div>
  );
}

// ── CompleteBookingDetail ─────────────────────────────────

function CompleteBookingDetail({ task, onClose, onUpdate, autoClaimedEmail, autoClaimedEmailLoading, autoClaimedEmailError, onAdvanceToNext, queuePosition, defaultFullscreen, renderInline }: TaskDetailProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failReason, setFailReason] = useState('');
  const [failReasonOther, setFailReasonOther] = useState('');
  const [showFailForm, setShowFailForm] = useState(false);
  const [completionFlash, setCompletionFlash] = useState<'success' | 'fail' | null>(null);

  // Email viewer state — use pre-fetched if available
  const [showEmail, setShowEmail] = useState(!!autoClaimedEmail || !!autoClaimedEmailLoading);
  const [email, setEmail] = useState<RawEmail | null>(autoClaimedEmail || null);
  const [emailLoading, setEmailLoading] = useState(!!autoClaimedEmailLoading);
  const [emailError, setEmailError] = useState<string | null>(autoClaimedEmailError || null);

  // Sync pre-fetched email from parent
  useEffect(() => {
    if (autoClaimedEmail) { setEmail(autoClaimedEmail); setEmailLoading(false); setShowEmail(true); }
  }, [autoClaimedEmail]);
  useEffect(() => {
    if (autoClaimedEmailLoading !== undefined) { setEmailLoading(autoClaimedEmailLoading); if (autoClaimedEmailLoading) setShowEmail(true); }
  }, [autoClaimedEmailLoading]);
  useEffect(() => {
    if (autoClaimedEmailError) { setEmailError(autoClaimedEmailError); setEmailLoading(false); }
  }, [autoClaimedEmailError]);

  // Fullscreen split-pane state — default to fullscreen for queue mode
  const [isEmailFullscreen, setIsEmailFullscreen] = useState(defaultFullscreen || false);
  const [showEmailSearch, setShowEmailSearch] = useState(false);
  const [emailSearchQuery, setEmailSearchQuery] = useState('');
  const [emailSearchMatch, setEmailSearchMatch] = useState(0);
  const [emailSearchTotal, setEmailSearchTotal] = useState(0);

  // Failure reasons from backend + client-side additions
  const backendReasons = (task.valid_failure_reasons || []).map(reason => ({
    value: reason.toLowerCase().replace(/\s+/g, '_'),
    label: reason,
  }));
  // Add common reasons that the backend may not include yet
  const extraReasons = [
    { value: 'booking_in_the_past', label: 'Booking is in the past' },
  ].filter(r => !backendReasons.some(br => br.value === r.value));
  const failureReasons = [
    ...backendReasons,
    ...extraReasons,
    { value: 'other', label: 'Other (specify)' },
  ];

  const data = task.request_data as {
    booking_id: string;
    booking_type: 'hotel' | 'flight';
    instructions: string;
    missing_fields: string[];
    email_storage_path: string | null;
    email_id?: string;
  };

  async function handleViewEmail() {
    setShowEmail(true);
    setEmailLoading(true);
    setEmailError(null);

    try {
      const result = await api.getEmailForTask(task.id);
      setEmail(result);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to load email');
    } finally {
      setEmailLoading(false);
    }
  }

  // Form state for each missing field
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    data.missing_fields.forEach(field => {
      if (field === 'cancellation_policy' || field === 'refundability') {
        initial['refundability'] = '';
        initial['free_cancellation_until'] = '';
      } else {
        initial[field] = '';
      }
    });
    // Always include outbound flight numbers for flights
    if (data.booking_type === 'flight') {
      initial['outbound_flight_numbers'] = '';
      initial['inbound_flight_numbers'] = '';
    }
    return initial;
  });
  const [currency, setCurrency] = useState('USD');

  // Optional fields that contractors can add beyond what's in missing_fields
  // outbound_flight_numbers is always required for flights (not optional)
  // inbound_flight_numbers auto-appears when return_date is added (not separately addable)
  const optionalFields = data.booking_type === 'flight' ? ['return_date'] : [];
  const availableOptionalFields = optionalFields.filter(f => !data.missing_fields.includes(f));
  const [addedOptionalFields, setAddedOptionalFields] = useState<string[]>([]);

  const handleAddOptionalField = useCallback((field: string) => {
    setAddedOptionalFields(prev => {
      const next = [...prev, field];
      // Adding return_date also brings in inbound_flight_numbers
      if (field === 'return_date' && !next.includes('inbound_flight_numbers')) {
        next.push('inbound_flight_numbers');
      }
      return next;
    });
    setFieldValues(prev => {
      const next = { ...prev, [field]: '' };
      if (field === 'return_date') {
        next['inbound_flight_numbers'] = '';
      }
      return next;
    });
  }, []);

  const handleRemoveOptionalField = useCallback((field: string) => {
    setAddedOptionalFields(prev => {
      let next = prev.filter(f => f !== field);
      // Removing return_date also removes inbound_flight_numbers
      if (field === 'return_date') {
        next = next.filter(f => f !== 'inbound_flight_numbers');
      }
      return next;
    });
    setFieldValues(prev => {
      const next = { ...prev };
      delete next[field];
      if (field === 'return_date') {
        next['inbound_flight_numbers'] = '';
      }
      return next;
    });
  }, []);

  const isClaimed = task.status === 'claimed';
  const isPending = task.status === 'pending';

  async function handleClaim() {
    setLoading(true);
    setError(null);
    try {
      const updated = await api.claimTask(task.id);
      onUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim');
    } finally {
      setLoading(false);
    }
  }

  async function handleUnclaim() {
    setLoading(true);
    setError(null);
    try {
      const updated = await api.unclaimTask(task.id);
      onUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unclaim');
    } finally {
      setLoading(false);
    }
  }

  const handleComplete = useCallback(async () => {
    // Validate — refundability replaces cancellation_policy
    const emptyFields = data.missing_fields.filter(f => {
      if (f === 'cancellation_policy' || f === 'refundability') {
        return !fieldValues['refundability'];
      }
      return !fieldValues[f]?.trim();
    });
    // Validate extra required fields for flights
    if (data.booking_type === 'flight') {
      if (!fieldValues['outbound_flight_numbers']?.trim()) {
        emptyFields.push('outbound_flight_numbers');
      }
      if (addedOptionalFields.includes('return_date')) {
        if (!fieldValues['return_date']?.trim()) emptyFields.push('return_date');
        if (!fieldValues['inbound_flight_numbers']?.trim()) emptyFields.push('inbound_flight_numbers');
      }
    }
    if (emptyFields.length > 0) {
      const labels = emptyFields.map(f => {
        if (f === 'cancellation_policy' || f === 'refundability') return 'refundability';
        const config = FIELD_CONFIG[f];
        return config?.label || f;
      });
      setError(`Missing values for: ${[...new Set(labels)].join(', ')}`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const responseData: Record<string, unknown> = {};
      data.missing_fields.forEach(field => {
        if (field === 'cancellation_policy' || field === 'refundability') {
          // Send structured refundability data
          responseData['refundability'] = fieldValues['refundability'];
          responseData['free_cancellation_until'] = fieldValues['refundability'] === 'refundable' && fieldValues['free_cancellation_until']
            ? fieldValues['free_cancellation_until']
            : null;
          return;
        }
        const value = fieldValues[field].trim();
        if (field === 'cash_paid') {
          responseData[field] = { amount: Math.round(parseFloat(value) * 100), currency };
        } else {
          responseData[field] = value;
        }
      });
      // Always include outbound flight numbers for flights
      if (data.booking_type === 'flight' && fieldValues['outbound_flight_numbers']?.trim()) {
        responseData['outbound_flight_numbers'] = fieldValues['outbound_flight_numbers'].trim();
      }
      // Include optional fields
      addedOptionalFields.forEach(field => {
        const value = fieldValues[field]?.trim();
        if (value) {
          responseData[field] = value;
        }
      });
      const updated = await api.completeTask(task.id, 'success', responseData);
      setCompletionFlash('success');
      onUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete');
    } finally {
      setLoading(false);
    }
  }, [data.missing_fields, fieldValues, currency, task.id, onUpdate, addedOptionalFields]);

  function getFailReasonText(): string {
    if (failReason === 'other') return failReasonOther.trim();
    const selected = failureReasons.find(r => r.value === failReason);
    return selected?.label || failReason;
  }

  const handleFail = useCallback(async () => {
    if (!failReason) {
      setError('Please select a failure reason');
      return;
    }
    if (failReason === 'other' && !failReasonOther.trim()) {
      setError('Please specify the failure reason');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const updated = await api.completeTask(task.id, 'denied', { failure_reason: getFailReasonText() });
      setCompletionFlash('fail');
      onUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark as failed');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failReason, failReasonOther, task.id, onUpdate]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd/Ctrl+Enter: submit
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (isClaimed && !showFailForm && !loading) {
          handleComplete();
        }
      }
      // Escape: exit fullscreen or close panel
      if (e.key === 'Escape') {
        e.preventDefault();
        if (showEmailSearch) {
          setShowEmailSearch(false);
          setEmailSearchQuery('');
        } else if (isEmailFullscreen) {
          onClose();
        } else {
          onClose();
        }
      }
      // Cmd/Ctrl+F: search in email
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && isEmailFullscreen) {
        e.preventDefault();
        setShowEmailSearch(true);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isClaimed, showFailForm, loading, isEmailFullscreen, showEmailSearch, handleComplete, onClose]);

  // Count email search matches
  useEffect(() => {
    if (!email?.body || !emailSearchQuery) { setEmailSearchTotal(0); return; }
    const { total } = highlightSearchInHtml(email.body, emailSearchQuery, 0);
    setEmailSearchTotal(total);
  }, [email?.body, emailSearchQuery]);

  const handleFieldChange = useCallback((field: string, value: string) => {
    setFieldValues(prev => ({ ...prev, [field]: value }));
  }, []);

  // ── Fullscreen Split-Pane ──────────────────────────────

  if (isEmailFullscreen && (email || emailLoading || emailError)) {
    return (
      <div className={renderInline ? "flex h-full relative" : "fixed inset-0 z-50 bg-background flex relative"}>
        {/* Completion flash overlay */}
        {completionFlash && (
          <div className={cn(
            "absolute inset-0 z-10 flex items-center justify-center bg-background/80",
            completionFlash === 'success' ? 'text-green-400' : 'text-red-400'
          )}>
            <div className="text-center">
              <div className="text-3xl font-semibold mb-1">{completionFlash === 'success' ? '✓ Done' : '✗ Failed'}</div>
              {onAdvanceToNext && <div className="text-sm text-muted-foreground">Loading next task...</div>}
            </div>
          </div>
        )}
        {/* Left: Email */}
        <div className="w-3/5 border-r border-border flex flex-col">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h4 className="text-sm font-medium">Original Email</h4>
            <div className="flex gap-1">
              <button
                onClick={() => setShowEmailSearch(!showEmailSearch)}
                className={cn("p-1.5 rounded-lg transition-colors", showEmailSearch ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
                title="Search in email"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
              <button
                onClick={() => setIsEmailFullscreen(false)}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                title="Exit fullscreen"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                </svg>
              </button>
              <button
                onClick={() => { setIsEmailFullscreen(false); setShowEmail(false); setEmail(null); }}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                title="Close email"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          {showEmailSearch && (
            <div className="px-3 py-2 border-b border-border">
              <EmailSearchBar
                query={emailSearchQuery}
                onChange={(q) => { setEmailSearchQuery(q); setEmailSearchMatch(0); }}
                total={emailSearchTotal}
                currentIdx={emailSearchMatch}
                onPrev={() => setEmailSearchMatch(i => (i - 1 + emailSearchTotal) % Math.max(emailSearchTotal, 1))}
                onNext={() => setEmailSearchMatch(i => (i + 1) % Math.max(emailSearchTotal, 1))}
                onClose={() => { setShowEmailSearch(false); setEmailSearchQuery(''); }}
              />
            </div>
          )}
          {emailLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-2">
                <div className="w-8 h-8 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin mx-auto" />
                <p className="text-sm text-muted-foreground">Loading email...</p>
              </div>
            </div>
          ) : emailError ? (
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center space-y-2">
                <p className="text-sm text-red-400">{emailError}</p>
                <button
                  onClick={handleViewEmail}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : email ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <EmailContent email={email} searchQuery={emailSearchQuery} currentMatch={emailSearchMatch} maxHeight="flex-1" />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">No email available for this task</p>
            </div>
          )}
        </div>

        {/* Right: Form */}
        <div className="w-2/5 flex flex-col">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium">Complete Missing Fields</h4>
              <p className="text-xs text-muted-foreground capitalize">{data.booking_type} · {data.booking_id.slice(0, 8)}</p>
            </div>
            {queuePosition && (
              <span className="text-xs text-muted-foreground bg-accent/50 px-2 py-1 rounded">
                {queuePosition.current} of {queuePosition.total}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Compact known data in fullscreen */}
            <KnownBookingData task={task} missingFields={data.missing_fields} bookingType={data.booking_type} />

            {/* Error */}
            {error && (
              <div className="bg-red-500/20 text-red-400 p-2 rounded-lg text-sm">{error}</div>
            )}

            {/* Field inputs */}
            {isClaimed && !showFailForm && (
              <>
                <MissingFieldForm
                  fields={data.missing_fields}
                  fieldValues={fieldValues}
                  currency={currency}
                  onFieldChange={handleFieldChange}
                  onCurrencyChange={setCurrency}
                  optionalFields={availableOptionalFields}
                  addedOptionalFields={addedOptionalFields}
                  onAddOptionalField={handleAddOptionalField}
                  onRemoveOptionalField={handleRemoveOptionalField}
                  bookingType={data.booking_type}
                />
                <div className="flex gap-2 pt-2">
                  <button onClick={handleComplete} disabled={loading}
                    className="flex-1 py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors text-sm flex items-center justify-center gap-2">
                    {loading ? 'Completing...' : (
                      <>Complete <kbd className="text-[10px] bg-green-700/50 px-1 py-0.5 rounded">⌘↵</kbd></>
                    )}
                  </button>
                  <button onClick={() => setShowFailForm(true)}
                    className="py-2 px-4 bg-red-600/20 text-red-400 rounded-lg font-medium hover:bg-red-600/30 transition-colors text-sm">
                    Fail
                  </button>
                </div>
              </>
            )}

            {isClaimed && showFailForm && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Failure Reason *</label>
                  <select value={failReason} onChange={(e) => setFailReason(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm">
                    <option value="">Select a reason...</option>
                    {failureReasons.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
                  </select>
                </div>
                {failReason === 'other' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Specify Reason *</label>
                    <textarea value={failReasonOther} onChange={(e) => setFailReasonOther(e.target.value)}
                      placeholder="Why can't this booking data be completed?" rows={2}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm" />
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={handleFail} disabled={loading}
                    className="flex-1 py-2 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition-colors text-sm">
                    {loading ? 'Failing...' : 'Mark as Failed'}
                  </button>
                  <button onClick={() => { setShowFailForm(false); setFailReason(''); setFailReasonOther(''); }}
                    className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors text-sm">
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

  // ── Normal Side Panel View ─────────────────────────────

  const sidePanelContent = (
    <div className={renderInline ? "h-full overflow-y-auto" : "w-full max-w-lg bg-card border-l border-border h-full overflow-y-auto"}>
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Complete Booking Data</h2>
            <p className="text-sm text-muted-foreground capitalize">{data.booking_type} · {data.booking_id.slice(0, 8)}</p>
          </div>
          {!renderInline && (
            <button onClick={onClose} className="p-2 hover:bg-accent rounded-md transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="p-4 space-y-6">
          {/* Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn(
                'px-2 py-1 text-xs font-medium rounded',
                task.status === 'pending' && 'bg-yellow-500/20 text-yellow-400',
                task.status === 'claimed' && 'bg-blue-500/20 text-blue-400',
                task.status === 'completed' && 'bg-green-500/20 text-green-400',
                task.status === 'blocked' && 'bg-red-500/20 text-red-400',
              )}>
                {task.status.toUpperCase()}
              </span>
              {task.claimed_by && (
                <span className="text-sm text-muted-foreground">by {task.claimed_by}</span>
              )}
            </div>
            {isClaimed && (
              <button onClick={handleUnclaim} disabled={loading}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Release claim
              </button>
            )}
          </div>

          {/* Customer Info */}
          <CustomerInfoSection userId={task.user_id} />

          {/* Instructions */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Instructions</h3>
            <div className="bg-accent/50 rounded-lg p-3">
              <p className="text-sm">{data.instructions}</p>
            </div>
          </section>

          {/* Known Booking Data */}
          <KnownBookingData task={task} missingFields={data.missing_fields} bookingType={data.booking_type} />

          {/* View Original Email - only show when claimed */}
          {isClaimed && (
            <section>
              {!showEmail ? (
                <button onClick={handleViewEmail}
                  className="w-full py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  View Original Email
                </button>
              ) : (
                <EmailViewer
                  email={email}
                  loading={emailLoading}
                  error={emailError}
                  onClose={() => { setShowEmail(false); setEmail(null); setEmailError(null); }}
                  onExpand={() => setIsEmailFullscreen(true)}
                />
              )}
            </section>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-500/20 text-red-400 p-3 rounded-lg text-sm">{error}</div>
          )}

          {/* Actions */}
          {isPending && (
            <button onClick={handleClaim} disabled={loading}
              className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {loading ? 'Claiming...' : 'Claim Task'}
            </button>
          )}

          {isClaimed && !showFailForm && (
            <div className="space-y-4">
              <MissingFieldForm
                fields={data.missing_fields}
                fieldValues={fieldValues}
                currency={currency}
                onFieldChange={handleFieldChange}
                onCurrencyChange={setCurrency}
                optionalFields={availableOptionalFields}
                addedOptionalFields={addedOptionalFields}
                onAddOptionalField={handleAddOptionalField}
                onRemoveOptionalField={handleRemoveOptionalField}
                bookingType={data.booking_type}
              />
              <div className="flex gap-2 pt-2">
                <button onClick={handleComplete} disabled={loading}
                  className="flex-1 py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
                  {loading ? 'Completing...' : 'Complete'}
                </button>
                <button onClick={() => setShowFailForm(true)}
                  className="py-2 px-4 bg-red-600/20 text-red-400 rounded-lg font-medium hover:bg-red-600/30 transition-colors">
                  Fail
                </button>
              </div>
            </div>
          )}

          {isClaimed && showFailForm && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Failure Reason *</label>
                <select value={failReason} onChange={(e) => setFailReason(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
                  <option value="">Select a reason...</option>
                  {failureReasons.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
                </select>
              </div>
              {failReason === 'other' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Specify Reason *</label>
                  <textarea value={failReasonOther} onChange={(e) => setFailReasonOther(e.target.value)}
                    placeholder="Why can't this booking data be completed?" rows={2}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={handleFail} disabled={loading}
                  className="flex-1 py-2 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition-colors">
                  {loading ? 'Failing...' : 'Mark as Failed'}
                </button>
                <button onClick={() => { setShowFailForm(false); setFailReason(''); setFailReasonOther(''); }}
                  className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {task.status === 'completed' && task.response_data && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Completed Data</h3>
              <div className="bg-green-500/10 rounded-lg p-3">
                <pre className="text-xs text-muted-foreground overflow-x-auto">
                  {JSON.stringify(task.response_data, null, 2)}
                </pre>
              </div>
            </section>
          )}

          {task.status === 'blocked' && task.blocked_reason && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Block Reason</h3>
              <div className="bg-red-500/10 rounded-lg p-3">
                <p className="text-sm text-red-400">{task.blocked_reason}</p>
              </div>
            </section>
          )}
        </div>
      </div>
  );

  if (renderInline) {
    return sidePanelContent;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
      {sidePanelContent}
    </div>
  );
}

export function TaskDetail({ task, onClose, onUpdate, autoClaimedEmail, autoClaimedEmailLoading, autoClaimedEmailError, onAdvanceToNext, queuePosition, defaultFullscreen, renderInline }: TaskDetailProps) {
  // Route to capability-specific detail view
  if (task.capability === 'flight_reprice') {
    return <FlightRepriceDetail task={task} onClose={onClose} onUpdate={onUpdate} renderInline={renderInline} />;
  }

  if (task.capability === 'complete_booking_data') {
    return <CompleteBookingDetail
      task={task}
      onClose={onClose}
      onUpdate={onUpdate}
      autoClaimedEmail={autoClaimedEmail}
      autoClaimedEmailLoading={autoClaimedEmailLoading}
      autoClaimedEmailError={autoClaimedEmailError}
      onAdvanceToNext={onAdvanceToNext}
      queuePosition={queuePosition}
      defaultFullscreen={defaultFullscreen}
      renderInline={renderInline}
    />;
  }

  // Generic fallback for other capabilities
  const fallbackContent = (
    <div className={renderInline ? "h-full overflow-y-auto" : "w-full max-w-lg bg-card border-l border-border h-full overflow-y-auto"}>
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{task.capability}</h2>
            <p className="text-sm text-muted-foreground">{task.id.slice(0, 8)}</p>
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
          <CustomerInfoSection userId={task.user_id} />
          <pre className="text-xs overflow-x-auto">
            {JSON.stringify(task, null, 2)}
          </pre>
        </div>
      </div>
  );

  if (renderInline) {
    return fallbackContent;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
      {fallbackContent}
    </div>
  );
}
