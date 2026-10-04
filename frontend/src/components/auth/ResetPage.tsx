'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ApiError, resetPassword } from '@/lib/whiteboard/auth';

function ResetForm() {
  const searchParams = useSearchParams();
  const [token, setToken] = useState(searchParams.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await resetPassword({ token: token.trim(), password });
      setDone(true);
    } catch (submitError) {
      setError(
        submitError instanceof ApiError
          ? submitError.message
          : 'Something went wrong. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <Link href="/login" style={styles.back}>
          ← Back to sign in
        </Link>
        <h1 style={styles.h1}>Choose a new password</h1>
        {done ? (
          <p style={styles.muted}>
            Password updated.{' '}
            <Link href="/login" style={styles.back}>
              Sign in
            </Link>
          </p>
        ) : (
          <div>
            <label style={styles.label}>
              Reset token
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                style={styles.input}
                placeholder="pw1.…"
                autoComplete="off"
              />
            </label>
            <label style={styles.label}>
              New password (min 8 characters)
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                style={styles.input}
                autoComplete="new-password"
              />
            </label>
            {error ? (
              <p role="alert" style={styles.error}>
                {error}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !token.trim() || password.length < 8}
              style={styles.primary}
            >
              {busy ? 'Resetting…' : 'Reset password'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

export function ResetPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    maxWidth: 420,
    width: '100%',
    border: '1px solid #e3e2ea',
    borderRadius: 14,
    padding: 20,
    background: '#fff',
  },
  back: { color: '#5b54c7', fontSize: 13, fontWeight: 600 },
  h1: { fontSize: 22, margin: '8px 0 12px' },
  muted: { fontSize: 14, lineHeight: 1.5 },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 13,
    marginBottom: 10,
  },
  input: {
    border: '1px solid #e3e2ea',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 14,
  },
  primary: {
    marginTop: 4,
    background: '#5b54c7',
    color: '#fff',
    border: 0,
    borderRadius: 8,
    padding: '9px 14px',
    fontWeight: 700,
    cursor: 'pointer',
    width: '100%',
  },
  error: { color: '#b42318', fontSize: 13 },
};
