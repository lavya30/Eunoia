'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { resolveSyncHttpUrl } from '@/lib/whiteboard/sync';

type CheckState = {
  status: 'ok' | 'skipped' | 'degraded' | 'error';
  latencyMs?: number;
  detail?: string;
};

type Readiness = {
  status: 'ready' | 'degraded' | 'down';
  version: string;
  uptimeSec: number;
  checks: {
    database: CheckState;
    redis: CheckState;
    compiler: CheckState;
    imageStorage: CheckState;
  };
};

type Health = {
  status: string;
  version?: string;
  uptimeSec?: number;
  activeRooms?: number;
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'unconfigured' }
  | { kind: 'unreachable'; message: string }
  | { kind: 'ready'; health: Health; readiness: Readiness };

const CHECK_LABELS: Array<{ key: keyof Readiness['checks']; label: string }> = [
  { key: 'database', label: 'Database (PostgreSQL)' },
  { key: 'redis', label: 'Cursor relay (Redis)' },
  { key: 'compiler', label: 'D2 compiler' },
  { key: 'imageStorage', label: 'Image storage (R2)' },
];

function checkLabel(status: CheckState['status']): string {
  if (status === 'ok') return 'Operational';
  if (status === 'skipped') return 'Not configured';
  if (status === 'degraded') return 'Degraded';
  return 'Down';
}

function checkColor(status: CheckState['status']): string {
  if (status === 'ok') return '#2f9e6e';
  if (status === 'skipped') return '#8a8ca3';
  if (status === 'degraded') return '#d2ab40';
  return '#e5484d';
}

function formatUptime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return '—';
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function StatusPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const base = resolveSyncHttpUrl();
    if (!base) {
      setState({ kind: 'unconfigured' });
      return;
    }
    try {
      const [healthRes, readyRes] = await Promise.all([
        fetch(`${base}/health`, { cache: 'no-store' }),
        fetch(`${base}/readyz`, { cache: 'no-store' }),
      ]);
      if (!healthRes.ok || !readyRes.ok) {
        throw new Error(
          `Sync server answered ${healthRes.status}/${readyRes.status}.`,
        );
      }
      const health = (await healthRes.json()) as Health;
      const readiness = (await readyRes.json()) as Readiness;
      setState({ kind: 'ready', health, readiness });
      setCheckedAt(new Date());
    } catch (error) {
      setState({
        kind: 'unreachable',
        message:
          error instanceof Error
            ? error.message
            : 'Could not reach the sync server.',
      });
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- poll external server status on mount and interval. */
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const banner =
    state.kind === 'ready'
      ? state.readiness.status === 'ready'
        ? { text: 'All systems operational', color: '#2f9e6e' }
        : state.readiness.status === 'degraded'
          ? { text: 'Partially degraded', color: '#d2ab40' }
          : { text: 'Service outage', color: '#e5484d' }
      : state.kind === 'loading'
        ? { text: 'Checking…', color: '#8a8ca3' }
        : { text: 'Status unavailable', color: '#e5484d' };

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
        <h1 style={{ fontSize: 28, margin: '0 0 4px' }}>System status</h1>
        <p style={{ fontSize: 13, color: '#6b6d85', margin: '0 0 20px' }}>
          Live dependency checks from the sync server
          {checkedAt ? ` · checked ${checkedAt.toLocaleTimeString()}` : ''}.
        </p>
        <div
          role="status"
          style={{
            padding: '14px 18px',
            borderRadius: 12,
            background: '#fff',
            border: `2px solid ${banner.color}`,
            fontWeight: 700,
            marginBottom: 16,
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: 999,
              background: banner.color,
              marginRight: 10,
            }}
          />
          {banner.text}
        </div>

        {state.kind === 'unconfigured' ? (
          <div
            style={{
              padding: 18,
              borderRadius: 12,
              background: '#fff',
              border: '1px solid #e3e2ea',
              fontSize: 14,
            }}
          >
            Live status needs <code>NEXT_PUBLIC_SYNC_SERVER_URL</code>{' '}
            configured.
          </div>
        ) : null}
        {state.kind === 'unreachable' ? (
          <div
            role="alert"
            style={{
              padding: 18,
              borderRadius: 12,
              background: '#fff',
              border: '1px solid #e3e2ea',
              fontSize: 14,
            }}
          >
            {state.message} The sync server may be down or unreachable.
          </div>
        ) : null}
        {state.kind === 'ready' ? (
          <>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              role="list"
            >
              <StatusRow
                label="Sync API"
                status="ok"
                detail={`${state.health.activeRooms ?? 0} active rooms`}
              />
              {CHECK_LABELS.map(({ key, label }) => {
                const check = state.readiness.checks[key];
                const detail =
                  check.detail ??
                  (typeof check.latencyMs === 'number'
                    ? `${check.latencyMs} ms`
                    : check.status === 'skipped'
                      ? 'Optional dependency'
                      : undefined);
                return (
                  <StatusRow
                    key={key}
                    label={label}
                    status={check.status}
                    detail={detail}
                  />
                );
              })}
            </div>
            <div
              style={{
                marginTop: 16,
                fontSize: 12,
                color: '#6b6d85',
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <span>Version {state.readiness.version}</span>
              <span>Uptime {formatUptime(state.readiness.uptimeSec)}</span>
            </div>
          </>
        ) : null}

        <div style={{ marginTop: 24, fontSize: 13 }}>
          <Link href="/board" style={{ color: '#5b54c7', fontWeight: 600 }}>
            Open a board →
          </Link>
        </div>
      </div>
    </main>
  );
}

function StatusRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: CheckState['status'];
  detail?: string;
}) {
  return (
    <div
      role="listitem"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 12,
        background: '#fff',
        border: '1px solid #e3e2ea',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: checkColor(status),
          flexShrink: 0,
        }}
      />
      <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
      <span style={{ marginLeft: 'auto', fontSize: 13, color: '#6b6d85' }}>
        {checkLabel(status)}
        {detail ? ` · ${detail}` : ''}
      </span>
    </div>
  );
}
