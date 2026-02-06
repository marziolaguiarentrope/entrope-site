'use client';

import { SessionProvider, useSession, signIn, signOut } from 'next-auth/react';
import { ReactNode, useEffect, useCallback, useRef } from 'react';

interface AuthContextProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthContextProps) {
  return (
    <SessionProvider
      refetchInterval={4 * 60}     // Re-check session every 4 minutes
      refetchOnWindowFocus={true}   // Re-check when tab regains focus
    >
      {children}
    </SessionProvider>
  );
}

export function useAuth() {
  const { data: session, status } = useSession();
  // Guard to prevent sign-out loop — only fire once
  const isSigningOut = useRef(false);

  const handleSessionExpired = useCallback(() => {
    if (isSigningOut.current) return;
    isSigningOut.current = true;
    signOut({ callbackUrl: '/login?error=session_expired' });
  }, []);

  // Listen for 401 events dispatched by the API client
  useEffect(() => {
    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => {
      window.removeEventListener('auth:session-expired', handleSessionExpired);
    };
  }, [handleSessionExpired]);

  // If the server-side token refresh failed, sign the user out
  useEffect(() => {
    if (session?.error === 'RefreshAccessTokenError') {
      handleSessionExpired();
    }
  }, [session, handleSessionExpired]);

  return {
    user: session?.user ?? null,
    isLoading: status === 'loading',
    login: () => signIn('google', { callbackUrl: '/tasks' }),
    logout: () => signOut({ callbackUrl: '/login' }),
  };
}
