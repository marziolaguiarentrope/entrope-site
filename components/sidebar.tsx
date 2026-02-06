'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, Plane, Hotel, Users, AlertTriangle, LogOut, ListTodo, Search, Contact } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/tasks', icon: ListTodo, label: 'Tasks' },
  { href: '/manual-import', icon: FileText, label: 'Manual Import' },
  { href: '/complete-repricings', icon: Plane, label: 'Complete Repricings' },
  { href: '/hotel-repricing-tracking', icon: Hotel, label: 'Hotel Repricing Tracking' },
  { href: '/member-overview', icon: Users, label: 'Member Overview' },
  { href: '/user-search', icon: Search, label: 'User Search' },
  { href: '/users-list', icon: Contact, label: 'Users List' },
  { href: '/escalations', icon: AlertTriangle, label: 'Escalations' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

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
              {item.label}
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
