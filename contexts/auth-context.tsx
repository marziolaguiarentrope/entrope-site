'use client';

import { SessionProvider, useSession, signIn, signOut } from 'next-auth/react';
import { ReactNode } from 'react';

interface AuthContextProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthContextProps) {
  return <SessionProvider>{children}</SessionProvider>;
}

export function useAuth() {
  const { data: session, status } = useSession();

  return {
    user: session?.user ?? null,
    isLoading: status === 'loading',
    login: () => signIn('google', { callbackUrl: '/tasks' }),
    logout: () => signOut({ callbackUrl: '/login' }),
  };
}
