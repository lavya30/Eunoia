'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BlurFade } from '@/components/ui/blur-fade';
import { MagicCard } from '@/components/ui/magic-card';
import { BorderBeam } from '@/components/ui/border-beam';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { cn } from '@/lib/utils';
import {
  ApiError,
  clearSession,
  fetchMe,
  loadSession,
  loginUser,
  registerUser,
  saveSession,
  type AuthSession,
} from '@/lib/whiteboard/auth';
import './auth.css';

export type AuthMode = 'login' | 'signup';

type FieldErrors = { name?: string; email?: string; password?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeNext(value: string | null): string {
  if (!value) return '/board';
  if (!value.startsWith('/') || value.startsWith('//')) return '/board';
  return value;
}

function messageFor(error: unknown, mode: AuthMode): string | null {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  if (error.status === 0) return error.message;
  if (error.code === 'USER_EXISTS')
    return 'That email is already registered. Sign in instead.';
  if (error.code === 'INVALID_CREDENTIALS')
    return mode === 'login'
      ? 'Invalid email or password. Check both and try again.'
      : 'An account with that email already exists, or the password is wrong.';
  if (error.code === 'INVALID_PASSWORD')
    return 'Use a password of at least 8 characters.';
  if (error.code === 'VALIDATION_ERROR' && error.issues.length > 0)
    return null; // Surfaced inline on the fields.
  return error.message || 'Something went wrong. Try again.';
}

function issuesToFields(error: unknown): FieldErrors {
  const fields: FieldErrors = {};
  if (!(error instanceof ApiError)) return fields;
  for (const issue of error.issues) {
    const path = issue.path.toLowerCase();
    if (path.includes('email') && !fields.email) fields.email = issue.message;
    else if (path.includes('password') && !fields.password)
      fields.password = issue.message;
    else if (path.includes('name') && !fields.name) fields.name = issue.message;
  }
  return fields;
}

function LogoMark() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill="#6965DB" />
      <path
        d="M9 16H23M16 9V23M11 11L21 21M21 11L11 21"
        stroke="#FFFFFF"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EyeIcon({ off = false }: { off?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {off ? (
        <>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61" />
          <line x1="2" x2="22" y1="2" y2="22" />
        </>
      ) : (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function AuthForm({
  mode,
  next,
}: {
  mode: AuthMode;
  next: string | null;
}) {
  const router = useRouter();
  const destination = useMemo(() => sanitizeNext(next), [next]);
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : '';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fields, setFields] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    let live = true;
    const verifyStoredSession = async () => {
      const existing = loadSession();
      if (!existing) {
        if (live) setChecking(false);
        return;
      }
      try {
        const user = await fetchMe(existing.token);
        if (live) {
          setSession({ ...existing, user });
          setChecking(false);
        }
      } catch {
        clearSession();
        if (live) setChecking(false);
      }
    };
    void verifyStoredSession();
    return () => {
      live = false;
    };
  }, []);

  const continueToBoard = useCallback(() => {
    router.push(destination);
  }, [destination, router]);

  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const trimmedEmail = email.trim();
    const nextFields: FieldErrors = {};
    if (mode === 'signup' && !name.trim())
      nextFields.name = 'Tell us what to call you.';
    if (!trimmedEmail) nextFields.email = 'Enter your email address.';
    else if (!EMAIL_RE.test(trimmedEmail))
      nextFields.email = 'That email does not look complete.';
    if (!password) nextFields.password = 'Enter your password.';
    else if (password.length < 8)
      nextFields.password = 'Use at least 8 characters.';
    setFields(nextFields);
    setFormError(null);
    if (Object.keys(nextFields).length > 0) return;

    setPending(true);
    try {
      const response =
        mode === 'signup'
          ? await registerUser({
              email: trimmedEmail,
              password,
              name: name.trim(),
            })
          : await loginUser({ email: trimmedEmail, password });
      saveSession(response);
      router.push(destination);
    } catch (error) {
      setFields(issuesToFields(error));
      setFormError(messageFor(error, mode));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-dot-grid" aria-hidden="true" />
      <img
        className="auth-doodle-bg"
        src="/images/home-hero.svg"
        alt=""
        aria-hidden="true"
      />

      <header className="auth-topbar">
        <Link className="auth-brand" href="/" aria-label="Eunoia home">
          <LogoMark />
          <span>Eunoia</span>
        </Link>
        <a className="auth-topbar-link" href="/board">
          Open a room <ArrowIcon />
        </a>
      </header>

      <main className="auth-main">
        <BlurFade>
          <span className="auth-live-pill">
            <span className="auth-live-dot" aria-hidden="true">
              <span className="auth-live-ping" aria-hidden="true" />
              <span className="auth-live-core" aria-hidden="true" />
            </span>
            Open core · D2 native · sub-50ms sync
          </span>
        </BlurFade>

        <BlurFade delay={0.08} className="auth-card-wrap">
          <MagicCard
            className="auth-card"
            gradientColor="#6965DB"
            gradientOpacity={0.14}
          >
            <BorderBeam
              size={90}
              duration={8}
              colorFrom="#6965DB"
              colorTo="#ffb005"
              borderWidth={1.5}
            />
            {checking ? (
              <div
                className="auth-checking"
                role="status"
                aria-label="Checking your session"
              >
                <span className="auth-spinner" aria-hidden="true" />
                <p>Checking your session…</p>
              </div>
            ) : session ? (
              <div className="auth-signedin">
                <h1>You’re signed in</h1>
                <p className="auth-sub">
                  {session.user.name ?? session.user.email} ·{' '}
                  {session.user.email}
                </p>
                <ShimmerButton
                  type="button"
                  background="rgba(105,101,219,1)"
                  className="auth-submit"
                  onClick={continueToBoard}
                >
                  Continue to your board <ArrowIcon />
                </ShimmerButton>
                <button
                  type="button"
                  className="auth-switch-link"
                  onClick={signOut}
                >
                  Sign out and use a different account
                </button>
              </div>
            ) : (
              <>
                <h1>
                  {mode === 'login' ? 'Welcome back' : 'Create your account'}
                </h1>
                <p className="auth-sub">
                  {mode === 'login'
                    ? 'Sign in to open your board.'
                    : 'One account for every room you join.'}
                </p>

                <div
                  className="auth-tabs"
                  role="tablist"
                  aria-label="Choose sign in or create account"
                >
                  <a
                    role="tab"
                    aria-selected={mode === 'login'}
                    className={cn(
                      'auth-tab',
                      mode === 'login' && 'auth-tab--active',
                    )}
                    href={`/login${nextQuery}`}
                  >
                    Sign in
                  </a>
                  <a
                    role="tab"
                    aria-selected={mode === 'signup'}
                    className={cn(
                      'auth-tab',
                      mode === 'signup' && 'auth-tab--active',
                    )}
                    href={`/signup${nextQuery}`}
                  >
                    Create account
                  </a>
                </div>

                <form className="auth-form" onSubmit={onSubmit} noValidate>
                  {mode === 'signup' && (
                    <div className="auth-field">
                      <label htmlFor="auth-name">Name</label>
                      <input
                        id="auth-name"
                        name="name"
                        type="text"
                        autoComplete="name"
                        placeholder="Ada Lovelace"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          setFields((f) => ({ ...f, name: undefined }));
                        }}
                        aria-invalid={Boolean(fields.name)}
                        aria-describedby={
                          fields.name ? 'auth-name-error' : undefined
                        }
                        disabled={pending}
                      />
                      {fields.name && (
                        <p
                          className="auth-field-error"
                          id="auth-name-error"
                          role="alert"
                        >
                          {fields.name}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="auth-field">
                    <label htmlFor="auth-email">Email</label>
                    <input
                      id="auth-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="ada@analytical.engine"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setFields((f) => ({ ...f, email: undefined }));
                      }}
                      aria-invalid={Boolean(fields.email)}
                      aria-describedby={
                        fields.email ? 'auth-email-error' : undefined
                      }
                      disabled={pending}
                    />
                    {fields.email && (
                      <p
                        className="auth-field-error"
                        id="auth-email-error"
                        role="alert"
                      >
                        {fields.email}
                      </p>
                    )}
                  </div>

                  <div className="auth-field">
                    <div className="auth-label-row">
                      <label htmlFor="auth-password">Password</label>
                      <button
                        type="button"
                        className="auth-reveal"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-pressed={showPassword}
                        aria-label={
                          showPassword ? 'Hide password' : 'Show password'
                        }
                        disabled={pending}
                      >
                        <EyeIcon off={showPassword} />
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <input
                      id="auth-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={
                        mode === 'signup' ? 'new-password' : 'current-password'
                      }
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setFields((f) => ({ ...f, password: undefined }));
                      }}
                      aria-invalid={Boolean(fields.password)}
                      aria-describedby={
                        fields.password ? 'auth-password-error' : undefined
                      }
                      disabled={pending}
                    />
                    {fields.password ? (
                      <p
                        className="auth-field-error"
                        id="auth-password-error"
                        role="alert"
                      >
                        {fields.password}
                      </p>
                    ) : (
                      mode === 'signup' && (
                        <p className="auth-hint">
                          At least 8 characters. Hashed with scrypt, never
                          stored raw.
                        </p>
                      )
                    )}
                  </div>

                  {formError && (
                    <p className="auth-form-error" role="alert">
                      {formError}
                    </p>
                  )}

                  <div className="auth-submit-wrap">
                    <ShimmerButton
                      type="submit"
                      background="rgba(105,101,219,1)"
                      className="auth-submit"
                      disabled={pending}
                    >
                      {pending ? (
                        <>
                          <span
                            className="auth-spinner auth-spinner--light"
                            aria-hidden="true"
                          />
                          {mode === 'login'
                            ? 'Signing you in…'
                            : 'Creating your account…'}
                        </>
                      ) : (
                        <>
                          {mode === 'login' ? 'Sign in' : 'Create account'}{' '}
                          <ArrowIcon />
                        </>
                      )}
                    </ShimmerButton>
                    <span
                      className="auth-hand-note"
                      aria-hidden="true"
                    >
                      ↙ opens your board, nothing else
                    </span>
                  </div>
                </form>

                <ul className="auth-trust" aria-label="Why engineers trust Eunoia">
                  <li>
                    <CheckIcon /> sub-50ms sync · Yjs CRDTs
                  </li>
                  <li>
                    <CheckIcon /> D2 becomes native objects
                  </li>
                  <li>
                    <CheckIcon /> Rooms persist server-side
                  </li>
                </ul>
              </>
            )}
          </MagicCard>
        </BlurFade>

        {!checking && !session && (
          <BlurFade delay={0.16}>
            <p className="auth-switch">
              {mode === 'login' ? (
                <>
                  New to Eunoia?{' '}
                  <a href={`/signup${nextQuery}`}>Create an account</a>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <a href={`/login${nextQuery}`}>Sign in</a>
                </>
              )}
            </p>
          </BlurFade>
        )}
      </main>

      <footer className="auth-footer">
        <span>Eunoia Architecture Whiteboard</span>
        <span>Sessions expire · passwords hashed with scrypt</span>
      </footer>
    </div>
  );
}
