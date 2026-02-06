'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api, MemberSummary, MemberContext } from '@/lib/api';
import { MemberDetail } from '@/components/member-detail';

export default function UserDetailPage() {
  const params = useParams();
  const userId = params.id as string;

  const [member, setMember] = useState<MemberSummary | null>(null);
  const [context, setContext] = useState<MemberContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUser = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const ctx = await api.getMember(userId);
      setContext(ctx);

      // Build MemberSummary from context data
      setMember({
        id: userId,
        email: ctx.user_extras?.email || null,
        phone_number: ctx.user_extras?.phone || null,
        name: ctx.user?.first_name || ctx.user_extras?.email || null,
        status: ctx.user?.subscription_status === 'PAYING' ? 'active' : 'active',
        membership_status: ctx.user?.subscription_status || null,
        membership_plan: null,
        created_at: ctx.user_extras?.created_at || '',
        has_active_escalation: ctx.escalations.some(e => e.status === 'open'),
        pending_opportunities: ctx.flight_opportunities.length + ctx.hotel_opportunities.length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  if (loading && !member) {
    return (
      <div className="text-center text-muted-foreground py-12">
        Loading user...
      </div>
    );
  }

  if (error && !member) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 mb-3">{error}</p>
        <button
          onClick={loadUser}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!member) return null;

  return (
    <MemberDetail
      member={member}
      context={context}
      onClose={() => { window.history.back(); }}
      onRefresh={loadUser}
      loading={loading}
      error={error}
    />
  );
}
