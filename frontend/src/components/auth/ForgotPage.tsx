'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ApiError, requestPasswordReset } from '@/lib/whiteboard/auth';

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await requestPasswordReset(email.trim());
      setDone(true);
      // Non-production servers return the reset token inline (no mailer);
      // surface it so self-hosters can complete the flow.
      setDevToken(typeof res.resetToken === 'string' ? res.resetToken : null);
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
        <h1 style={styles.h1}>Reset your password</h1>
        {done ? (
          <div>
            <p style={styles.muted}>
              If that email exists, a reset was issued. Production deployments
              deliver it by email; development servers return the token below.
            </p>
            {devToken ? (
              <p style={styles.token}>
                Dev reset token:{' '}
                <Link href={`/reset?token=${encodeURIComponent(devToken)}`}>
                  continue to reset
                </Link>
              </p>
            ) : null}
          </div>
        ) : (
          <div>
            <label style={styles.label}>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                style={styles.input}
                autoComplete="email"
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
              disabled={busy || !email.trim()}
              style={styles.primary}
            >
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </div>
        )}
      </div>
    </main>
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
  token: { fontSize: 13, marginTop: 12 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 },
  input: {
    border: '1px solid #e3e2ea',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 14,
  },
  primary: {
    marginTop: 12,
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
