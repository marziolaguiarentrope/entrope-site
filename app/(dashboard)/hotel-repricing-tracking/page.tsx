'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { api, HotelOpportunity } from '@/lib/api';

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

type FilterType = 'all' | 'pending_payment' | 'pending_cancel';

function HotelOpportunityRow({ opportunity }: { opportunity: HotelOpportunity & { filter_type: FilterType } }) {
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

  const isPendingPayment = opportunity.filter_type === 'pending_payment';

  return (
    <div className="flex items-center justify-between py-3 px-4 border-b border-border last:border-0 hover:bg-accent/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium truncate">
            {opportunity.hotel_name || 'Unknown Hotel'}
          </span>
          {isPendingPayment && opportunity.payment_status && (
            <span className={cn(
              'px-2 py-0.5 text-xs rounded',
              opportunity.payment_status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-orange-500/20 text-orange-400'
            )}>
              {opportunity.payment_status}
            </span>
          )}
          {!isPendingPayment && (
            <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">
              Pending Cancel
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {formatDate(opportunity.check_in)} - {formatDate(opportunity.check_out)}
        </div>
        {isPendingPayment && (
          <div className="text-xs text-muted-foreground mt-1">
            {formatMoney(opportunity.payment_amount, opportunity.payment_currency)}
            {opportunity.payment_due_at && ` · Due ${formatDate(opportunity.payment_due_at)}`}
          </div>
        )}
      </div>
      <div className="text-right">
        <div className="text-xs text-muted-foreground">
          {opportunity.status}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {timeAgo(opportunity.created_at)}
        </div>
      </div>
    </div>
  );
}

export default function HotelRepricingTrackingPage() {
  const [filter, setFilter] = useState<FilterType>('all');
  const [opportunities, setOpportunities] = useState<(HotelOpportunity & { filter_type: FilterType })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        if (filter === 'all') {
          const [paymentRes, cancelRes] = await Promise.all([
            api.listHotelOpportunitiesPendingPayment({ limit: 50 }),
            api.listHotelOpportunitiesPendingCancel({ limit: 50 }),
          ]);
          const combined = [
            ...paymentRes.opportunities.map(o => ({ ...o, filter_type: 'pending_payment' as FilterType })),
            ...cancelRes.opportunities.map(o => ({ ...o, filter_type: 'pending_cancel' as FilterType })),
          ];
          // Sort by created_at descending
          combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          setOpportunities(combined);
        } else if (filter === 'pending_payment') {
          const response = await api.listHotelOpportunitiesPendingPayment({ limit: 50 });
          setOpportunities(response.opportunities.map(o => ({ ...o, filter_type: 'pending_payment' as FilterType })));
        } else {
          const response = await api.listHotelOpportunitiesPendingCancel({ limit: 50 });
          setOpportunities(response.opportunities.map(o => ({ ...o, filter_type: 'pending_cancel' as FilterType })));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [filter]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Hotel Repricing Tracking</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track payment status and cancellations for hotel repricings
        </p>
      </div>

      {/* Filter tabs */}
      <div className="border-b border-border mb-6">
        <div className="flex gap-1">
          {[
            { id: 'all', label: 'All' },
            { id: 'pending_payment', label: 'Pending Payment' },
            { id: 'pending_cancel', label: 'Pending Cancel' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id as FilterType)}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                filter === tab.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-muted-foreground">
            Loading...
          </div>
        ) : error ? (
          <div className="p-6 text-center text-red-400">
            {error}
          </div>
        ) : opportunities.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            No hotel repricings found
          </div>
        ) : (
          <div>
            {opportunities.map((opp) => (
              <HotelOpportunityRow key={opp.id} opportunity={opp} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
