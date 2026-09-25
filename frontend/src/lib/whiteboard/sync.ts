import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

const WS_MESSAGE_SYNC = 0;
const WS_MESSAGE_AWARENESS = 1;
const REMOTE_ORIGIN = Symbol('remote-sync');
const LOCAL_ORIGIN = 'local-ui';
const IDENTITY_STORAGE_KEY = 'eunoia:identity:v1';
/** Peers unseen for longer than this are treated as gone (the server does
 *  not prune awareness states on disconnect, so the client must). */
const PEER_STALE_AFTER_MS = 30_000;

export type SyncBoardState = {
  nodes: unknown[];
  arrows: unknown[];
  strokes: unknown[];
  code: string;
};

export type SyncStatus =
  'offline' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export type PeerUser = {
  id: string;
  name: string;
  color: string;
};

export type PeerInfo = {
  clientId: number;
  user: PeerUser;
  cursor: { x: number; y: number } | null;
  updatedAt: number;
};

type SyncSessionOptions = {
  roomId: string;
  serverUrl: string | null;
  ticket?: string;
  initialState: SyncBoardState;
  getInitialState?: () => SyncBoardState;
  onState: (state: SyncBoardState) => void;
  onStatus: (status: SyncStatus) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  onPeers?: (peers: PeerInfo[]) => void;
  /** Fired with the WebSocket close code whenever the socket closes. */
  onClose?: (code: number) => void;
};

type SyncSession = {
  publish: (state: SyncBoardState) => void;
  setLocalCursor: (cursor: { x: number; y: number } | null) => void;
  getLocalUser: () => PeerUser;
  destroy: () => void;
};

const PEER_NAMES = [
  'Ada',
  'Bex',
  'Cy',
  'Dee',
  'Eli',
  'Fox',
  'Gia',
  'Hal',
  'Ivy',
  'Jae',
  'Kit',
  'Lou',
  'Max',
  'Noa',
  'Ori',
  'Pax',
  'Quinn',
  'Rae',
  'Sol',
  'Taj',
];

const PEER_COLORS = [
  '#7c5cff',
  '#f2842c',
  '#2f9e6e',
  '#3b82f6',
  '#e5484d',
  '#d4a017',
  '#0ea5e9',
  '#ec4899',
  '#14b8a6',
  '#8b5cf6',
];

function randomOf<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

export function getLocalUser(): PeerUser {
  try {
    const raw = window.localStorage.getItem(IDENTITY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PeerUser>;
      if (parsed.id && parsed.name && parsed.color) {
        return { id: parsed.id, name: parsed.name, color: parsed.color };
      }
    }
  } catch {
    // Fall through to generating a fresh identity.
  }
  const user: PeerUser = {
    id: `u-${Math.random().toString(36).slice(2, 10)}`,
    name: randomOf(PEER_NAMES),
    color: randomOf(PEER_COLORS),
  };
  try {
    window.localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // Identity persistence is best-effort.
  }
  return user;
}

function sanitizePeerState(
  value: unknown,
): { user: PeerUser; cursor: { x: number; y: number } | null } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const user = record.user as Record<string, unknown> | undefined;
  if (
    !user ||
    typeof user.id !== 'string' ||
    typeof user.name !== 'string' ||
    typeof user.color !== 'string'
  )
    return null;
  let cursor: { x: number; y: number } | null = null;
  const raw = record.cursor as Record<string, unknown> | null | undefined;
  if (
    raw &&
    typeof raw.x === 'number' &&
    typeof raw.y === 'number' &&
    Number.isFinite(raw.x) &&
    Number.isFinite(raw.y)
  ) {
    cursor = { x: raw.x, y: raw.y };
  }
  return {
    user: {
      id: user.id.slice(0, 64),
      name: user.name.slice(0, 32),
      color: user.color.slice(0, 32),
    },
    cursor,
  };
}

function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

function readBoardState(board: Y.Map<string>): SyncBoardState | null {
  try {
    const nodes = JSON.parse(board.get('nodes') ?? 'null');
    const arrows = JSON.parse(board.get('arrows') ?? 'null');
    const strokes = JSON.parse(board.get('strokes') ?? 'null');
    const code = board.get('code');
    if (
      !Array.isArray(nodes) ||
      !Array.isArray(arrows) ||
      !Array.isArray(strokes) ||
      typeof code !== 'string'
    )
      return null;
    return { nodes, arrows, strokes, code };
  } catch {
    return null;
  }
}

function stateEntries(state: SyncBoardState): Array<[string, string]> {
  return [
    ['nodes', JSON.stringify(state.nodes)],
    ['arrows', JSON.stringify(state.arrows)],
    ['strokes', JSON.stringify(state.strokes)],
    ['code', state.code],
  ];
}

function asUint8Array(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
}

export function resolveSyncHttpUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_SYNC_SERVER_URL?.trim();
  if (configured) {
    return normalizeBaseUrl(configured)
      .replace(/^ws:/, 'http:')
      .replace(/^wss:/, 'https:');
  }
  if (
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ) {
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }
  return null;
}

export function resolveSyncServerUrl(): string | null {
  const httpUrl = resolveSyncHttpUrl();
  if (!httpUrl) return null;
  return httpUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}

export function createBoardSync(options: SyncSessionOptions): SyncSession {
  const {
    initialState,
    getInitialState,
    onClose,
    onError,
    onPeers,
    onReady,
    onState,
    onStatus,
    roomId,
    serverUrl,
    ticket,
  } = options;
  if (
    !serverUrl ||
    typeof window === 'undefined' ||
    typeof WebSocket === 'undefined'
  ) {
    onStatus('offline');
    const offlineUser =
      typeof window !== 'undefined'
        ? getLocalUser()
        : { id: 'local', name: 'You', color: '#7c5cff' };
    return {
      publish: () => undefined,
      setLocalCursor: () => undefined,
      getLocalUser: () => offlineUser,
      destroy: () => undefined,
    };
  }

  const doc = new Y.Doc();
  const board = doc.getMap<string>('board');
  const awareness = new awarenessProtocol.Awareness(doc);
  const localUser = getLocalUser();
  const peerSeenAt = new Map<number, number>();
  let socket: WebSocket | null = null;
  let retryTimer: number | null = null;
  let initialStateTimer: number | null = null;
  let destroyed = false;
  let attempts = 0;

  const send = (message: Uint8Array) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(message);
  };

  const sendAwarenessUpdate = (clients: number[]) => {
    if (!clients.length) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, clients),
    );
    send(encoding.toUint8Array(encoder));
  };

  const publish = (state: SyncBoardState) => {
    doc.transact(() => {
      for (const [key, value] of stateEntries(state)) {
        if (board.get(key) !== value) board.set(key, value);
      }
    }, 'local-ui');
  };

  const setLocalCursor = (cursor: { x: number; y: number } | null) => {
    const current = awareness.getLocalState() as Record<string, unknown> | null;
    const next = { ...(current ?? {}), user: localUser, cursor };
    awareness.setLocalState(next);
  };

  const emitPeers = () => {
    if (!onPeers) return;
    const now = Date.now();
    const peers: PeerInfo[] = [];
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue;
      const clean = sanitizePeerState(state);
      if (!clean) continue;
      const updatedAt = peerSeenAt.get(clientId) ?? now;
      if (now - updatedAt > PEER_STALE_AFTER_MS) continue;
      peers.push({
        clientId,
        user: clean.user,
        cursor: clean.cursor,
        updatedAt,
      });
    }
    onPeers(peers);
  };

  const handleAwarenessChange = (changes: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => {
    const now = Date.now();
    for (const clientId of [...changes.added, ...changes.updated]) {
      peerSeenAt.set(clientId, now);
    }
    for (const clientId of changes.removed) {
      peerSeenAt.delete(clientId);
    }
    emitPeers();
  };

  const handleAwarenessUpdate = (changes: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => {
    const changed = [...changes.added, ...changes.updated, ...changes.removed];
    sendAwarenessUpdate(changed);
  };

  const handleUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) send(encodeSyncUpdate(update));
  };

  const handleBoardChange = () => {
    const state = readBoardState(board);
    if (state) onState(state);
  };

  const connect = () => {
    if (destroyed) return;
    onStatus(attempts > 0 ? 'reconnecting' : 'connecting');
    const endpoint = ticket
      ? `${serverUrl}/sync/${encodeURIComponent(roomId)}?ticket=${encodeURIComponent(ticket)}`
      : `${serverUrl}/sync/${encodeURIComponent(roomId)}`;
    try {
      socket = new WebSocket(endpoint);
      socket.binaryType = 'arraybuffer';
    } catch {
      onStatus('error');
      onError?.(
        'Live sync could not start. The board is still available locally.',
      );
      return;
    }

    socket.onopen = () => {
      attempts = 0;
      onStatus('connected');
      send(encodeSyncStep1(doc));
      // Announce ourselves so peers render us without waiting for the
      // first cursor move.
      setLocalCursor(null);
      if (initialStateTimer !== null) window.clearTimeout(initialStateTimer);
      initialStateTimer = window.setTimeout(() => {
        // Read the latest local state at fire time: the snapshot captured
        // when the session was created may already be stale.
        if (board.size === 0) publish(getInitialState?.() ?? initialState);
        onReady?.();
      }, 900);
    };

    socket.onmessage = async (event) => {
      if (typeof event.data === 'string') return;
      const bytes =
        asUint8Array(event.data) ??
        asUint8Array(await event.data.arrayBuffer?.());
      if (!bytes) return;
      try {
        const decoder = decoding.createDecoder(bytes);
        const messageType = decoding.readVarUint(decoder);
        if (messageType === WS_MESSAGE_SYNC) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, doc, REMOTE_ORIGIN);
          if (encoding.length(encoder) > 1)
            send(encoding.toUint8Array(encoder));
          handleBoardChange();
        } else if (messageType === WS_MESSAGE_AWARENESS) {
          awarenessProtocol.applyAwarenessUpdate(
            awareness,
            decoding.readVarUint8Array(decoder),
            REMOTE_ORIGIN,
          );
        }
      } catch {
        onStatus('error');
        onError?.('The live sync message was invalid. Reconnecting…');
      }
    };

    socket.onclose = (event) => {
      socket = null;
      onClose?.(event.code);
      if (destroyed) return;
      attempts += 1;
      onStatus('reconnecting');
      const delay = Math.min(10_000, 500 * 2 ** Math.min(attempts - 1, 4));
      retryTimer = window.setTimeout(connect, delay);
    };

    socket.onerror = () => {
      onStatus('error');
      onError?.('Live sync is unavailable. Retrying in the background.');
    };
  };

  board.observe(handleBoardChange);
  doc.on('update', handleUpdate);
  awareness.on('update', handleAwarenessUpdate);
  awareness.on('change', handleAwarenessChange);
  connect();

  // Periodically re-emit so stale peers (never pruned server-side) drop
  // off even without further awareness traffic.
  const peerSweepTimer = window.setInterval(emitPeers, 10_000);

  return {
    publish,
    setLocalCursor,
    getLocalUser: () => localUser,
    destroy: () => {
      destroyed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (initialStateTimer !== null) window.clearTimeout(initialStateTimer);
      window.clearInterval(peerSweepTimer);
      // Best-effort presence removal while the update handler (and socket)
      // are still live.
      awarenessProtocol.removeAwarenessStates(
        awareness,
        [awareness.clientID],
        LOCAL_ORIGIN,
      );
      board.unobserve(handleBoardChange);
      doc.off('update', handleUpdate);
      awareness.off('update', handleAwarenessUpdate);
      awareness.off('change', handleAwarenessChange);
      socket?.close(1000, 'Board closed');
      awareness.destroy();
      doc.destroy();
    },
  };
}
