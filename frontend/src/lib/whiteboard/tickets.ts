/**
 * In-memory room access tickets. Tickets are short-lived HMAC tokens issued
 * by `POST /api/rooms/:roomId/unlock` for password-locked rooms. They are
 * deliberately NOT persisted: a page reload re-runs the unlock dialog (or
 * ingests `?ticket=` from a shared invite link).
 */

type TicketEntry = {
  ticket: string;
  expiresAt: number;
};

const tickets = new Map<string, TicketEntry>();

export function setTicket(
  roomId: string,
  ticket: string,
  expiresInSec: number,
): void {
  tickets.set(roomId, {
    ticket,
    expiresAt: Date.now() + Math.max(0, expiresInSec - 30) * 1000,
  });
}

export function getTicket(roomId: string): string | undefined {
  const entry = tickets.get(roomId);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    tickets.delete(roomId);
    return undefined;
  }
  return entry.ticket;
}

export function clearTicket(roomId: string): void {
  tickets.delete(roomId);
}

/**
 * Ingest `?ticket=` (and `?room=`) deep links so shared invite URLs like
 * `/board?room=<id>&ticket=<ticket>` unlock automatically. Runs on every
 * call (cheap) so client-side navigation between invite links works, and
 * strips `ticket` from the address bar afterwards so it doesn't linger in
 * history, copies, or referers — the store holds the ticket from here on.
 */
export function ingestTicketDeepLink(): {
  roomId: string | null;
  ticket: string | null;
} {
  if (typeof window === 'undefined') return { roomId: null, ticket: null };
  const url = new URL(window.location.href);
  const roomId = url.searchParams.get('room');
  const ticket = url.searchParams.get('ticket');
  if (roomId && ticket) {
    // Unknown TTL for deep-linked tickets; assume the server default (24h)
    // minus a safety margin. An explicit invite link always wins over the
    // store — a dead link fails closed and access-loss handling clears it.
    setTicket(roomId, ticket, 23 * 3600);
    url.searchParams.delete('ticket');
    window.history.replaceState(null, '', url.toString());
  }
  return { roomId, ticket };
}

export function buildInviteLink(roomId: string): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  const ticket = getTicket(roomId);
  if (ticket) url.searchParams.set('ticket', ticket);
  else url.searchParams.delete('ticket');
  return url.toString();
}
