/** Minimal in-memory Prometheus metrics. No dependency, per-app instance. */

export type HttpStatus = number | string | undefined;

function normalizeStatus(status: HttpStatus): string {
  // Elysia leaves `set.status` unset on successful handlers — that means
  // 200, not 500. Only genuine non-numeric states fall back.
  if (typeof status === 'number' && Number.isFinite(status))
    return String(status);
  if (typeof status === 'string' && status.trim() !== '') return status;
  return '200';
}

/**
 * Collapse concrete paths to route templates so label cardinality stays
 * bounded (room ids, image ids, and snapshot ids never become labels).
 */
export function groupRoute(method: string, pathname: string): string {
  const upper = method.toUpperCase();
  if (pathname === '/health') return 'GET /health';
  if (pathname === '/readyz') return 'GET /readyz';
  if (pathname === '/metrics') return 'GET /metrics';
  if (pathname === '/api/rooms' && upper === 'POST') return 'POST /api/rooms';
  if (/^\/api\/rooms\/[^/]+\/unlock$/.test(pathname))
    return 'POST /api/rooms/:roomId/unlock';
  // Specific image actions must precede the generic :imageId pattern —
  // otherwise request-upload/confirm collapse into it.
  if (/^\/api\/rooms\/[^/]+\/images\/request-upload$/.test(pathname))
    return 'POST /api/rooms/:roomId/images/request-upload';
  if (/^\/api\/rooms\/[^/]+\/images\/confirm$/.test(pathname))
    return 'POST /api/rooms/:roomId/images/confirm';
  if (/^\/api\/rooms\/[^/]+\/images\/[^/]+\/bytes$/.test(pathname))
    return 'GET /api/rooms/:roomId/images/:imageId/bytes';
  if (/^\/api\/rooms\/[^/]+\/images\/[^/]+\/url$/.test(pathname))
    return 'GET /api/rooms/:roomId/images/:imageId/url';
  if (/^\/api\/rooms\/[^/]+\/images\/[^/]+$/.test(pathname))
    return `${upper} /api/rooms/:roomId/images/:imageId`;
  if (/^\/api\/rooms\/[^/]+\/images$/.test(pathname))
    return 'GET /api/rooms/:roomId/images';
  if (/^\/api\/rooms\/[^/]+\/snapshots\/[^/]+\/restore$/.test(pathname))
    return 'POST /api/rooms/:roomId/snapshots/:snapshotId/restore';
  if (/^\/api\/rooms\/[^/]+\/snapshots$/.test(pathname))
    return 'GET /api/rooms/:roomId/snapshots';
  if (/^\/api\/rooms\/[^/]+\/sync$/.test(pathname)) return 'WS /sync';
  if (/^\/sync\/[^/]+$/.test(pathname)) return 'WS /sync';
  if (/^\/api\/rooms\/[^/]+$/.test(pathname))
    return `${upper} /api/rooms/:roomId`;
  if (pathname === '/api/compile') return 'POST /api/compile';
  if (pathname === '/api/ai/generate') return 'POST /api/ai/generate';
  if (pathname === '/api/ai/suggest-layout')
    return 'POST /api/ai/suggest-layout';
  if (pathname === '/api/ai/models') return 'GET /api/ai/models';
  if (pathname === '/api/auth/register') return 'POST /api/auth/register';
  if (pathname === '/api/auth/login') return 'POST /api/auth/login';
  if (pathname === '/api/auth/me') return `${upper} /api/auth/me`;
  if (pathname === '/api/auth/forgot') return 'POST /api/auth/forgot';
  if (pathname === '/api/auth/reset') return 'POST /api/auth/reset';
  if (pathname === '/api/auth/sso/start') return 'GET /api/auth/sso/start';
  if (pathname === '/api/auth/sso/callback')
    return 'GET /api/auth/sso/callback';
  if (pathname === '/api/workspaces' && upper !== 'GET')
    return `${upper} /api/workspaces`;
  if (pathname === '/api/workspaces') return 'GET /api/workspaces';
  if (/^\/api\/workspaces\/[^/]+\/folders$/.test(pathname))
    return 'POST /api/workspaces/:id/folders';
  if (/^\/api\/workspaces\/[^/]+\/members\/[^/]+$/.test(pathname))
    return `${upper} /api/workspaces/:id/members/:userId`;
  if (/^\/api\/workspaces\/[^/]+\/members$/.test(pathname))
    return `${upper} /api/workspaces/:id/members`;
  if (/^\/api\/workspaces\/[^/]+$/.test(pathname))
    return `${upper} /api/workspaces/:id`;
  if (/^\/api\/rooms\/[^/]+\/move$/.test(pathname))
    return 'POST /api/rooms/:roomId/move';
  if (pathname === '/api/rooms' && upper === 'GET') return 'GET /api/rooms';
  if (pathname === '/api/audit') return 'GET /api/audit';
  if (pathname === '/api/billing/prices') return 'GET /api/billing/prices';
  if (pathname === '/api/billing/checkout') return 'POST /api/billing/checkout';
  if (pathname === '/api/billing/cancel') return 'POST /api/billing/cancel';
  if (pathname === '/api/billing/subscription')
    return 'GET /api/billing/subscription';
  if (pathname === '/api/billing/invoices') return 'GET /api/billing/invoices';
  if (pathname === '/api/billing/webhook') return 'POST /api/billing/webhook';
  return 'OTHER';
}

export type MetricsGauges = {
  activeRooms: number;
  wsConnections: number;
  uptimeSec: number;
};

export class Metrics {
  private readonly http = new Map<string, number>();
  private readonly compiles = new Map<string, number>();
  private readonly compileDurations = new Map<
    string,
    { sum: number; count: number }
  >();
  private readonly snapshotFlushes = new Map<string, number>();
  private readonly snapshotDurations = new Map<
    string,
    { sum: number; count: number }
  >();
  private readonly aiGenerations = new Map<string, number>();
  private readonly jevEvaluations = new Map<string, number>();
  private readonly wsUpgrades = new Map<string, number>();
  private readonly busMessages = new Map<string, number>();
  private readonly busBytes = new Map<string, number>();

  incHttp(method: string, pathname: string, status: HttpStatus): void {
    const key = `${groupRoute(method, pathname)}|${normalizeStatus(status)}`;
    this.http.set(key, (this.http.get(key) ?? 0) + 1);
  }

  incCompile(engine: string, outcome: string): void {
    const key = `${engine}|${outcome}`;
    this.compiles.set(key, (this.compiles.get(key) ?? 0) + 1);
  }

  observeCompileDuration(engine: string, durationMs: number): void {
    const entry = this.compileDurations.get(engine) ?? { sum: 0, count: 0 };
    entry.sum += durationMs;
    entry.count += 1;
    this.compileDurations.set(engine, entry);
  }

  /**
   * NFR-7 durability signal. Call once per debounced flush / pre-evict
   * final write (see SnapshotWorker). `outcome` is "success" or "error".
   */
  incSnapshot(outcome: string, durationMs: number): void {
    this.snapshotFlushes.set(
      outcome,
      (this.snapshotFlushes.get(outcome) ?? 0) + 1,
    );
    const entry = this.snapshotDurations.get(outcome) ?? { sum: 0, count: 0 };
    entry.sum += durationMs;
    entry.count += 1;
    this.snapshotDurations.set(outcome, entry);
  }

  incAi(outcome: string): void {
    this.aiGenerations.set(outcome, (this.aiGenerations.get(outcome) ?? 0) + 1);
  }

  incJev(outcome: string): void {
    this.jevEvaluations.set(
      outcome,
      (this.jevEvaluations.get(outcome) ?? 0) + 1,
    );
  }

  incWsUpgrade(outcome: string): void {
    this.wsUpgrades.set(outcome, (this.wsUpgrades.get(outcome) ?? 0) + 1);
  }

  /**
   * Cross-instance room-bus traffic. `direction` is "published" (this
   * replica sent), "received" (validated envelope from a peer), or
   * "dropped" (failed envelope validation). `kind` is the envelope kind
   * ("update" | "awareness" | "control", or "unknown" for unparseable).
   */
  incBus(direction: string, kind: string, bytes: number): void {
    const key = `${direction}|${kind}`;
    this.busMessages.set(key, (this.busMessages.get(key) ?? 0) + 1);
    if (direction !== 'dropped') {
      this.busBytes.set(key, (this.busBytes.get(key) ?? 0) + bytes);
    }
  }

  render(gauges: MetricsGauges): string {
    const lines: string[] = [
      '# HELP eunoia_http_requests_total HTTP requests by route and status.',
      '# TYPE eunoia_http_requests_total counter',
    ];
    for (const [key, count] of [...this.http.entries()].sort()) {
      const separator = key.lastIndexOf('|');
      const route = key.slice(0, separator);
      const status = key.slice(separator + 1);
      const method = route.split(' ')[0] ?? 'UNKNOWN';
      lines.push(
        `eunoia_http_requests_total{method="${method}",route="${route}",status="${status}"} ${count}`,
      );
    }
    lines.push(
      '# HELP eunoia_compile_requests_total D2 compile requests by engine and outcome.',
      '# TYPE eunoia_compile_requests_total counter',
    );
    for (const [key, count] of [...this.compiles.entries()].sort()) {
      const separator = key.lastIndexOf('|');
      const engine = key.slice(0, separator);
      const outcome = key.slice(separator + 1);
      lines.push(
        `eunoia_compile_requests_total{engine="${engine}",outcome="${outcome}"} ${count}`,
      );
    }
    lines.push(
      '# HELP eunoia_compile_duration_ms_sum Total D2 compile time by engine.',
      '# TYPE eunoia_compile_duration_ms_sum counter',
    );
    for (const [engine, entry] of [...this.compileDurations.entries()].sort()) {
      lines.push(
        `eunoia_compile_duration_ms_sum{engine="${engine}"} ${Math.round(entry.sum)}`,
      );
    }
    lines.push(
      '# HELP eunoia_compile_duration_ms_count D2 compile request count by engine.',
      '# TYPE eunoia_compile_duration_ms_count counter',
    );
    for (const [engine, entry] of [...this.compileDurations.entries()].sort()) {
      lines.push(
        `eunoia_compile_duration_ms_count{engine="${engine}"} ${entry.count}`,
      );
    }
    lines.push(
      '# HELP eunoia_snapshot_flush_total Snapshot flushes by outcome (NFR-7 durability).',
      '# TYPE eunoia_snapshot_flush_total counter',
    );
    for (const [outcome, count] of [...this.snapshotFlushes.entries()].sort()) {
      lines.push(`eunoia_snapshot_flush_total{outcome="${outcome}"} ${count}`);
    }
    lines.push(
      '# HELP eunoia_snapshot_flush_duration_ms_sum Total snapshot flush time by outcome.',
      '# TYPE eunoia_snapshot_flush_duration_ms_sum counter',
    );
    for (const [outcome, entry] of [
      ...this.snapshotDurations.entries(),
    ].sort()) {
      lines.push(
        `eunoia_snapshot_flush_duration_ms_sum{outcome="${outcome}"} ${Math.round(entry.sum)}`,
      );
    }
    lines.push(
      '# HELP eunoia_snapshot_flush_duration_ms_count Snapshot flush count by outcome.',
      '# TYPE eunoia_snapshot_flush_duration_ms_count counter',
    );
    for (const [outcome, entry] of [
      ...this.snapshotDurations.entries(),
    ].sort()) {
      lines.push(
        `eunoia_snapshot_flush_duration_ms_count{outcome="${outcome}"} ${entry.count}`,
      );
    }
    lines.push(
      '# HELP eunoia_ai_generations_total NL-to-D2 generations by outcome.',
      '# TYPE eunoia_ai_generations_total counter',
    );
    for (const [outcome, count] of [...this.aiGenerations.entries()].sort()) {
      lines.push(`eunoia_ai_generations_total{outcome="${outcome}"} ${count}`);
    }
    lines.push(
      '# HELP eunoia_jev_evaluations_total Jev guardrail/QA evaluations by outcome.',
      '# TYPE eunoia_jev_evaluations_total counter',
    );
    for (const [outcome, count] of [...this.jevEvaluations.entries()].sort()) {
      lines.push(`eunoia_jev_evaluations_total{outcome="${outcome}"} ${count}`);
    }
    lines.push(
      '# HELP eunoia_ws_upgrades_total WebSocket upgrade attempts by outcome.',
      '# TYPE eunoia_ws_upgrades_total counter',
    );
    for (const [outcome, count] of [...this.wsUpgrades.entries()].sort()) {
      lines.push(`eunoia_ws_upgrades_total{outcome="${outcome}"} ${count}`);
    }
    lines.push(
      '# HELP eunoia_bus_messages_total Cross-instance room-bus messages by direction and kind.',
      '# TYPE eunoia_bus_messages_total counter',
    );
    for (const [key, count] of [...this.busMessages.entries()].sort()) {
      const separator = key.lastIndexOf('|');
      const direction = key.slice(0, separator);
      const kind = key.slice(separator + 1);
      lines.push(
        `eunoia_bus_messages_total{direction="${direction}",kind="${kind}"} ${count}`,
      );
    }
    lines.push(
      '# HELP eunoia_bus_bytes_total Cross-instance room-bus payload bytes by direction and kind.',
      '# TYPE eunoia_bus_bytes_total counter',
    );
    for (const [key, total] of [...this.busBytes.entries()].sort()) {
      const separator = key.lastIndexOf('|');
      const direction = key.slice(0, separator);
      const kind = key.slice(separator + 1);
      lines.push(
        `eunoia_bus_bytes_total{direction="${direction}",kind="${kind}"} ${total}`,
      );
    }
    lines.push(
      '# HELP eunoia_active_rooms Rooms currently loaded in server memory.',
      '# TYPE eunoia_active_rooms gauge',
      `eunoia_active_rooms ${gauges.activeRooms}`,
      '# HELP eunoia_ws_connections Open WebSocket connections.',
      '# TYPE eunoia_ws_connections gauge',
      `eunoia_ws_connections ${gauges.wsConnections}`,
      '# HELP eunoia_uptime_seconds Seconds since process start.',
      '# TYPE eunoia_uptime_seconds gauge',
      `eunoia_uptime_seconds ${Math.floor(gauges.uptimeSec)}`,
      '# HELP eunoia_process_resident_memory_bytes Node RSS bytes.',
      '# TYPE eunoia_process_resident_memory_bytes gauge',
      `eunoia_process_resident_memory_bytes ${process.memoryUsage().rss}`,
    );
    return `${lines.join('\n')}\n`;
  }
}
