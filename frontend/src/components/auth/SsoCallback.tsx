'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fetchMe, loadSession, saveSession } from '@/lib/whiteboard/auth';

function sanitizeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/board';
  return next.slice(0, 500);
}

export function SsoCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- one-shot OAuth callback completion. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const failure = params.get('error');
    if (failure) {
      setError(
        failure === 'sso_state_mismatch'
          ? 'Sign-in was interrupted. Please try again.'
          : 'Single sign-on failed. Try again or use email sign-in.',
      );
      return;
    }
    const token = params.get('token');
    const expiresIn = Number.parseInt(params.get('expiresIn') ?? '', 10);
    const next = sanitizeNext(params.get('next'));
    if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      setError('Single sign-on failed. Try again or use email sign-in.');
      return;
    }
    // The callback carries only the token: resolve the user profile, then
    // persist the same session shape as email login.
    if (loadSession()?.token === token) {
      router.replace(next);
      return;
    }
    fetchMe(token)
      .then((user) => {
        saveSession({ user, token, expiresIn });
        router.replace(next);
      })
      .catch(() => {
        setError('Single sign-on failed. Try again or use email sign-in.');
      });
  }, [router]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="auth-page">
      <main className="auth-main">
        <p role={error ? 'alert' : 'status'}>
          {error ?? 'Completing sign-in…'}
        </p>
        {error ? (
          <p className="auth-switch">
            <a href="/login">Back to sign in</a>
          </p>
        ) : null}
      </main>
    </div>
  );
}
