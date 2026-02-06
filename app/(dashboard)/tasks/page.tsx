'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { api, Task, Escalation, HotelOpportunity } from '@/lib/api';
import { TaskDetail } from '@/components/task-detail';
import { EscalationDetail } from '@/components/escalation-detail';
import { HotelOpportunityDetail } from '@/components/hotel-opportunity-detail';

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

const tabs = [
  { id: 'flight_reprice', label: 'Flight Reprice', type: 'task', capability: 'flight_reprice' },
  { id: 'complete_booking', label: 'Complete Booking', type: 'task', capability: 'complete_booking_data' },
  { id: 'pending_payment', label: 'Pending Payment', type: 'hotel_opportunity' },
  { id: 'pending_cancel', label: 'Pending Cancel', type: 'hotel_opportunity' },
  { id: 'escalations', label: 'Escalations', type: 'escalation' },
] as const;

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

type TabId = typeof tabs[number]['id'];

function TaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const priorityColors: Record<string, string> = {
    urgent: 'text-red-400',
    high: 'text-orange-400',
    normal: 'text-foreground',
    low: 'text-muted-foreground',
  };

  // Core fields that make a booking unusable if missing
  const HOTEL_CORE = ['hotel_name', 'check_in_date', 'check_out_date'];
  const FLIGHT_CORE = ['departure_date', 'origin_airport', 'destination_airport'];

  // Extract display info based on capability
  const getDisplayInfo = () => {
    const data = task.request_data as Record<string, unknown>;
    if (task.capability === 'flight_reprice') {
      const airline = data.airline_code as string;
      const pnr = data.pnr as string;
      const passenger = data.passenger_name as string;
      return { title: `${airline} · ${pnr}`, subtitle: passenger, severity: null as string | null };
    }
    if (task.capability === 'complete_booking_data') {
      const bookingType = data.booking_type as string;
      const missingFields = (data.missing_fields as string[]) || [];
      const coreFields = bookingType === 'hotel' ? HOTEL_CORE : FLIGHT_CORE;
      const missingCore = missingFields.filter(f => coreFields.includes(f));
      const typeLabel = bookingType === 'hotel' ? 'Hotel' : 'Flight';
      const fieldLabels: Record<string, string> = {
        hotel_name: 'hotel name', check_in_date: 'check-in', check_out_date: 'check-out',
        cash_paid: 'price', booking_provider: 'provider', cancellation_policy: 'cancel policy',
        departure_date: 'departure', origin_airport: 'origin', destination_airport: 'destination',
        airline: 'airline', record_locator: 'PNR', departure_time: 'dep time',
      };
      const readable = missingFields.map(f => fieldLabels[f] || f).join(', ');
      const severity = missingCore.length > 0 ? 'core' : 'enrichment';
      return { title: `${typeLabel} Booking`, subtitle: `Missing: ${readable}`, severity };
    }
    return { title: task.booking_id || task.id.slice(0, 8), subtitle: task.capability, severity: null as string | null };
  };

  const { title, subtitle, severity } = getDisplayInfo();

  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between py-3 px-4 border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <span className={cn('text-xs font-medium uppercase', priorityColors[task.priority] || 'text-foreground')}>
            {task.priority}
          </span>
          <span className="text-sm font-medium truncate">
            {title}
          </span>
          {severity === 'core' && (
            <span className="px-1.5 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded font-medium">CORE MISSING</span>
          )}
          {severity === 'enrichment' && (
            <span className="px-1.5 py-0.5 text-[10px] bg-yellow-500/20 text-yellow-400 rounded font-medium">ENRICHMENT</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-1 truncate">
          {subtitle} · {task.status} · {timeAgo(task.created_at)}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        {task.claimed_by ? `Claimed by ${task.claimed_by}` : 'Unclaimed'}
      </div>
    </div>
  );
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

function HotelOpportunityRow({ opportunity, variant, onClick }: { opportunity: HotelOpportunity; variant: 'payment' | 'cancel'; onClick: () => void }) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString();
  };

  const formatMoney = (amount: number | null, currency: string | null) => {
    if (amount === null) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount / 100); // Assuming amount is in cents
  };

  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between py-3 px-4 border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium truncate">
            {opportunity.hotel_name || 'Unknown Hotel'}
          </span>
          {variant === 'payment' && opportunity.payment_status && (
            <span className={cn(
              'px-2 py-0.5 text-xs rounded',
              opportunity.payment_status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-orange-500/20 text-orange-400'
            )}>
              {opportunity.payment_status}
            </span>
          )}
          {variant === 'cancel' && (
            <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">
              Pending Cancel
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {formatDate(opportunity.check_in)} - {formatDate(opportunity.check_out)}
        </div>
        {variant === 'payment' && (
          <div className="text-xs text-muted-foreground mt-1">
            {formatMoney(opportunity.payment_amount, opportunity.payment_currency)}
            {opportunity.payment_due_at && ` · Due ${formatDate(opportunity.payment_due_at)}`}
          </div>
        )}
        {variant === 'cancel' && (
          <div className="text-xs text-muted-foreground mt-1">
            {opportunity.old_booking_provider && (
              <span>Booked via {opportunity.old_booking_provider}</span>
            )}
            {opportunity.old_booking_confirmation_code && (
              <span>{opportunity.old_booking_provider ? ' · ' : ''}Conf: {opportunity.old_booking_confirmation_code}</span>
            )}
            {opportunity.cancellation_scheduled_at && (
              <span className="text-orange-400">
                {(opportunity.old_booking_provider || opportunity.old_booking_confirmation_code) ? ' · ' : ''}
                Cancel by {formatDate(opportunity.cancellation_scheduled_at)}
              </span>
            )}
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

export default function TasksPage() {
  const [activeTab, setActiveTab] = useState<TabId>('flight_reprice');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [hotelOpportunities, setHotelOpportunities] = useState<HotelOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedEscalation, setSelectedEscalation] = useState<Escalation | null>(null);
  const [taskDetailLoading, setTaskDetailLoading] = useState(false);
  const [selectedHotelOpportunity, setSelectedHotelOpportunity] = useState<HotelOpportunity | null>(null);

  // Fetch full task details (with hydrated booking) when selecting a task
  async function handleSelectTask(task: Task) {
    setTaskDetailLoading(true);
    try {
      const fullTask = await api.getTask(task.id);
      setSelectedTask(fullTask);
    } catch (err) {
      // Fall back to the list task if fetch fails
      console.error('Failed to fetch task details:', err);
      setSelectedTask(task);
    } finally {
      setTaskDetailLoading(false);
    }
  }

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const tab = tabs.find(t => t.id === activeTab);

        if (tab?.type === 'escalation') {
          const response = await api.listEscalations({ limit: 50 });
          setEscalations(sortByPriority(response.escalations));
          setTasks([]);
          setHotelOpportunities([]);
        } else if (tab?.type === 'hotel_opportunity') {
          if (activeTab === 'pending_payment') {
            const response = await api.listHotelOpportunitiesPendingPayment({ limit: 50 });
            setHotelOpportunities(response.opportunities);
          } else if (activeTab === 'pending_cancel') {
            const response = await api.listHotelOpportunitiesPendingCancel({ limit: 50 });
            setHotelOpportunities(response.opportunities);
          }
          setTasks([]);
          setEscalations([]);
        } else if (tab?.type === 'task' && tab.capability) {
          // Don't filter by status - show pending and claimed tasks
          const response = await api.listTasks({
            capability: tab.capability,
            limit: 50
          });
          setTasks(sortByPriority(response.tasks));
          setEscalations([]);
          setHotelOpportunities([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [activeTab]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Tasks</h1>
      </div>

      {/* Tabs */}
      <div className="border-b border-border mb-6">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeTab === tab.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-muted-foreground">
            Loading...
          </div>
        ) : error ? (
          <div className="p-6 text-center text-red-400">
            {error}
          </div>
        ) : activeTab === 'escalations' ? (
          escalations.length === 0 ? (
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
          )
        ) : activeTab === 'pending_payment' || activeTab === 'pending_cancel' ? (
          hotelOpportunities.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              No {activeTab === 'pending_payment' ? 'pending payments' : 'pending cancellations'} found
            </div>
          ) : (
            <div>
              {hotelOpportunities.map((opp) => (
                <HotelOpportunityRow
                  key={opp.id}
                  opportunity={opp}
                  variant={activeTab === 'pending_payment' ? 'payment' : 'cancel'}
                  onClick={() => setSelectedHotelOpportunity(opp)}
                />
              ))}
            </div>
          )
        ) : tasks.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            No tasks found
          </div>
        ) : (
          <div>
            {activeTab === 'flight_reprice' && (
              <Link
                href="/complete-repricings"
                className="flex items-center justify-between px-4 py-2 bg-accent/30 border-b border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              >
                <span>View full repricings page with search, sort, and history →</span>
              </Link>
            )}
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} onClick={() => handleSelectTask(task)} />
            ))}
          </div>
        )}
      </div>

      {/* Task Detail Panel */}
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={(updated) => {
            // Remove completed/failed/blocked tasks from list, update others
            if (updated.status === 'completed' || updated.status === 'failed' || updated.status === 'blocked') {
              setTasks(prev => prev.filter(t => t.id !== updated.id));
              setSelectedTask(null);
            } else {
              setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
              setSelectedTask(updated);
            }
          }}
        />
      )}

      {/* Escalation Detail Panel */}
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

      {/* Hotel Opportunity Detail Panel */}
      {selectedHotelOpportunity && (
        <HotelOpportunityDetail
          opportunity={selectedHotelOpportunity}
          variant={activeTab === 'pending_payment' ? 'payment' : 'cancel'}
          onClose={() => setSelectedHotelOpportunity(null)}
          onUpdate={(updated) => {
            // Remove from list if cancelled
            if (updated.old_booking_status === 'cancelled') {
              setHotelOpportunities(prev => prev.filter(o => o.id !== updated.id));
              setSelectedHotelOpportunity(null);
            } else {
              setHotelOpportunities(prev => prev.map(o => o.id === updated.id ? updated : o));
              setSelectedHotelOpportunity(updated);
            }
          }}
        />
      )}
    </div>
  );
}
