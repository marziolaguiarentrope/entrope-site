'use client';

import { useState } from 'react';
import { Escalation, api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface EscalationDetailProps {
  escalation: Escalation;
  onClose: () => void;
  onUpdate: (escalation: Escalation) => void;
}

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString();
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

export function EscalationDetail({ escalation, onClose, onUpdate }: EscalationDetailProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [showResolveForm, setShowResolveForm] = useState(false);

  const isOpen = escalation.status === 'open';
  const isClaimed = escalation.status === 'claimed';
  const isResolved = escalation.status === 'resolved';

  const priorityColors: Record<string, string> = {
    urgent: 'bg-red-500/20 text-red-400',
    high: 'bg-orange-500/20 text-orange-400',
    normal: 'bg-blue-500/20 text-blue-400',
    low: 'bg-gray-500/20 text-gray-400',
  };

  const statusColors: Record<string, string> = {
    open: 'bg-yellow-500/20 text-yellow-400',
    claimed: 'bg-blue-500/20 text-blue-400',
    resolved: 'bg-green-500/20 text-green-400',
  };

  async function handleClaim() {
    setLoading(true);
    setError(null);
    try {
      const updated = await api.claimEscalation(escalation.id);
      onUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim');
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve() {
    if (!resolutionNotes.trim()) {
      setError('Resolution notes required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const updated = await api.resolveEscalation(escalation.id, resolutionNotes.trim());
      onUpdate(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve');
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
            <h2 className="text-lg font-semibold">Escalation</h2>
            <p className="text-sm text-muted-foreground">{escalation.type}</p>
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
          {/* Status & Priority */}
          <div className="flex items-center gap-2">
            <span className={cn('px-2 py-1 text-xs font-medium rounded uppercase', statusColors[escalation.status] || 'bg-gray-500/20 text-gray-400')}>
              {escalation.status}
            </span>
            <span className={cn('px-2 py-1 text-xs font-medium rounded uppercase', priorityColors[escalation.priority] || 'bg-gray-500/20 text-gray-400')}>
              {escalation.priority}
            </span>
            {escalation.claimed_by && (
              <span className="text-sm text-muted-foreground">
                by {escalation.claimed_by}
              </span>
            )}
          </div>

          {/* Reason */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Reason</h3>
            <div className="bg-accent/50 rounded-lg p-3">
              <p className="text-sm">{escalation.reason}</p>
            </div>
          </section>

          {/* Source */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Source</h3>
            <div className="bg-accent/50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type</span>
                <span className="font-medium">{escalation.source_type}</span>
              </div>
              {escalation.source_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ID</span>
                  <span className="font-mono text-sm">{escalation.source_id.slice(0, 8)}...</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">User</span>
                <span className="font-mono text-sm">{escalation.user_id.slice(0, 8)}...</span>
              </div>
            </div>
          </section>

          {/* Context (if available) */}
          {escalation.context && Object.keys(escalation.context).length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Context</h3>
              <div className="bg-accent/50 rounded-lg p-3">
                <pre className="text-xs overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(escalation.context, null, 2)}
                </pre>
              </div>
            </section>
          )}

          {/* Timestamps */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Timeline</h3>
            <div className="bg-accent/50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span className="text-sm">{formatDateTime(escalation.created_at)} ({timeAgo(escalation.created_at)})</span>
              </div>
              {escalation.claimed_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Claimed</span>
                  <span className="text-sm">{formatDateTime(escalation.claimed_at)}</span>
                </div>
              )}
              {escalation.resolved_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Resolved</span>
                  <span className="text-sm">{formatDateTime(escalation.resolved_at)}</span>
                </div>
              )}
            </div>
          </section>

          {/* Resolution Notes (if resolved) */}
          {isResolved && escalation.resolution_notes && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Resolution Notes</h3>
              <div className="bg-green-500/10 rounded-lg p-3">
                <p className="text-sm">{escalation.resolution_notes}</p>
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
          {isOpen && (
            <button
              onClick={handleClaim}
              disabled={loading}
              className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Claiming...' : 'Claim Escalation'}
            </button>
          )}

          {isClaimed && !showResolveForm && (
            <button
              onClick={() => setShowResolveForm(true)}
              className="w-full py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
            >
              Resolve Escalation
            </button>
          )}

          {isClaimed && showResolveForm && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Resolution Notes *</label>
                <textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="Describe how the escalation was resolved..."
                  rows={4}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleResolve}
                  disabled={loading}
                  className="flex-1 py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Resolving...' : 'Confirm Resolution'}
                </button>
                <button
                  onClick={() => setShowResolveForm(false)}
                  className="py-2 px-4 bg-accent text-foreground rounded-lg font-medium hover:bg-accent/80 transition-colors"
                >
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
