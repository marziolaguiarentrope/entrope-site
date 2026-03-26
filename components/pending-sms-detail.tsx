'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { api, CommunicationView, PendingSms, PendingSmsDetail as PendingSmsDetailData } from '@/lib/api';
import { cn } from '@/lib/utils';

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

function formatDateTime(dateString: string | null): string {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleString();
}

function getCharacterCount(body: string | null): number {
  return body?.length ?? 0;
}

function getSegmentCount(body: string | null): number {
  const count = getCharacterCount(body);
  return count === 0 ? 0 : Math.ceil(count / 160);
}

function ApprovalBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: 'bg-yellow-500/20 text-yellow-400',
    APPROVED: 'bg-green-500/20 text-green-400',
    REJECTED: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs font-medium rounded', colors[status] || 'bg-zinc-500/20 text-zinc-300')}>
      {status}
    </span>
  );
}

function DeliveryBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: 'bg-zinc-500/20 text-zinc-300',
    SENT: 'bg-blue-500/20 text-blue-400',
    DELIVERED: 'bg-green-500/20 text-green-400',
    FAILED: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs font-medium rounded', colors[status] || 'bg-zinc-500/20 text-zinc-300')}>
      {status}
    </span>
  );
}

function CommunicationBubble({ comm }: { comm: CommunicationView }) {
  return (
    <div className={cn('rounded p-2 text-sm max-w-[85%]', comm.direction === 'OUTBOUND' ? 'bg-primary/20 ml-auto' : 'bg-accent/50')}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <span>{comm.channel}</span>
        <span>{comm.direction}</span>
        <span>{timeAgo(comm.created_at)}</span>
      </div>
      <div className="text-sm whitespace-pre-wrap break-words">{comm.content}</div>
    </div>
  );
}

interface PendingSmsDetailProps {
  detail: PendingSmsDetailData;
  onClose: () => void;
  onMessageUpdate: (message: PendingSms) => void;
  renderInline?: boolean;
}

export function PendingSmsDetail({
  detail,
  onClose,
  onMessageUpdate,
  renderInline,
}: PendingSmsDetailProps) {
  const message = detail.message;
  const canAct = message.approval_status === 'PENDING';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const memberHref = useMemo(
    () => detail.member_url || `/users-list/${message.user_id}`,
    [detail.member_url, message.user_id],
  );
  const characterCount = getCharacterCount(message.body);
  const segmentCount = getSegmentCount(message.body);

  async function handleApprove() {
    if (!canAct || loading) return;
    if (!window.confirm('Approve and send this text message?')) return;

    setLoading(true);
    setError(null);
    try {
      const updated = await api.approvePendingSms(message.id);
      onMessageUpdate({ ...message, ...updated });
      setShowReject(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve SMS');
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    if (!canAct || loading) return;
    const reason = rejectReason.trim();
    if (!reason) {
      setError('Rejection reason is required');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const updated = await api.rejectPendingSms(message.id, reason);
      onMessageUpdate({ ...message, ...updated });
      setShowReject(false);
      setRejectReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject SMS');
    } finally {
      setLoading(false);
    }
  }

  const content = (
    <>
      <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
        <div>
          <h2 className="text-lg font-semibold">Pending SMS</h2>
          <div className="flex items-center gap-2 mt-1">
            <ApprovalBadge status={message.approval_status} />
            <DeliveryBadge status={message.status} />
            <span className="text-xs text-muted-foreground">{timeAgo(message.created_at)}</span>
          </div>
        </div>
        {!renderInline && (
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-md transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        <section className="bg-accent/50 rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Draft SMS</p>
            <Link href={memberHref} className="text-xs text-primary hover:underline whitespace-nowrap">
              Member profile →
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-2 text-sm">
            <div className="flex gap-2">
              <span className="text-muted-foreground shrink-0">To</span>
              <span className="break-all">{message.to_email || message.to_name || 'Unknown recipient'}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground shrink-0">Phone</span>
              <span>{message.to_phone || '—'}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground shrink-0">Length</span>
              <span>{characterCount}/160 characters ({segmentCount} segment{segmentCount === 1 ? '' : 's'})</span>
            </div>
          </div>

          <div className="bg-background rounded-lg border border-border p-3">
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.body || '—'}</p>
          </div>
        </section>

        <section className="bg-accent/50 rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Brain Reasoning</p>
          {detail.brain_reasoning ? (
            <>
              {detail.brain_reasoning.headline && (
                <p className="text-sm font-medium">{detail.brain_reasoning.headline}</p>
              )}
              {detail.brain_reasoning.intent_summary && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{detail.brain_reasoning.intent_summary}</p>
              )}
              {detail.brain_reasoning.triggered_at && (
                <p className="text-xs text-muted-foreground">
                  Triggered {formatDateTime(detail.brain_reasoning.triggered_at)}
                </p>
              )}
              {!detail.brain_reasoning.headline && !detail.brain_reasoning.intent_summary && (
                <p className="text-sm text-muted-foreground">No reasoning text provided.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No reasoning data available.</p>
          )}
        </section>

        <section className="bg-accent/50 rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Recent Communications ({detail.recent_communications.length})
          </p>
          {detail.recent_communications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent communications.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {detail.recent_communications.map((comm) => (
                <CommunicationBubble key={comm.id} comm={comm} />
              ))}
            </div>
          )}
        </section>

        {error && (
          <div className="bg-red-500/20 text-red-400 rounded-lg p-3 text-sm">
            {error}
          </div>
        )}

        {message.approval_status === 'APPROVED' && message.status === 'FAILED' && message.error_message && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm">
            <p className="font-medium text-red-400">Approved but send failed</p>
            <p className="text-red-300 mt-1">{message.error_message}</p>
          </div>
        )}

        {canAct && (
          <section className="space-y-3">
            {!showReject ? (
              <div className="flex gap-2">
                <button
                  onClick={handleApprove}
                  disabled={loading}
                  className="flex-1 py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors text-sm"
                >
                  {loading ? 'Approving…' : 'Approve & Send'}
                </button>
                <button
                  onClick={() => { setShowReject(true); setError(null); }}
                  disabled={loading}
                  className="py-2 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition-colors text-sm"
                >
                  Reject
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-sm font-medium">Rejection reason *</label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  placeholder="Explain why this draft should be rejected..."
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleReject}
                    disabled={loading}
                    className="flex-1 py-2 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition-colors text-sm"
                  >
                    {loading ? 'Rejecting…' : 'Confirm Reject'}
                  </button>
                  <button
                    onClick={() => { setShowReject(false); setError(null); }}
                    disabled={loading}
                    className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {!canAct && (
          <div className="bg-accent/30 rounded-lg p-3 text-sm">
            <p className="font-medium">
              {message.approval_status === 'APPROVED' ? 'SMS approved' : 'SMS rejected'}
            </p>
            <p className="text-muted-foreground mt-1">
              Decision by {message.decided_by || 'unknown'} at {formatDateTime(message.decided_at)}
            </p>
            {message.rejection_reason && (
              <p className="text-red-300 mt-2">Reason: {message.rejection_reason}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Drafted {formatDateTime(message.created_at)}</span>
          {message.decided_at && <span>Decided {formatDateTime(message.decided_at)}</span>}
          {message.sent_at && <span>Sent {formatDateTime(message.sent_at)}</span>}
        </div>
      </div>
    </>
  );

  if (renderInline) return <div className="h-full overflow-y-auto">{content}</div>;

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
      <div className="w-full max-w-2xl bg-card border-l border-border h-full overflow-y-auto">
        {content}
      </div>
    </div>
  );
}
