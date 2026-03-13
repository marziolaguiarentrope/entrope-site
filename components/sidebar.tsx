'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, Plane, Hotel, BedDouble, AlertTriangle, LogOut, ListTodo, Search, Contact, BarChart3, TrendingUp, Wrench, Mail, Filter, MessageSquare, DollarSign } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/tasks', icon: ListTodo, label: 'Tasks' },
  { href: '/manual-import', icon: FileText, label: 'Manual Import' },
  { href: '/complete-repricings', icon: Plane, label: 'Complete Repricings' },
  { href: '/agent-flight-bookings', icon: Plane, label: 'Agent Flight Bookings' },
  { href: '/flight-watch-conversions', icon: Plane, label: 'Flight Conversions' },
  { href: '/flight-repricing-funnel', icon: Filter, label: 'Flight Funnel' },
  { href: '/hotel-repricing-tracking', icon: Hotel, label: 'Hotel Repricings' },
  { href: '/hotel-bookings', icon: BedDouble, label: 'Hotel Bookings' },
  { href: '/outstanding-repricings', icon: DollarSign, label: 'Outstanding Repricings' },
  { href: '/user-search', icon: Search, label: 'User Search' },
  { href: '/axel-brain-messages', icon: MessageSquare, label: 'Axel Brain Send' },
  { href: '/users-list', icon: Contact, label: 'Users List' },
  { href: '/business', icon: TrendingUp, label: 'Business' },
  { href: '/metrics', icon: BarChart3, label: 'Metrics' },
  { href: '/booking-issues', icon: Wrench, label: 'Booking Issues' },
  { href: '/pending-emails', icon: Mail, label: 'Pending Emails' },
  { href: '/text-messages', icon: MessageSquare, label: 'Text Messages' },
  { href: '/escalations', icon: AlertTriangle, label: 'Escalations' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [pendingSmsCount, setPendingSmsCount] = useState<number | null>(null);
  const [pendingAgentFlightBookingCount, setPendingAgentFlightBookingCount] = useState<number | null>(null);
  const [pendingFlightConversionCount, setPendingFlightConversionCount] = useState<number | null>(null);
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchPendingCount = async () => {
      try {
        const [pendingEmails, pendingSms, pendingAgentFlightBookings, pendingFlightConversions] = await Promise.all([
          api.listPendingEmails({
            status: 'PENDING',
            limit: 1,
            offset: 0,
          }),
          api.listPendingSms({
            status: 'PENDING',
            limit: 1,
            offset: 0,
          }),
          api.listAgentFlightBookings({
            status: 'pending',
            limit: 500,
            offset: 0,
          }),
          // Backend returns page-sized totals here, so fetch a larger page for a closer count.
          api.listFlightConversions({
            status: 'pending',
            limit: 500,
            offset: 0,
          }),
        ]);
        if (!cancelled) {
          setPendingCount(pendingEmails.total);
          setPendingSmsCount(pendingSms.total);
          setPendingAgentFlightBookingCount(pendingAgentFlightBookings.total);
          setPendingFlightConversionCount(pendingFlightConversions.total);
        }
      } catch {
        if (!cancelled) {
          setPendingCount(null);
          setPendingSmsCount(null);
          setPendingAgentFlightBookingCount(null);
          setPendingFlightConversionCount(null);
        }
      }
    };

    fetchPendingCount();
    refreshTimer.current = setInterval(() => {
      fetchPendingCount();
    }, 30_000);

    return () => {
      cancelled = true;
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, []);

  return (
    <aside className="fixed left-0 top-0 h-screen w-56 border-r border-border bg-card flex flex-col">
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-border">
        <span className="text-lg font-semibold">Axel Admin</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname?.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
              {item.href === '/pending-emails' && pendingCount !== null && pendingCount > 0 && (
                <span className="ml-auto px-1.5 py-0.5 text-[10px] font-semibold rounded bg-yellow-500/20 text-yellow-400">
                  {pendingCount}
                </span>
              )}
              {item.href === '/text-messages' && pendingSmsCount !== null && pendingSmsCount > 0 && (
                <span className="ml-auto px-1.5 py-0.5 text-[10px] font-semibold rounded bg-orange-500/20 text-orange-400">
                  {pendingSmsCount}
                </span>
              )}
              {item.href === '/agent-flight-bookings' && pendingAgentFlightBookingCount !== null && pendingAgentFlightBookingCount > 0 && (
                <span className="ml-auto px-1.5 py-0.5 text-[10px] font-semibold rounded bg-sky-500/20 text-sky-400">
                  {pendingAgentFlightBookingCount >= 500 ? '500+' : pendingAgentFlightBookingCount}
                </span>
              )}
              {item.href === '/flight-watch-conversions' && pendingFlightConversionCount !== null && pendingFlightConversionCount > 0 && (
                <span className="ml-auto px-1.5 py-0.5 text-[10px] font-semibold rounded bg-blue-500/20 text-blue-400">
                  {pendingFlightConversionCount >= 500 ? '500+' : pendingFlightConversionCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User & Logout */}
      <div className="p-2 border-t border-border">
        {user && (
          <div className="px-3 py-2 text-sm text-muted-foreground truncate">
            {user.email}
          </div>
        )}
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors w-full"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
