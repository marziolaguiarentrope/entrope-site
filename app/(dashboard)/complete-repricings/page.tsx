'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { api, Task } from '@/lib/api';
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

function TaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const priorityColors: Record<string, string> = {
    urgent: 'text-red-400',
    high: 'text-orange-400',
    normal: 'text-foreground',
    low: 'text-muted-foreground',
  };

  const data = task.request_data as Record<string, unknown>;
  const airline = data.airline_code as string;
  const pnr = data.pnr as string;
  const passenger = data.passenger_name as string;

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
            {airline} · {pnr}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {passenger} · {task.status} · {timeAgo(task.created_at)}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        {task.claimed_by ? `Claimed by ${task.claimed_by}` : 'Unclaimed'}
      </div>
    </div>
  );
}

export default function CompleteRepricingsPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const response = await api.listTasks({
          capability: 'flight_reprice',
          status: 'pending',
          limit: 50
        });
        setTasks(sortByPriority(response.tasks));
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
        <h1 className="text-2xl font-semibold">Complete Repricings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Flight repricing opportunities ready for execution
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
        ) : tasks.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            No repricing tasks found
          </div>
        ) : (
          <div>
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} onClick={() => setSelectedTask(task)} />
            ))}
          </div>
        )}
      </div>

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
