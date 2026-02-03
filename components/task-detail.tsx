'use client';

import { useState } from 'react';
import { Task, api, RawEmail } from '@/lib/api';
import { cn } from '@/lib/utils';

interface EmailViewerProps {
  email: RawEmail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

function EmailViewer({ email, loading, error, onClose }: EmailViewerProps) {
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
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

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
        <div
          className="text-sm bg-background rounded p-3 max-h-64 overflow-y-auto whitespace-pre-wrap"
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

interface TaskDetailProps {
  task: Task;
  onClose: () => void;
  onUpdate: (task: Task) => void;
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount / 100);
}

function FlightRepriceDetail({ task, onClose, onUpdate }: TaskDetailProps) {
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

  // Predefined failure reasons
  const failureReasons = [
    { value: 'airline_refused', label: 'Airline refused to reprice' },
    { value: 'fare_unavailable', label: 'New fare no longer available' },
    { value: 'pnr_cancelled', label: 'PNR was cancelled' },
    { value: 'pnr_already_changed', label: 'PNR was already changed' },
    { value: 'customer_no_longer_wants', label: 'Customer no longer wants reprice' },
    { value: 'booking_in_past', label: 'Booking date has passed' },
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

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
      <div className="w-full max-w-lg bg-card border-l border-border h-full overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Flight Reprice</h2>
            <p className="text-sm text-muted-foreground">{data?.airline_code || 'N/A'} · {data?.pnr || 'N/A'}</p>
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
                <span className="font-mono font-medium">{data?.pnr || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Airline</span>
                <span className="font-medium">{data?.airline_name || data?.airline_code || 'N/A'}</span>
              </div>
            </div>
          </section>

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
    </div>
  );
}

function CompleteBookingDetail({ task, onClose, onUpdate }: TaskDetailProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [showBlockForm, setShowBlockForm] = useState(false);

  // Email viewer state
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState<RawEmail | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

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
      // Use getEmailForTask - requires operator to have claimed the task
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
      initial[field] = '';
    });
    return initial;
  });

  // Currency for money fields
  const [currency, setCurrency] = useState('USD');

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

  async function handleComplete() {
    // Validate all fields are filled
    const emptyFields = data.missing_fields.filter(f => !fieldValues[f]?.trim());
    if (emptyFields.length > 0) {
      setError(`Missing values for: ${emptyFields.join(', ')}`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Build response data with proper types
      const responseData: Record<string, unknown> = {};
      data.missing_fields.forEach(field => {
        const value = fieldValues[field].trim();
        if (field === 'cash_paid') {
          responseData[field] = {
            amount: Math.round(parseFloat(value) * 100),
            currency,
          };
        } else {
          responseData[field] = value;
        }
      });

      const updated = await api.completeTask(task.id, 'success', responseData);
      // onUpdate handles closing for completed/failed tasks
      onUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete');
    } finally {
      setLoading(false);
    }
  }

  async function handleBlock() {
    if (!blockReason.trim()) {
      setError('Block reason required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const updated = await api.blockTask(task.id, blockReason.trim());
      // onUpdate handles closing for blocked tasks
      onUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to block');
    } finally {
      setLoading(false);
    }
  }

  // Field metadata for rendering
  // TODO: hotel_name and booking_provider should be searchable dropdowns, not free text
  // Backend needs to provide:
  // - GET /hotels (or /properties) - searchable list of known hotels
  // - GET /booking-providers - list of supported OTAs/providers (Expedia, Hotels.com, Booking.com, etc.)
  // Similarly for flights: airline should come from a known list
  const fieldConfig: Record<string, { label: string; type: 'text' | 'date' | 'money'; placeholder: string }> = {
    hotel_name: { label: 'Hotel Name', type: 'text', placeholder: 'e.g., Marriott Downtown' }, // TODO: searchable dropdown
    check_in_date: { label: 'Check-in Date', type: 'date', placeholder: '' },
    check_out_date: { label: 'Check-out Date', type: 'date', placeholder: '' },
    cash_paid: { label: 'Cash Paid', type: 'money', placeholder: '0.00' },
    booking_provider: { label: 'Booking Provider', type: 'text', placeholder: 'e.g., Expedia, Hotels.com' }, // TODO: dropdown from known providers
    // Flight fields
    airline: { label: 'Airline', type: 'text', placeholder: 'e.g., Delta' }, // TODO: dropdown from known airlines
    airline_code: { label: 'Airline Code', type: 'text', placeholder: 'e.g., DL' },
    departure_date: { label: 'Departure Date', type: 'date', placeholder: '' },
    return_date: { label: 'Return Date', type: 'date', placeholder: '' },
    pnr: { label: 'PNR / Confirmation', type: 'text', placeholder: 'e.g., ABC123' },
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
      <div className="w-full max-w-lg bg-card border-l border-border h-full overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Complete Booking Data</h2>
            <p className="text-sm text-muted-foreground capitalize">{data.booking_type} · {data.booking_id.slice(0, 8)}</p>
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

          {/* Instructions */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Instructions</h3>
            <div className="bg-accent/50 rounded-lg p-3">
              <p className="text-sm">{data.instructions}</p>
            </div>
          </section>

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

          {/* Missing Fields */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Missing Fields</h3>
            <div className="flex flex-wrap gap-2">
              {data.missing_fields.map(field => (
                <span key={field} className="px-2 py-1 bg-orange-500/20 text-orange-400 text-xs rounded">
                  {fieldConfig[field]?.label || field}
                </span>
              ))}
            </div>
          </section>

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

          {isClaimed && !showBlockForm && (
            <div className="space-y-4">
              {data.missing_fields.map(field => {
                const config = fieldConfig[field] || { label: field, type: 'text', placeholder: '' };

                if (config.type === 'money') {
                  return (
                    <div key={field}>
                      <label className="block text-sm font-medium mb-1">{config.label}</label>
                      <div className="flex gap-2">
                        <select
                          value={currency}
                          onChange={(e) => setCurrency(e.target.value)}
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
                          value={fieldValues[field]}
                          onChange={(e) => setFieldValues({ ...fieldValues, [field]: e.target.value })}
                          placeholder={config.placeholder}
                          className="flex-1 px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                        />
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={field}>
                    <label className="block text-sm font-medium mb-1">{config.label}</label>
                    <input
                      type={config.type === 'date' ? 'date' : 'text'}
                      value={fieldValues[field]}
                      onChange={(e) => setFieldValues({ ...fieldValues, [field]: e.target.value })}
                      placeholder={config.placeholder}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                );
              })}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleComplete}
                  disabled={loading}
                  className="flex-1 py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Completing...' : 'Complete'}
                </button>
                <button
                  onClick={() => setShowBlockForm(true)}
                  className="py-2 px-4 bg-red-600/20 text-red-400 rounded-lg font-medium hover:bg-red-600/30 transition-colors"
                >
                  Block
                </button>
              </div>
            </div>
          )}

          {isClaimed && showBlockForm && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Block Reason *</label>
                <textarea
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Why can't this task be completed?"
                  rows={3}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleBlock}
                  disabled={loading}
                  className="flex-1 py-2 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Blocking...' : 'Block Task'}
                </button>
                <button
                  onClick={() => setShowBlockForm(false)}
                  className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors"
                >
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
    </div>
  );
}

export function TaskDetail({ task, onClose, onUpdate }: TaskDetailProps) {
  // Route to capability-specific detail view
  if (task.capability === 'flight_reprice') {
    return <FlightRepriceDetail task={task} onClose={onClose} onUpdate={onUpdate} />;
  }

  if (task.capability === 'complete_booking_data') {
    return <CompleteBookingDetail task={task} onClose={onClose} onUpdate={onUpdate} />;
  }

  // Generic fallback for other capabilities
  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
      <div className="w-full max-w-lg bg-card border-l border-border h-full overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{task.capability}</h2>
            <p className="text-sm text-muted-foreground">{task.id.slice(0, 8)}</p>
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
        <div className="p-4">
          <pre className="text-xs overflow-x-auto">
            {JSON.stringify(task, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
