'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { api, Task, Escalation, HotelOpportunity } from '@/lib/api';
import { TaskDetail } from '@/components/task-detail';

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

type TabId = typeof tabs[number]['id'];

function TaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const priorityColors: Record<string, string> = {
    urgent: 'text-red-400',
    high: 'text-orange-400',
    normal: 'text-foreground',
    low: 'text-muted-foreground',
  };

  // Extract display info based on capability
  const getDisplayInfo = () => {
    const data = task.request_data as Record<string, unknown>;
    if (task.capability === 'flight_reprice') {
      const airline = data.airline_code as string;
      const pnr = data.pnr as string;
      const passenger = data.passenger_name as string;
      return { title: `${airline} · ${pnr}`, subtitle: passenger };
    }
    return { title: task.booking_id || task.id.slice(0, 8), subtitle: task.capability };
  };

  const { title, subtitle } = getDisplayInfo();

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
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {subtitle} · {task.status} · {timeAgo(task.created_at)}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        {task.claimed_by ? `Claimed by ${task.claimed_by}` : 'Unclaimed'}
      </div>
    </div>
  );
}

function EscalationRow({ escalation }: { escalation: Escalation }) {
  const priorityColors: Record<string, string> = {
    urgent: 'text-red-400',
    high: 'text-orange-400',
    normal: 'text-foreground',
    low: 'text-muted-foreground',
  };

  return (
    <div className="flex items-center justify-between py-3 px-4 border-b border-border last:border-0 hover:bg-accent/50 transition-colors">
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

function HotelOpportunityRow({ opportunity, variant }: { opportunity: HotelOpportunity; variant: 'payment' | 'cancel' }) {
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
    <div className="flex items-center justify-between py-3 px-4 border-b border-border last:border-0 hover:bg-accent/50 transition-colors">
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

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const tab = tabs.find(t => t.id === activeTab);

        if (tab?.type === 'escalation') {
          const response = await api.listEscalations({ limit: 50 });
          setEscalations(response.escalations);
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
          const response = await api.listTasks({
            capability: tab.capability,
            status: 'pending',
            limit: 50
          });
          setTasks(response.tasks);
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
                <EscalationRow key={escalation.id} escalation={escalation} />
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
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} onClick={() => setSelectedTask(task)} />
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
            setTasks(tasks.map(t => t.id === updated.id ? updated : t));
            setSelectedTask(updated);
          }}
        />
      )}
    </div>
  );
}
