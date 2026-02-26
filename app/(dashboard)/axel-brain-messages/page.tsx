'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Loader2, Mail, Phone, Send, User } from 'lucide-react';

import { api, MemberSummary } from '@/lib/api';

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleString();
}

export default function AxelBrainMessagesPage() {
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<MemberSummary | null>(null);
  const [lookupPerformed, setLookupPerformed] = useState(false);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [lastMessageId, setLastMessageId] = useState<string | null>(null);

  async function handleLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = lookupQuery.trim();
    if (!query || lookupLoading) return;

    setLookupLoading(true);
    setLookupError(null);
    setLookupPerformed(false);
    setSendError(null);
    setSendSuccess(null);

    try {
      const member = await api.searchMember(query);
      setLookupResult(member);
      setLookupPerformed(true);
      if (!member) {
        setLookupError(`No user found for "${query}"`);
      }
    } catch (err) {
      setLookupResult(null);
      setLookupPerformed(true);
      setLookupError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lookupResult || !body.trim() || sendLoading) return;

    setSendLoading(true);
    setSendError(null);
    setSendSuccess(null);

    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : undefined;

      const response = await api.sendMemberAxelMessage(lookupResult.id, {
        body: body.trim(),
        subject: subject.trim() || undefined,
        idempotency_key: idempotencyKey,
      });

      setLastMessageId(response.message_id ?? null);
      setBody('');
      setSendSuccess(
        response.status === 'SENT' ? 'Message sent as Axel and stored in conversation history.' : `Message status: ${response.status}`,
      );
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSendLoading(false);
    }
  }

  const canSend = !!lookupResult && !!lookupResult.email && !!body.trim() && !sendLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Axel Brain Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Look up a user by email or phone number, then send an operator-authored email as Axel. The message is recorded as an Axel message for future context.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Find User</h2>
          <p className="text-xs text-muted-foreground">
            Search by email or phone. Sending uses the member email on file.
          </p>
        </div>

        <form onSubmit={handleLookup} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={lookupQuery}
            onChange={(e) => setLookupQuery(e.target.value)}
            placeholder="user@example.com or +15555555555"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={!lookupQuery.trim() || lookupLoading}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {lookupLoading ? <Loader2 className="size-4 animate-spin" /> : null}
            {lookupLoading ? 'Looking up...' : 'Find User'}
          </button>
        </form>

        {lookupError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {lookupError}
          </div>
        )}

        {lookupPerformed && !lookupError && !lookupResult && (
          <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-sm text-muted-foreground">
            No user found.
          </div>
        )}

        {lookupResult && (
          <div className="rounded-md border border-border bg-background/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-sm font-medium">
                <User className="size-4 text-muted-foreground" />
                <span>{lookupResult.name || 'Unnamed user'}</span>
              </div>
              <Link href={`/users-list/${lookupResult.id}`} className="text-xs text-primary hover:underline">
                Open user profile
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Mail className="size-3.5" />
                <span className="break-all">{lookupResult.email || 'No email on file'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="size-3.5" />
                <span>{lookupResult.phone_number || 'No phone on file'}</span>
              </div>
              <div>User ID: <span className="font-mono">{lookupResult.id}</span></div>
              <div>Joined: {formatDate(lookupResult.created_at)}</div>
            </div>
            {!lookupResult.email && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                This user has no email address on file, so the Axel email cannot be sent.
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Compose As Axel</h2>
          <p className="text-xs text-muted-foreground">
            Sends through the Axel brain email template and stores the outbound message in communications history as Axel.
          </p>
        </div>

        <form onSubmit={handleSend} className="space-y-3">
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject (optional)"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            disabled={sendLoading}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            placeholder="Write the message the user should receive from Axel..."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            disabled={sendLoading}
          />

          {sendError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {sendError}
            </div>
          )}
          {sendSuccess && (
            <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-400">
              {sendSuccess}
            </div>
          )}
          {lastMessageId && (
            <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
              Message ID: <span className="font-mono break-all">{lastMessageId}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-muted-foreground">
              {lookupResult
                ? lookupResult.email
                  ? `Will send to ${lookupResult.email}`
                  : 'Resolved user has no email on file'
                : 'Find a user first'}
            </div>
            <button
              type="submit"
              disabled={!canSend}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send as Axel
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
