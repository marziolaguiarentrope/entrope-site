'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { api, Task, Escalation } from '@/lib/api';
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

// TODO: Add tabs for hotel operations once backend endpoints exist:
// - "Pending Payment" - hotel opportunities with payment_status in ('pending', 'awaiting_card')
// - "Pending Cancel" - hotel opportunities with old_booking_status='active' + cancellation_capability='we_cancel'
// Backend needs: GET /opportunities/hotels?payment_status=pending and GET /opportunities/hotels?pending_cancellation=true
const tabs = [
  { id: 'flight_reprice', label: 'Flight Reprice', capability: 'flight_reprice' },
  { id: 'complete_booking', label: 'Complete Booking', capability: 'complete_booking_data' },
  { id: 'escalations', label: 'Escalations', capability: null },
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

export default function TasksPage() {
  const [activeTab, setActiveTab] = useState<TabId>('flight_reprice');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const tab = tabs.find(t => t.id === activeTab);

        if (activeTab === 'escalations') {
          const response = await api.listEscalations({ limit: 50 });
          setEscalations(response.escalations);
          setTasks([]);
        } else if (tab?.capability) {
          const response = await api.listTasks({
            capability: tab.capability,
            status: 'pending',
            limit: 50
          });
          setTasks(response.tasks);
          setEscalations([]);
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
