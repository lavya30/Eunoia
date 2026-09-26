/** Minimal in-memory Prometheus metrics. No dependency, per-app instance. */

export type HttpStatus = number | string | undefined;

function normalizeStatus(status: HttpStatus): string {
  return typeof status === 'number' && Number.isFinite(status)
    ? String(status)
    : '500';
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
  if (/^\/api\/rooms\/[^/]+\/images\/[^/]+\/bytes$/.test(pathname))
    return 'GET /api/rooms/:roomId/images/:imageId/bytes';
  if (/^\/api\/rooms\/[^/]+\/images\/[^/]+\/url$/.test(pathname))
    return 'GET /api/rooms/:roomId/images/:imageId/url';
  if (/^\/api\/rooms\/[^/]+\/images\/[^/]+$/.test(pathname))
    return `${upper} /api/rooms/:roomId/images/:imageId`;
  if (/^\/api\/rooms\/[^/]+\/images\/request-upload$/.test(pathname))
    return 'POST /api/rooms/:roomId/images/request-upload';
  if (/^\/api\/rooms\/[^/]+\/images\/confirm$/.test(pathname))
    return 'POST /api/rooms/:roomId/images/confirm';
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
  if (pathname === '/api/auth/register') return 'POST /api/auth/register';
  if (pathname === '/api/auth/login') return 'POST /api/auth/login';
  if (pathname === '/api/auth/me') return 'GET /api/auth/me';
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

  incHttp(method: string, pathname: string, status: HttpStatus): void {
    const key = `${groupRoute(method, pathname)}|${normalizeStatus(status)}`;
    this.http.set(key, (this.http.get(key) ?? 0) + 1);
  }

  incCompile(engine: string, outcome: string): void {
    const key = `${engine}|${outcome}`;
    this.compiles.set(key, (this.compiles.get(key) ?? 0) + 1);
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
