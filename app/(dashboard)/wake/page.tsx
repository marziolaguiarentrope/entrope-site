'use client';

import { useState } from 'react';
import { api, ConvTripSummary, WakeResponse, WakeInterceptedTool } from '@/lib/api';
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

function lastUserMessage(trip: ConvTripSummary): string | null {
  const convo = trip.conversation;
  if (!convo?.length) return null;
  for (let i = convo.length - 1; i >= 0; i--) {
    if (convo[i].from === 'user') return convo[i].at;
  }
  return null;
}

function funnelDepth(trip: ConvTripSummary): string {
  const activity = trip.booking_activity;
  if (!activity?.length) return 'browsing';
  const events = activity.map((a) => a.event);
  if (events.includes('booking_completed')) return 'booked';
  if (events.includes('booking_ready')) return 'at payment';
  if (events.includes('booking_started')) return 'started booking';
  return 'browsing';
}

interface WakeResult {
  tripId: string;
  tripName: string | null;
  response: string;
  interceptedTools: WakeInterceptedTool[];
  dryRun: boolean;
  timestamp: string;
  durationMs: number;
  error?: string;
}

export default function WakePage() {
  const [userId, setUserId] = useState('');
  const [feedback, setFeedback] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [waking, setWaking] = useState<string | null>(null);
  const [trips, setTrips] = useState<ConvTripSummary[]>([]);
  const [results, setResults] = useState<WakeResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleLoadTrips(e: React.FormEvent) {
    e.preventDefault();
    const uid = userId.trim();
    if (!uid) return;

    setLoadingTrips(true);
    setError(null);
    setTrips([]);
    setResults([]);

    try {
      const res = await api.listConvTrips(uid);
      setTrips(res.filter((t) => !t.archived));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trips');
    } finally {
      setLoadingTrips(false);
    }
  }

  async function handleWakeTrip(trip: ConvTripSummary) {
    const uid = userId.trim();
    if (!uid) return;

    setWaking(trip.id);
    setError(null);
    const t0 = Date.now();

    try {
      const res = await api.wakeTrip(uid, trip.id, {
        feedback: feedback.trim() || undefined,
        dryRun,
      });
      const elapsed = Date.now() - t0;
      setResults((prev) => [
        {
          tripId: trip.id,
          tripName: trip.name,
          response: res.response,
          interceptedTools: res.intercepted_tools ?? [],
          dryRun: res.dry_run ?? false,
          timestamp: new Date().toISOString(),
          durationMs: elapsed,
        },
        ...prev,
      ]);
    } catch (err) {
      setResults((prev) => [
        {
          tripId: trip.id,
          tripName: trip.name,
          response: '',
          interceptedTools: [],
          dryRun,
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - t0,
          error: err instanceof Error ? err.message : 'Wake failed',
        },
        ...prev,
      ]);
    } finally {
      setWaking(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Wake Center</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Load a user&apos;s trips, pick one to wake, see what Axel would do
        </p>
      </div>

      {/* User ID */}
      <form onSubmit={handleLoadTrips} className="mb-6 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="User ID..."
            className="flex-1 max-w-md px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
          />
          <button
            type="submit"
            disabled={!userId.trim() || loadingTrips}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loadingTrips ? 'Loading...' : 'Load Trips'}
          </button>
        </div>
        <div className="flex gap-3 items-center">
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Optional operator feedback..."
            className="flex-1 max-w-xl px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="rounded border-border"
            />
            <span className={cn('font-medium', dryRun ? 'text-yellow-400' : 'text-green-400')}>
              {dryRun ? 'Dry Run' : 'Live'}
            </span>
          </label>
        </div>
        {!dryRun && (
          <div className="p-2 bg-green-500/10 border border-green-500/20 rounded-lg text-xs text-green-400">
            Live mode — brain will update trip documents and attempt to send texts
          </div>
        )}
      </form>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Trip List */}
      {trips.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-muted-foreground mb-2">
            Trips ({trips.length})
          </h2>
          <div className="bg-card border border-border rounded-lg divide-y divide-border">
            {trips.map((trip) => {
              const lastMsg = lastUserMessage(trip);
              const depth = funnelDepth(trip);
              const msgCount = trip.conversation?.length ?? 0;

              return (
                <div key={trip.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {trip.name || '(unnamed)'}
                      </span>
                      <span className={cn(
                        'px-1.5 py-0.5 text-[10px] font-semibold rounded',
                        depth === 'at payment' ? 'bg-orange-500/20 text-orange-400' :
                        depth === 'started booking' ? 'bg-yellow-500/20 text-yellow-400' :
                        depth === 'booked' ? 'bg-green-500/20 text-green-400' :
                        'bg-zinc-500/20 text-zinc-400'
                      )}>
                        {depth}
                      </span>
                      {trip.notify && (
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-blue-500/20 text-blue-400">
                          notify
                        </span>
                      )}
                    </div>
                    {trip.headline && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {trip.headline}
                      </p>
                    )}
                    <div className="flex gap-3 mt-0.5">
                      <span className="text-[10px] text-muted-foreground/60">
                        {msgCount} msgs
                      </span>
                      {lastMsg && (
                        <span className="text-[10px] text-muted-foreground/60">
                          last active {timeAgo(lastMsg)}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground/40 font-mono">
                        {trip.id}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleWakeTrip(trip)}
                    disabled={waking !== null}
                    className={cn(
                      'ml-4 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                      waking === trip.id
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-accent text-accent-foreground hover:bg-accent/80 disabled:opacity-50'
                    )}
                  >
                    {waking === trip.id ? 'Waking...' : 'Wake'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              Results ({results.length})
            </h2>
            <button
              onClick={() => setResults([])}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          </div>
          <div className="space-y-3">
            {results.map((result, i) => (
              <div
                key={i}
                className={cn(
                  'bg-card border rounded-lg p-4',
                  result.error
                    ? 'border-red-500/30'
                    : result.dryRun
                    ? 'border-yellow-500/30'
                    : 'border-border'
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {result.tripName || result.tripId.slice(0, 8)}
                    </span>
                    {result.dryRun && (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-yellow-500/20 text-yellow-400">
                        dry run
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {(result.durationMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(result.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                {result.error ? (
                  <div className="text-sm text-red-400">{result.error}</div>
                ) : (
                  <>
                    <pre className="text-sm text-foreground/90 whitespace-pre-wrap font-sans leading-relaxed mb-3">
                      {result.response}
                    </pre>

                    {result.interceptedTools.length > 0 && (
                      <div className="border-t border-border pt-3 mt-3">
                        <p className="text-xs font-medium text-muted-foreground mb-2">
                          Would have called:
                        </p>
                        <div className="space-y-2">
                          {result.interceptedTools.map((tool, j) => (
                            <div key={j} className="text-xs bg-accent/30 rounded p-2">
                              <span className={cn(
                                'font-mono font-medium',
                                tool.would_call === 'send_text' ? 'text-blue-400' : 'text-muted-foreground'
                              )}>
                                {tool.would_call}
                              </span>
                              {tool.would_call === 'send_text' && tool.args.message && (
                                <div className="mt-1 p-2 bg-blue-500/10 border border-blue-500/20 rounded text-sm text-blue-300">
                                  {String(tool.args.message)}
                                </div>
                              )}
                              {tool.would_call === 'update_trip' && (
                                <pre className="mt-1 text-[10px] text-muted-foreground overflow-x-auto">
                                  {JSON.stringify(tool.args, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
