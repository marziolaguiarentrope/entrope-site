'use client';

import { useState, useEffect } from 'react';
import { api, MemberSummary, MemberContext } from '@/lib/api';
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

function MemberRow({ member, onClick }: { member: MemberSummary; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between py-3 px-4 border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium truncate">
            {member.name || member.email || 'Unknown'}
          </span>
          {member.has_active_escalation && (
            <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">
              Escalation
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {member.email} · {member.phone_number || 'No phone'}
        </div>
      </div>
      <div className="text-right">
        <div className={cn(
          'text-xs font-medium',
          member.membership_status === 'active' ? 'text-green-400' : 'text-muted-foreground'
        )}>
          {member.membership_status || 'No membership'}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Joined {timeAgo(member.created_at)}
        </div>
      </div>
    </div>
  );
}

function MemberDetail({ member, context, onClose, loading, error }: {
  member: MemberSummary;
  context: MemberContext | null;
  onClose: () => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
      <div className="w-full max-w-2xl bg-card border-l border-border h-full overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{member.name || 'Unknown'}</h2>
            <p className="text-sm text-muted-foreground">{member.email}</p>
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
          {/* Basic Info */}
          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Member Info</h3>
            <div className="bg-accent/50 rounded-lg p-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">ID</span>
                <span className="font-mono text-xs">{member.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email</span>
                <span>{member.email || 'None'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phone</span>
                <span>{member.phone_number || 'None'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className={cn(
                  member.status === 'active' ? 'text-green-400' : 'text-muted-foreground'
                )}>{member.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Membership</span>
                <span>{member.membership_status || 'None'} {member.membership_plan ? `(${member.membership_plan})` : ''}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Joined</span>
                <span>{new Date(member.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          </section>

          {/* Context Loading/Error */}
          {loading && (
            <div className="text-center text-muted-foreground py-8">
              Loading member context...
            </div>
          )}

          {error && (
            <div className="bg-red-500/20 text-red-400 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Full Context */}
          {context && (
            <>
              {/* Trips */}
              <section>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Trips ({context.trips.length})
                </h3>
                {context.trips.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No trips</p>
                ) : (
                  <div className="space-y-2">
                    {context.trips.map((trip: any, i: number) => (
                      <div key={i} className="bg-accent/50 rounded-lg p-3">
                        <div className="font-medium">{trip.name || trip.destination || 'Unnamed trip'}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {trip.start_date} - {trip.end_date} · {trip.status}
                        </div>
                        {trip.bookings?.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {trip.bookings.length} booking(s)
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Opportunities */}
              <section>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Opportunities ({context.flight_opportunities.length + context.hotel_opportunities.length})
                </h3>
                {context.flight_opportunities.length === 0 && context.hotel_opportunities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No opportunities</p>
                ) : (
                  <div className="space-y-2">
                    {context.flight_opportunities.map((opp: any, i: number) => (
                      <div key={`f-${i}`} className="bg-accent/50 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">Flight</span>
                          <span className="font-medium">{opp.status}</span>
                        </div>
                      </div>
                    ))}
                    {context.hotel_opportunities.map((opp: any, i: number) => (
                      <div key={`h-${i}`} className="bg-accent/50 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">Hotel</span>
                          <span className="font-medium">{opp.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Watches */}
              <section>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Watches ({context.watches.length})
                </h3>
                {context.watches.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active watches</p>
                ) : (
                  <div className="space-y-2">
                    {context.watches.map((watch: any, i: number) => (
                      <div key={i} className="bg-accent/50 rounded-lg p-3">
                        <div className="font-medium">{watch.watch_type}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {watch.status} · {watch.goal}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Escalations */}
              <section>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Escalations ({context.escalations.length})
                </h3>
                {context.escalations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No escalations</p>
                ) : (
                  <div className="space-y-2">
                    {context.escalations.map((esc: any, i: number) => (
                      <div key={i} className="bg-accent/50 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            'text-xs px-2 py-0.5 rounded',
                            esc.status === 'open' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                          )}>{esc.status}</span>
                          <span className="font-medium">{esc.type}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{esc.reason}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Pending Tasks */}
              <section>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Pending Tasks ({context.pending_tasks.length})
                </h3>
                {context.pending_tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No pending tasks</p>
                ) : (
                  <div className="space-y-2">
                    {context.pending_tasks.map((task: any, i: number) => (
                      <div key={i} className="bg-accent/50 rounded-lg p-3">
                        <div className="font-medium">{task.capability}</div>
                        <div className="text-xs text-muted-foreground mt-1">{task.status}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MembersPage() {
  const [search, setSearch] = useState('');
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const [selectedMember, setSelectedMember] = useState<MemberSummary | null>(null);
  const [memberContext, setMemberContext] = useState<MemberContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;

    setLoading(true);
    setError(null);
    setHasSearched(true);
    setMember(null);

    try {
      const result = await api.searchMember(search.trim());
      setMember(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search member');
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectMember(member: MemberSummary) {
    setSelectedMember(member);
    setMemberContext(null);
    setContextLoading(true);
    setContextError(null);

    try {
      const context = await api.getMember(member.id);
      setMemberContext(context);
    } catch (err) {
      setContextError(err instanceof Error ? err.message : 'Failed to load member context');
    } finally {
      setContextLoading(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Members</h1>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email address..."
            className="flex-1 max-w-md px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={!search.trim() || loading}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {/* Results */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {!hasSearched ? (
          <div className="p-6 text-center text-muted-foreground">
            Enter an email address to find a member
          </div>
        ) : loading ? (
          <div className="p-6 text-center text-muted-foreground">
            Searching...
          </div>
        ) : error ? (
          <div className="p-6 text-center text-red-400">
            {error}
          </div>
        ) : !member ? (
          <div className="p-6 text-center text-muted-foreground">
            No member found for "{search}"
          </div>
        ) : (
          <MemberRow
            member={member}
            onClick={() => handleSelectMember(member)}
          />
        )}
      </div>

      {/* Member Detail Panel */}
      {selectedMember && (
        <MemberDetail
          member={selectedMember}
          context={memberContext}
          onClose={() => {
            setSelectedMember(null);
            setMemberContext(null);
          }}
          loading={contextLoading}
          error={contextError}
        />
      )}
    </div>
  );
}
