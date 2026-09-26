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

type ProbeSample = {
  t: number;
  /** ready | degraded count as up per the SLO; down/unreachable do not. */
  up: boolean;
};

const HISTORY_KEY = 'eunoia:status-history:v1';
const HISTORY_TTL_MS = 48 * 3600_000;
const HISTORY_CAP = 2880; // 48h at the 60s probe cadence, safety-bounded.

function loadHistory(): ProbeSample[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - HISTORY_TTL_MS;
    return parsed.filter(
      (sample): sample is ProbeSample =>
        !!sample &&
        typeof sample === 'object' &&
        typeof (sample as ProbeSample).t === 'number' &&
        typeof (sample as ProbeSample).up === 'boolean' &&
        (sample as ProbeSample).t >= cutoff,
    );
  } catch {
    return [];
  }
}

function appendSample(up: boolean): ProbeSample[] {
  const next = [...loadHistory(), { t: Date.now(), up }].slice(-HISTORY_CAP);
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Best-effort (private mode, quota).
  }
  return next;
}

type Incident = { start: number; end: number };

function incidentsFrom(samples: ProbeSample[]): Incident[] {
  const incidents: Incident[] = [];
  let open: number | null = null;
  for (const sample of samples) {
    if (!sample.up && open === null) open = sample.t;
    if (sample.up && open !== null) {
      incidents.push({ start: open, end: sample.t });
      open = null;
    }
  }
  if (open !== null)
    incidents.push({ start: open, end: samples[samples.length - 1].t });
  return incidents.reverse();
}

export function StatusPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  // Initialized empty so SSR and first client render match; past
  // samples load in the mount effect below alongside the first probe.
  // nowTick follows the same path: wall-clock never runs during render.
  const [history, setHistory] = useState<ProbeSample[]>([]);
  const [nowTick, setNowTick] = useState(0);

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
      // ready + degraded count as up (SLO); down/unreachable do not.
      setHistory(appendSample(readiness.status !== 'down'));
      setNowTick(Date.now());
    } catch (error) {
      setState({
        kind: 'unreachable',
        message:
          error instanceof Error
            ? error.message
            : 'Could not reach the sync server.',
      });
      setHistory(appendSample(false));
      setNowTick(Date.now());
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- poll external server status on mount and interval. */
  useEffect(() => {
    setHistory(loadHistory());
    setNowTick(Date.now());
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
            <HistorySection history={history} now={nowTick} />
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

function HistorySection({
  history,
  now,
}: {
  history: ProbeSample[];
  now: number;
}) {
  // Browser-kept probe log (30s cadence while this page is open, 48h cap).
  // A hosted prober feed replaces this when SLA layer 4 goes live; the
  // rendering contract (uptime % + incident spans) stays the same.
  const up =
    history.length > 0
      ? (history.filter((sample) => sample.up).length / history.length) * 100
      : null;
  const incidents = incidentsFrom(history);
  const buckets = 48;
  const strip: boolean[] = [];
  if (history.length > 0 && now > 0) {
    const span = HISTORY_TTL_MS / buckets;
    for (let i = buckets - 1; i >= 0; i -= 1) {
      const from = now - (i + 1) * span;
      const to = now - i * span;
      const bucket = history.filter(
        (sample) => sample.t >= from && sample.t < to,
      );
      strip.push(
        bucket.length > 0 ? bucket.every((sample) => sample.up) : true,
      );
    }
  }
  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: '#8a8ca3',
          marginBottom: 6,
        }}
      >
        Last 48 hours{' '}
        {up !== null ? `· ${up.toFixed(up >= 99 ? 2 : 1)}% up` : ''}
      </div>
      {strip.length > 0 ? (
        <div
          role="img"
          aria-label={`Uptime history: ${up !== null ? up.toFixed(2) : '—'}% up over the last 48 hours`}
          style={{ display: 'flex', gap: 3 }}
        >
          {strip.map((ok, index) => (
            <span
              key={`bucket-${index}`}
              style={{
                flex: 1,
                height: 28,
                borderRadius: 4,
                background: ok ? '#2f9e6e' : '#e5484d',
                opacity: ok ? 0.85 : 1,
              }}
            />
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 12, color: '#6b6d85', margin: 0 }}>
          History accumulates while this page stays open (30s probes, kept 48h
          in this browser).
        </p>
      )}
      {incidents.length > 0 ? (
        <div
          style={{
            marginTop: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {incidents.slice(0, 5).map((incident) => (
            <div
              key={incident.start}
              style={{ fontSize: 12, color: '#6b6d85' }}
            >
              Outage {new Date(incident.start).toLocaleString()} →{' '}
              {new Date(incident.end).toLocaleString()}
            </div>
          ))}
        </div>
      ) : null}
    </div>
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
