'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function SessionExpiredBanner() {
  const searchParams = useSearchParams();
  const sessionExpired = searchParams.get('error') === 'session_expired';

  if (!sessionExpired) return null;

  return (
    <div className="w-full max-w-sm mb-4">
      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-3 text-sm text-yellow-400">
        Your session has expired. Please sign in again.
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user) {
      router.push('/tasks');
    }
  }, [user, isLoading, router]);

  const handleGoogleLogin = () => {
    login();
  };

  // If already logged in, show loading while redirecting
  if (user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Redirecting...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      {/* Logo and title */}
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight mb-2">Axel</h1>
        <p className="text-muted-foreground text-lg">Operator Dashboard</p>
      </div>

      {/* Session expired banner */}
      <Suspense fallback={null}>
        <SessionExpiredBanner />
      </Suspense>

      {/* Login card */}
      <div className="w-full max-w-sm">
        <div className="bg-card border border-border rounded-lg p-8 shadow-lg">
          <h2 className="text-xl font-semibold text-center mb-6">Sign in</h2>

          <Button
            onClick={handleGoogleLogin}
            variant="outline"
            size="lg"
            className="w-full justify-center gap-3"
          >
            <GoogleIcon className="size-5" />
            Continue with Google
          </Button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Access restricted to authorized operators
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-12 text-center text-sm text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} Axel</p>
      </div>
    </div>
  );
}
