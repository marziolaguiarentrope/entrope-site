'use client';

import { useEffect, useState } from 'react';

/**
 * Lightweight toast that appears briefly when a 401 is detected,
 * before the auth context redirects to the login page.
 */
export function SessionExpiredToast() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    function handleExpired() {
      setShow(true);
    }
    window.addEventListener('auth:session-expired', handleExpired);
    return () => window.removeEventListener('auth:session-expired', handleExpired);
  }, []);

  if (!show) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-3 text-sm text-yellow-400 shadow-lg backdrop-blur-sm">
        Session expired. Redirecting to login...
      </div>
    </div>
  );
}
