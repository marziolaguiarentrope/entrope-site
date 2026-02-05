'use client';

import { useState } from 'react';
import { api, MemberSummary, MemberContext } from '@/lib/api';
import { cn } from '@/lib/utils';
import { MemberDetail } from '@/components/member-detail';

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

  async function handleRefreshContext() {
    if (!selectedMember) return;

    setContextLoading(true);
    setContextError(null);

    try {
      const context = await api.getMember(selectedMember.id);
      setMemberContext(context);
    } catch (err) {
      setContextError(err instanceof Error ? err.message : 'Failed to refresh member context');
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
          onRefresh={handleRefreshContext}
          loading={contextLoading}
          error={contextError}
        />
      )}
    </div>
  );
}
