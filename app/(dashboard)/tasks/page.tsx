'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { cn, formatDate } from '@/lib/utils';
import { api, Task, Escalation, HotelOpportunity, UserBasicInfo } from '@/lib/api';
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

const priorityOrder: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// ── Unified queue item type ─────────────────────────────

type QueueItemType = 'flight_reprice' | 'pending_cancel' | 'escalation';

interface QueueItem {
  id: string;
  type: QueueItemType;
  priority: string;
  priorityNum: number;
  createdAt: string;
  // Display
  label: string;
  sublabel: string;
  badge?: { text: string; color: string } | null;
  userInfo?: UserBasicInfo | null;
  userId: string;
  // Original data
  task?: Task;
  escalation?: Escalation;
  hotelOpportunity?: HotelOpportunity;
}

function buildQueueItems(
  tasks: Task[],
  escalations: Escalation[],
  pendingCancels: HotelOpportunity[],
  userInfoMap: Map<string, UserBasicInfo>,
): QueueItem[] {
  const items: QueueItem[] = [];

  // Flight repricings — only actionable (pending or claimed, not completed/failed/blocked)
  for (const task of tasks) {
    if (task.capability === 'flight_reprice') {
      if (['completed', 'failed', 'blocked'].includes(task.status)) continue;
      const data = task.request_data as Record<string, unknown>;
      const airline = data.airline_code as string;
      const pnr = data.pnr as string;
      const passenger = data.passenger_name as string;
      items.push({
        id: `task-${task.id}`,
        type: 'flight_reprice',
        priority: task.priority,
        priorityNum: priorityOrder[task.priority] ?? 99,
        createdAt: task.created_at,
        label: `${airline} · ${pnr}`,
        sublabel: `${passenger} · ${task.status} · ${timeAgo(task.created_at)}`,
        badge: task.claimed_by ? { text: `Claimed: ${task.claimed_by}`, color: 'bg-blue-500/20 text-blue-400' } : null,
        userId: task.user_id,
        userInfo: userInfoMap.get(task.user_id) || null,
        task,
      });
    }
  }

  // Pending cancels — compact display
  for (const opp of pendingCancels) {
    items.push({
      id: `cancel-${opp.id}`,
      type: 'pending_cancel',
      priority: 'normal',
      priorityNum: 2,
      createdAt: opp.created_at,
      label: opp.hotel_name || 'Unknown Hotel',
      sublabel: [
        opp.check_in ? formatDate(opp.check_in) : null,
        opp.check_out ? `→ ${formatDate(opp.check_out)}` : null,
        opp.old_booking_provider ? `via ${opp.old_booking_provider}` : null,
        opp.old_booking_confirmation_code ? `Conf: ${opp.old_booking_confirmation_code}` : null,
        opp.cancellation_scheduled_at ? `Cancel by ${formatDate(opp.cancellation_scheduled_at)}` : null,
      ].filter(Boolean).join(' · '),
      badge: { text: 'Pending Cancel', color: 'bg-red-500/20 text-red-400' },
      userId: opp.user_id,
      userInfo: userInfoMap.get(opp.user_id) || null,
      hotelOpportunity: opp,
    });
  }

  // Escalations
  for (const esc of escalations) {
    items.push({
      id: `esc-${esc.id}`,
      type: 'escalation',
      priority: esc.priority,
      priorityNum: priorityOrder[esc.priority] ?? 99,
      createdAt: esc.created_at,
      label: esc.type.replace(/_/g, ' '),
      sublabel: `${esc.reason} · ${esc.status} · ${timeAgo(esc.created_at)}`,
      badge: esc.claimed_by ? { text: `Claimed: ${esc.claimed_by}`, color: 'bg-blue-500/20 text-blue-400' } : null,
      userId: esc.user_id,
      userInfo: null,
      escalation: esc,
    });
  }

  // Sort by priority, then creation date (oldest first within same priority)
  items.sort((a, b) => {
    if (a.priorityNum !== b.priorityNum) return a.priorityNum - b.priorityNum;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return items;
}

// ── Type colors and icons ─────────────────────────────

const typeConfig: Record<QueueItemType, { label: string; dotColor: string }> = {
  flight_reprice: { label: 'Flight Reprice', dotColor: 'bg-blue-400' },
  pending_cancel: { label: 'Pending Cancel', dotColor: 'bg-red-400' },
  escalation: { label: 'Escalation', dotColor: 'bg-orange-400' },
};

const priorityColors: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-orange-400',
  normal: 'text-foreground',
  low: 'text-muted-foreground',
};

// ── Filter types ────────────────────────────────────────

type FilterType = 'all' | QueueItemType;

const filterOptions: { id: FilterType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'flight_reprice', label: 'Flight Reprice' },
  { id: 'pending_cancel', label: 'Pending Cancel' },
  { id: 'escalation', label: 'Escalations' },
];

// ── Queue Row ───────────────────────────────────────────

function QueueRow({
  item,
  isSelected,
  isLoading,
  onClick,
}: {
  item: QueueItem;
  isSelected: boolean;
  isLoading: boolean;
  onClick: () => void;
}) {
  const config = typeConfig[item.type];

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 py-2.5 px-4 border-b border-border last:border-0 transition-colors cursor-pointer",
        isSelected
          ? 'bg-accent border-l-2 border-l-primary'
          : 'hover:bg-accent/50'
      )}
    >
      {/* Type dot */}
      <div className={cn('w-2 h-2 rounded-full shrink-0', config.dotColor)} title={config.label} />

      {/* Priority */}
      <span className={cn('text-[10px] font-semibold uppercase w-12 shrink-0', priorityColors[item.priority] || 'text-foreground')}>
        {item.priority}
      </span>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{item.label}</span>
          {item.badge && (
            <span className={cn('px-1.5 py-0.5 text-[10px] rounded font-medium shrink-0', item.badge.color)}>
              {item.badge.text}
            </span>
          )}
          {isLoading && (
            <svg className="animate-spin h-3.5 w-3.5 text-muted-foreground shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 truncate">
          {item.sublabel}
          {item.userInfo?.email && <> · {item.userInfo.email}</>}
        </div>
      </div>

      {/* Type label */}
      <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide shrink-0 hidden sm:block">
        {config.label}
      </span>

      {/* Profile link */}
      <Link
        href={`/users-list/${item.userId}`}
        onClick={(e) => e.stopPropagation()}
        className="text-xs text-primary hover:underline whitespace-nowrap shrink-0"
      >
        Profile
      </Link>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [pendingCancels, setPendingCancels] = useState<HotelOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filter, setFilter] = useState<FilterType>('all');

  // User info
  const [userInfoMap, setUserInfoMap] = useState<Map<string, UserBasicInfo>>(new Map());

  // Selected items
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedEscalation, setSelectedEscalation] = useState<Escalation | null>(null);
  const [selectedHotelOpportunity, setSelectedHotelOpportunity] = useState<HotelOpportunity | null>(null);
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);
  const [taskDetailLoading, setTaskDetailLoading] = useState(false);

  // Expanded detail panel state
  const [detailExpanded, setDetailExpanded] = useState(false);

  // Close any open detail panel
  function closeDetail() {
    setSelectedTask(null);
    setSelectedEscalation(null);
    setSelectedHotelOpportunity(null);
    setDetailExpanded(false);
  }

  // Determine if any detail panel is open
  const hasDetailOpen = !!(selectedTask || selectedEscalation || selectedHotelOpportunity);

  // Select a task
  async function handleSelectTask(task: Task) {
    closeDetail();
    setLoadingItemId(`task-${task.id}`);
    setTaskDetailLoading(true);
    try {
      const fullTask = await api.getTask(task.id);
      setSelectedTask(fullTask);
    } catch (err) {
      console.error('Failed to fetch task details:', err);
      setSelectedTask(task);
    } finally {
      setTaskDetailLoading(false);
      setLoadingItemId(null);
    }
  }

  // Select a queue item
  function handleSelectItem(item: QueueItem) {
    if (item.task) {
      handleSelectTask(item.task);
    } else if (item.escalation) {
      closeDetail();
      setSelectedEscalation(item.escalation);
    } else if (item.hotelOpportunity) {
      closeDetail();
      setSelectedHotelOpportunity(item.hotelOpportunity);
    }
  }

  // Build unified queue
  const queueItems = useMemo(
    () => buildQueueItems(tasks, escalations, pendingCancels, userInfoMap),
    [tasks, escalations, pendingCancels, userInfoMap]
  );

  // Filtered items
  const filteredItems = useMemo(
    () => filter === 'all' ? queueItems : queueItems.filter(i => i.type === filter),
    [queueItems, filter]
  );

  // Count per type
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: queueItems.length };
    for (const item of queueItems) {
      counts[item.type] = (counts[item.type] || 0) + 1;
    }
    return counts;
  }, [queueItems]);

  // Determine selected item ID for highlighting
  const selectedItemId = useMemo(() => {
    if (selectedTask) return `task-${selectedTask.id}`;
    if (selectedEscalation) return `esc-${selectedEscalation.id}`;
    if (selectedHotelOpportunity) return `cancel-${selectedHotelOpportunity.id}`;
    return null;
  }, [selectedTask, selectedEscalation, selectedHotelOpportunity]);

  // Fetch all data in parallel
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const [taskRes, escalationRes, cancelRes] = await Promise.all([
          api.listTasks({ limit: 100 }),
          api.listEscalations({ limit: 50 }),
          api.listHotelOpportunitiesPendingCancel({ limit: 50 }),
        ]);

        setTasks(taskRes.tasks);
        setEscalations(escalationRes.escalations);
        setPendingCancels(cancelRes.opportunities);

        // Batch fetch user info (non-blocking)
        const allUserIds = [
          ...taskRes.tasks.map(t => t.user_id),
          ...cancelRes.opportunities.map(o => o.user_id),
        ];
        api.batchGetUserBasicInfo(allUserIds).then(setUserInfoMap).catch(() => {});
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [refreshKey]);

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold">Tasks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {queueItems.length} actionable item{queueItems.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/complete-repricings"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg border border-border hover:border-foreground/20"
          >
            Repricings History
          </Link>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg border border-border hover:border-foreground/20"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1.5 mb-4 shrink-0 flex-wrap">
        {filterOptions.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setFilter(opt.id)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-full transition-colors',
              filter === opt.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-accent/50 text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            {opt.label}
            {(typeCounts[opt.id] ?? 0) > 0 && (
              <span className={cn(
                'ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full',
                filter === opt.id ? 'bg-primary-foreground/20' : 'bg-accent'
              )}>
                {typeCounts[opt.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main content area — list + optional detail panel side by side */}
      <div className={cn(
        "flex-1 min-h-0 flex gap-0",
        hasDetailOpen && !detailExpanded && 'gap-0',
      )}>
        {/* Queue list — shrinks when detail is open, hides when expanded */}
        {!detailExpanded && (
          <div className={cn(
            "bg-card border border-border rounded-lg overflow-hidden flex flex-col transition-all",
            hasDetailOpen ? 'w-2/5 shrink-0' : 'flex-1',
          )}>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-6 text-center text-muted-foreground">
                  Loading...
                </div>
              ) : error ? (
                <div className="p-6 text-center">
                  <p className="text-red-400 mb-2">{error}</p>
                  <p className="text-muted-foreground text-sm mb-3">The backend may be under heavy load.</p>
                  <button
                    onClick={() => setRefreshKey(k => k + 1)}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">
                  {filter === 'all' ? 'No actionable tasks' : `No ${filterOptions.find(o => o.id === filter)?.label} items`}
                </div>
              ) : (
                filteredItems.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    isSelected={selectedItemId === item.id}
                    isLoading={loadingItemId === item.id}
                    onClick={() => handleSelectItem(item)}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* Detail panel — inline, takes remaining space or full width when expanded */}
        {hasDetailOpen && (
          <div className={cn(
            "bg-card border border-border rounded-lg overflow-hidden flex flex-col",
            detailExpanded ? 'flex-1' : 'flex-1',
          )}>
            {/* Expand/collapse bar */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-accent/30 shrink-0">
              <span className="text-xs text-muted-foreground">
                {selectedTask && 'Flight Reprice'}
                {selectedEscalation && 'Escalation'}
                {selectedHotelOpportunity && 'Pending Cancel'}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setDetailExpanded(!detailExpanded)}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title={detailExpanded ? 'Collapse' : 'Expand'}
                >
                  {detailExpanded ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={closeDetail}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Close"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Detail content — rendered inline, not as overlay */}
            <div className="flex-1 overflow-y-auto">
              {selectedTask && (
                <TaskDetail
                  task={selectedTask}
                  onClose={closeDetail}
                  onUpdate={(updated) => {
                    if (updated.status === 'completed' || updated.status === 'failed' || updated.status === 'blocked') {
                      setTasks(prev => prev.filter(t => t.id !== updated.id));
                      closeDetail();
                    } else {
                      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
                      setSelectedTask(updated);
                    }
                  }}
                  renderInline
                />
              )}

              {selectedEscalation && (
                <EscalationDetail
                  escalation={selectedEscalation}
                  onClose={closeDetail}
                  onUpdate={(updated) => {
                    setEscalations(prev => prev.map(e => e.id === updated.id ? updated : e));
                    setSelectedEscalation(updated);
                  }}
                  renderInline
                />
              )}

              {selectedHotelOpportunity && (
                <HotelOpportunityDetail
                  opportunity={selectedHotelOpportunity}
                  variant="cancel"
                  onClose={closeDetail}
                  onUpdate={(updated) => {
                    if (updated.old_booking_status === 'cancelled') {
                      setPendingCancels(prev => prev.filter(o => o.id !== updated.id));
                      closeDetail();
                    } else {
                      setPendingCancels(prev => prev.map(o => o.id === updated.id ? updated : o));
                      setSelectedHotelOpportunity(updated);
                    }
                  }}
                  renderInline
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
