'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { api, Escalation } from '@/lib/api';
import { EscalationDetail } from '@/components/escalation-detail';

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

const priorityOrder: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function sortByPriority<T extends { priority: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aPriority = priorityOrder[a.priority] ?? 99;
    const bPriority = priorityOrder[b.priority] ?? 99;
    return aPriority - bPriority;
  });
}

function EscalationRow({ escalation, onClick }: { escalation: Escalation; onClick: () => void }) {
  const priorityColors: Record<string, string> = {
    urgent: 'text-red-400',
    high: 'text-orange-400',
    normal: 'text-foreground',
    low: 'text-muted-foreground',
  };

  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between py-3 px-4 border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <span className={cn('text-xs font-medium uppercase', priorityColors[escalation.priority] || 'text-foreground')}>
            {escalation.priority}
          </span>
          <span className="text-sm font-medium truncate">
            {escalation.type}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1 truncate">
          {escalation.reason}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {escalation.status} · {timeAgo(escalation.created_at)}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        {escalation.claimed_by ? `Claimed by ${escalation.claimed_by}` : 'Unclaimed'}
      </div>
    </div>
  );
}

export default function EscalationsPage() {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEscalation, setSelectedEscalation] = useState<Escalation | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const response = await api.listEscalations({ limit: 50 });
        setEscalations(sortByPriority(response.escalations));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Escalations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Issues requiring operator attention
        </p>
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
        ) : escalations.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            No escalations found
          </div>
        ) : (
          <div>
            {escalations.map((escalation) => (
              <EscalationRow
                key={escalation.id}
                escalation={escalation}
                onClick={() => setSelectedEscalation(escalation)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedEscalation && (
        <EscalationDetail
          escalation={selectedEscalation}
          onClose={() => setSelectedEscalation(null)}
          onUpdate={(updated) => {
            setEscalations(escalations.map(e => e.id === updated.id ? updated : e));
            setSelectedEscalation(updated);
          }}
        />
      )}
    </div>
  );
}
