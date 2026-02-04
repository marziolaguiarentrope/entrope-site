'use client';

import { useState } from 'react';
import { HotelOpportunity, api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface HotelOpportunityDetailProps {
  opportunity: HotelOpportunity;
  variant: 'payment' | 'cancel';
  onClose: () => void;
  onUpdate: (opportunity: HotelOpportunity) => void;
}

export function HotelOpportunityDetail({
  opportunity,
  variant,
  onClose,
  onUpdate,
}: HotelOpportunityDetailProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString();
  };

  const formatMoney = (amount: number | null, currency: string | null) => {
    if (amount === null) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount / 100);
  };

  async function handleMarkCancelled() {
    if (!opportunity.old_booking_id) {
      setError('No booking ID available');
      return;
    }
    if (!notes.trim()) {
      setError('Please enter notes about the cancellation');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await api.markBookingCancelled(
        'hotel',
        opportunity.old_booking_id,
        notes.trim(),
        confirmationCode.trim() || undefined
      );
      // Update the opportunity status locally
      onUpdate({
        ...opportunity,
        old_booking_status: 'cancelled',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark as cancelled');
      setShowConfirm(false);
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
            <h2 className="text-lg font-semibold">
              {variant === 'cancel' ? 'Pending Cancellation' : 'Pending Payment'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {opportunity.hotel_name || 'Unknown Hotel'}
            </p>
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
          <div className="flex items-center gap-2">
            <span className={cn(
              'px-2 py-1 text-xs font-medium rounded',
              opportunity.old_booking_status === 'active' && 'bg-yellow-500/20 text-yellow-400',
              opportunity.old_booking_status === 'cancelled' && 'bg-green-500/20 text-green-400',
            )}>
              {opportunity.old_booking_status?.toUpperCase() || 'UNKNOWN'}
            </span>
            {opportunity.cancellation_capability && (
              <span className="text-xs text-muted-foreground">
                {opportunity.cancellation_capability === 'we_cancel' ? 'We cancel' : 'They cancel'}
              </span>
            )}
          </div>

          {/* Stay Details */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Stay Details</h3>
            <div className="bg-accent/50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Hotel</span>
                <span className="font-medium">{opportunity.hotel_name || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Check-in</span>
                <span>{formatDate(opportunity.check_in)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Check-out</span>
                <span>{formatDate(opportunity.check_out)}</span>
              </div>
            </div>
          </section>

          {/* Old Booking Info (for cancel) */}
          {variant === 'cancel' && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Booking to Cancel</h3>
              <div className="bg-accent/50 rounded-lg p-3 space-y-1">
                {opportunity.old_booking_provider && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Provider</span>
                    <span className="font-medium">{opportunity.old_booking_provider}</span>
                  </div>
                )}
                {opportunity.old_booking_confirmation_code && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Confirmation</span>
                    <span className="font-mono">{opportunity.old_booking_confirmation_code}</span>
                  </div>
                )}
                {opportunity.cancellation_scheduled_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cancel by</span>
                    <span className="text-orange-400 font-medium">
                      {formatDate(opportunity.cancellation_scheduled_at)}
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Payment Info (for payment) */}
          {variant === 'payment' && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Payment</h3>
              <div className="bg-accent/50 rounded-lg p-3 space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-medium">
                    {formatMoney(opportunity.payment_amount, opportunity.payment_currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span>{opportunity.payment_status || 'N/A'}</span>
                </div>
                {opportunity.payment_due_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Due</span>
                    <span>{formatDate(opportunity.payment_due_at)}</span>
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

          {/* Actions for cancel variant */}
          {variant === 'cancel' && opportunity.old_booking_status === 'active' && !showConfirm && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Cancellation Notes *
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g., Called hotel, cancelled successfully, ref #12345"
                  rows={3}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Cancellation Confirmation Code (optional)
                </label>
                <input
                  type="text"
                  value={confirmationCode}
                  onChange={(e) => setConfirmationCode(e.target.value)}
                  placeholder="e.g., CANC123456"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <button
                onClick={() => {
                  if (!notes.trim()) {
                    setError('Please enter notes about the cancellation');
                    return;
                  }
                  setError(null);
                  setShowConfirm(true);
                }}
                className="w-full py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
              >
                Mark as Cancelled
              </button>
            </div>
          )}

          {/* Confirmation */}
          {variant === 'cancel' && showConfirm && (
            <div className="space-y-4">
              <div className="bg-green-500/10 rounded-lg p-4">
                <h4 className="font-medium text-green-400 mb-2">Confirm Cancellation</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  You are marking this booking as cancelled:
                </p>
                <div className="text-sm space-y-1">
                  <p><span className="text-muted-foreground">Hotel:</span> {opportunity.hotel_name}</p>
                  {opportunity.old_booking_confirmation_code && (
                    <p><span className="text-muted-foreground">Conf:</span> {opportunity.old_booking_confirmation_code}</p>
                  )}
                  <p><span className="text-muted-foreground">Notes:</span> {notes}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleMarkCancelled}
                  disabled={loading}
                  className="flex-1 py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Saving...' : 'Yes, Mark Cancelled'}
                </button>
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={loading}
                  className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Already cancelled */}
          {opportunity.old_booking_status === 'cancelled' && (
            <div className="bg-green-500/10 rounded-lg p-4">
              <p className="text-green-400 font-medium">This booking has been cancelled.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
