'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  clearSession,
  loadSession,
  type AuthSession,
} from '@/lib/whiteboard/auth';

type AreaKey = 'boards' | 'identity' | 'recents' | 'prefs' | 'history';

type AreaUsage = {
  key: AreaKey;
  label: string;
  bytes: number;
  keys: string[];
};

const AREA_LABELS: Record<AreaKey, string> = {
  boards: 'Board snapshots (offline copies)',
  identity: 'Presence identity (name + cursor color)',
  recents: 'Recent boards list',
  prefs: 'Preferences (layout engine)',
  history: 'Status page probe history',
};

function categorize(key: string): AreaKey | null {
  if (key.startsWith('eunoia:board:')) return 'boards';
  if (key === 'eunoia:identity:v1') return 'identity';
  if (key === 'eunoia:recent-rooms:v1') return 'recents';
  if (key === 'eunoia:engine') return 'prefs';
  if (key === 'eunoia:status-history:v1') return 'history';
  return null;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function measure(): { areas: AreaUsage[]; total: number } {
  const byArea = new Map<AreaKey, { bytes: number; keys: string[] }>();
  let total = 0;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith('eunoia:')) continue;
      // Legacy auth sessions are migrated out on load; don't count them
      // as live usage.
      if (key === 'eunoia:auth:v1') continue;
      const area = categorize(key);
      if (!area) continue;
      const value = window.localStorage.getItem(key) ?? '';
      const bytes = new TextEncoder().encode(key + value).length;
      total += bytes;
      const entry = byArea.get(area) ?? { bytes: 0, keys: [] };
      entry.bytes += bytes;
      entry.keys.push(key);
      byArea.set(area, entry);
    }
  } catch {
    // Storage blocked (private mode): report zeros.
  }
  const areas: AreaUsage[] = (Object.keys(AREA_LABELS) as AreaKey[]).map(
    (key) => ({
      key,
      label: AREA_LABELS[key],
      bytes: byArea.get(key)?.bytes ?? 0,
      keys: byArea.get(key)?.keys ?? [],
    }),
  );
  return { areas, total };
}

export function SettingsPage() {
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [areas, setAreas] = useState<AreaUsage[]>([]);
  const [total, setTotal] = useState(0);
  const [quota, setQuota] = useState<number | null>(null);

  const refresh = useCallback(() => {
    setSession(loadSession());
    const measured = measure();
    setAreas(measured.areas);
    setTotal(measured.total);
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      navigator.storage
        .estimate()
        .then((estimate) => {
          setQuota(typeof estimate.quota === 'number' ? estimate.quota : null);
        })
        .catch(() => setQuota(null));
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- storage reads are client-only; server renders zeros. */
  useEffect(() => {
    setMounted(true);
    refresh();
  }, [refresh]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const clearKeys = (keys: string[], confirmMessage: string) => {
    if (keys.length === 0) return;
    if (!window.confirm(confirmMessage)) return;
    try {
      for (const key of keys) window.localStorage.removeItem(key);
    } catch {
      // Best-effort.
    }
    refresh();
  };

  const clearArea = (area: AreaUsage) =>
    clearKeys(
      area.keys,
      `Delete ${area.label.toLowerCase()} (${formatBytes(area.bytes)})?` +
        (area.key === 'boards'
          ? ' Boards synced to the server will reload; pure local-only rooms are lost forever.'
          : ''),
    );

  const clearAll = () =>
    clearKeys(
      areas.flatMap((area) => area.keys),
      'Delete ALL local Eunoia data? Boards synced to the server will reload; pure local-only rooms are lost forever. (Your sign-in session is tab-scoped and untouched.)',
    );

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '48px 20px',
        display: 'flex',
        justifyContent: 'center',
        background: '#faf9f7',
        color: '#25263a',
      }}
    >
      <div style={{ width: '100%', maxWidth: 640 }}>
        <div style={{ marginBottom: 8 }}>
          <Link
            href="/"
            style={{ fontSize: 13, color: '#5b54c7', fontWeight: 600 }}
          >
            ← Eunoia
          </Link>
        </div>
        <h1 style={{ fontSize: 28, margin: '0 0 4px' }}>Settings</h1>
        <p style={{ fontSize: 13, color: '#6b6d85', margin: '0 0 20px' }}>
          Account and browser storage. Nothing here leaves your device except
          through the normal signed-in API calls.
        </p>

        <section
          aria-label="Account"
          style={{
            padding: 18,
            borderRadius: 12,
            background: '#fff',
            border: '1px solid #e3e2ea',
            marginBottom: 16,
          }}
        >
          <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Account</h2>
          {!mounted ? (
            <p style={{ fontSize: 13, color: '#6b6d85', margin: 0 }}>
              Loading…
            </p>
          ) : session ? (
            <div style={{ fontSize: 13 }}>
              <div>
                <strong>{session.user.name ?? session.user.email}</strong>
                {session.user.name ? (
                  <span style={{ color: '#6b6d85' }}>
                    {' '}
                    · {session.user.email}
                  </span>
                ) : null}
              </div>
              <div style={{ color: '#6b6d85', marginTop: 4 }}>
                Tier {session.user.tier ?? 'COMMUNITY'} · session expires{' '}
                {new Date(session.expiresAt).toLocaleString()}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Link
                  href="/billing"
                  style={{
                    padding: '8px 14px',
                    borderRadius: 10,
                    background: '#5b54c7',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  Billing
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    clearSession();
                    refresh();
                  }}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 10,
                    border: '1px solid #e3e2ea',
                    background: '#fff',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: 'pointer',
                    color: '#e5484d',
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13 }}>
              <p style={{ color: '#6b6d85', margin: '0 0 12px' }}>
                You are browsing anonymously. Boards still work; team features
                need an account.
              </p>
              <Link
                href="/login?next=/settings"
                style={{
                  padding: '8px 14px',
                  borderRadius: 10,
                  background: '#5b54c7',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                Sign in
              </Link>
            </div>
          )}
        </section>

        <section
          aria-label="Browser storage"
          style={{
            padding: 18,
            borderRadius: 12,
            background: '#fff',
            border: '1px solid #e3e2ea',
          }}
        >
          <h2 style={{ fontSize: 15, margin: '0 0 4px' }}>Browser storage</h2>
          <p style={{ fontSize: 12, color: '#6b6d85', margin: '0 0 12px' }}>
            {!mounted
              ? 'Measuring…'
              : `${formatBytes(total)} used` +
                (quota !== null ? ` of ~${formatBytes(quota)} available` : '') +
                '. Server rooms resync after clearing; local-only rooms do not.'}
          </p>
          <div
            role="list"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {areas.map((area) => (
              <div
                key={area.key}
                role="listitem"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid #eeedf2',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {area.label}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b6d85' }}>
                    {formatBytes(area.bytes)} · {area.keys.length} item
                    {area.keys.length === 1 ? '' : 's'}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={area.keys.length === 0}
                  onClick={() => clearArea(area)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: '1px solid #e3e2ea',
                    background: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: area.keys.length === 0 ? 'default' : 'pointer',
                    opacity: area.keys.length === 0 ? 0.5 : 1,
                  }}
                >
                  Clear
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={total === 0}
            onClick={clearAll}
            style={{
              marginTop: 12,
              padding: '8px 14px',
              borderRadius: 10,
              border: '1px solid #e5484d',
              background: '#fff',
              color: '#e5484d',
              fontSize: 13,
              fontWeight: 600,
              cursor: total === 0 ? 'default' : 'pointer',
              opacity: total === 0 ? 0.5 : 1,
            }}
          >
            Clear all local data
          </button>
        </section>

        <div style={{ marginTop: 24, fontSize: 13, display: 'flex', gap: 16 }}>
          <Link href="/board" style={{ color: '#5b54c7', fontWeight: 600 }}>
            Open a board →
          </Link>
          <Link href="/status" style={{ color: '#5b54c7', fontWeight: 600 }}>
            System status →
          </Link>
        </div>
      </div>
    </main>
  );
}
