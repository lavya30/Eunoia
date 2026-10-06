import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import type { BoardComment } from './board-types';
import {
  loadOfflineSnapshot,
  offlineStorageAvailable,
  saveOfflineSnapshot,
} from './offline-storage';

const WS_MESSAGE_SYNC = 0;
const WS_MESSAGE_AWARENESS = 1;
const REMOTE_ORIGIN = Symbol('remote-sync');
const LOCAL_ORIGIN = 'local-ui';
const OFFLINE_RESTORE_ORIGIN = Symbol('offline-restore');
const IDENTITY_STORAGE_KEY = 'eunoia:identity:v1';
/** Peers unseen for longer than this are treated as gone (the server does
 *  not prune awareness states on disconnect, so the client must). */
const PEER_STALE_AFTER_MS = 30_000;
/** Abnormal closes without a single successful open before giving up. */
const MAX_NEVER_OPENED_ATTEMPTS = 3;

export type SyncBoardState = {
  nodes: unknown[];
  arrows: unknown[];
  strokes: unknown[];
  code: string;
  comments: BoardComment[];
};

export type SyncStatus =
  'offline' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export type OfflineSyncState = {
  hydrated: boolean;
  persisted: boolean;
  pending: boolean;
  storageAvailable: boolean;
  error: boolean;
};

export type PeerUser = {
  id: string;
  name: string;
  color: string;
};

export type PeerInfo = {
  clientId: number;
  user: PeerUser;
  cursor: { x: number; y: number } | null;
  /** Active tool id (e.g. 'select', 'draw'), when shared by the peer. */
  tool: string | null;
  /** Board element ids the peer currently has selected. */
  selection: string[];
  updatedAt: number;
};

type SyncSessionOptions = {
  roomId: string;
  serverUrl: string | null;
  ticket?: string;
  /**
   * Signed-in user token for workspace rooms: browsers can't set WS
   * headers, so identity travels as a query param (same exposure class
   * as the existing ?ticket=). Lets members sync locked team rooms
   * without a room ticket.
   */
  userToken?: string;
  initialState: SyncBoardState;
  getInitialState?: () => SyncBoardState;
  onState: (state: SyncBoardState) => void;
  onStatus: (status: SyncStatus) => void;
  onOfflineState?: (state: OfflineSyncState) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  onPeers?: (peers: PeerInfo[]) => void;
  /** Fired with the WebSocket close code whenever the socket closes. */
  onClose?: (code: number) => void;
  /**
   * Fired when the socket never opens after repeated abnormal closes —
   * almost always missing/revoked credentials or a deleted room rather
   * than a transient drop. The session stops retrying; the host should
   * re-validate access over HTTP and recreate the session if appropriate.
   */
  onAccessLost?: () => void;
};

type SyncSession = {
  publish: (state: SyncBoardState) => void;
  setLocalCursor: (cursor: { x: number; y: number } | null) => void;
  /**
   * Share non-positional presence (active tool + selection). Broadcasts
   * immediately; callers should throttle selection churn themselves.
   */
  setLocalPresenceMeta: (tool: string | null, selection: string[]) => void;
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
  // This helper also runs during server rendering. Keep that render
  // deterministic instead of generating a new random identity per request.
  if (typeof window === 'undefined')
    return { id: 'local', name: 'You', color: PEER_COLORS[0] as string };
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

function sanitizePeerState(value: unknown): {
  user: PeerUser;
  cursor: { x: number; y: number } | null;
  tool: string | null;
  selection: string[];
} | null {
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
  const tool =
    typeof record.tool === 'string' && record.tool.length > 0
      ? record.tool.slice(0, 32)
      : null;
  let selection: string[] = [];
  if (Array.isArray(record.selection)) {
    selection = record.selection
      .filter(
        (id): id is string =>
          typeof id === 'string' && id.length > 0 && id.length <= 120,
      )
      .slice(0, 200);
  }
  return {
    user: {
      id: user.id.slice(0, 64),
      name: user.name.slice(0, 32),
      color: user.color.slice(0, 32),
    },
    cursor,
    tool,
    selection,
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
    const comments = JSON.parse(board.get('comments') ?? '[]');
    const code = board.get('code');
    if (
      !Array.isArray(nodes) ||
      !Array.isArray(arrows) ||
      !Array.isArray(strokes) ||
      !Array.isArray(comments) ||
      typeof code !== 'string'
    )
      return null;
    return {
      nodes,
      arrows,
      strokes,
      code,
      comments: comments as BoardComment[],
    };
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
    ['comments', JSON.stringify(state.comments)],
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
    onAccessLost,
    onClose,
    onError,
    onPeers,
    onReady,
    onOfflineState,
    onState,
    onStatus,
    roomId,
    serverUrl,
    ticket,
    userToken,
  } = options;
  const canConnect = Boolean(
    serverUrl &&
    typeof window !== 'undefined' &&
    typeof WebSocket !== 'undefined',
  );
  const storageAvailable = offlineStorageAvailable();
  let offlineState: OfflineSyncState = {
    hydrated: false,
    persisted: false,
    pending: false,
    storageAvailable,
    error: false,
  };
  const emitOfflineState = (patch: Partial<OfflineSyncState> = {}) => {
    offlineState = { ...offlineState, ...patch };
    onOfflineState?.(offlineState);
  };
  onOfflineState?.(offlineState);

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
  let opened = false;
  let hydrated = false;
  let pendingPublish: SyncBoardState | null = null;
  let persistTimer: number | null = null;
  let persistInFlight = false;
  let persistAgain = false;
  let dirtyForStorage = false;

  const persistNow = async () => {
    if (!storageAvailable || !dirtyForStorage || persistInFlight) {
      if (persistInFlight) persistAgain = true;
      return;
    }
    dirtyForStorage = false;
    persistInFlight = true;
    const saved = await saveOfflineSnapshot(roomId, Y.encodeStateAsUpdate(doc));
    persistInFlight = false;
    if (!destroyed) {
      if (saved) {
        emitOfflineState({ persisted: true, error: false });
      } else {
        dirtyForStorage = true;
        emitOfflineState({ persisted: false, error: true });
      }
    }
    if (persistAgain || dirtyForStorage) {
      persistAgain = false;
      if (!destroyed && typeof window !== 'undefined') {
        if (persistTimer !== null) window.clearTimeout(persistTimer);
        persistTimer = window.setTimeout(() => void persistNow(), 250);
      }
    }
  };

  const schedulePersist = () => {
    if (!storageAvailable || destroyed || typeof window === 'undefined') return;
    dirtyForStorage = true;
    emitOfflineState({ persisted: false, error: false });
    if (persistTimer !== null) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => void persistNow(), 250);
  };

  const setPendingUpload = (pending: boolean) => {
    if (offlineState.pending === pending) return;
    emitOfflineState({ pending });
  };

  const send = (message: Uint8Array): boolean => {
    if (
      typeof WebSocket === 'undefined' ||
      socket?.readyState !== WebSocket.OPEN
    )
      return false;
    socket.send(message);
    return true;
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
    if (!hydrated) {
      pendingPublish = state;
      return;
    }
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

  const setLocalPresenceMeta = (tool: string | null, selection: string[]) => {
    const current = awareness.getLocalState() as Record<string, unknown> | null;
    const next = { ...(current ?? {}), user: localUser, tool, selection };
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
        tool: clean.tool,
        selection: clean.selection,
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
    if (origin === OFFLINE_RESTORE_ORIGIN) return;
    schedulePersist();
    if (origin === REMOTE_ORIGIN || !canConnect) return;
    setPendingUpload(!send(encodeSyncUpdate(update)));
  };

  const handleBoardChange = () => {
    const state = readBoardState(board);
    if (state) onState(state);
  };

  const connect = () => {
    if (destroyed) return;
    onStatus(attempts > 0 ? 'reconnecting' : 'connecting');
    const params = new URLSearchParams();
    if (ticket) params.set('ticket', ticket);
    if (userToken) params.set('userToken', userToken);
    const query = params.size > 0 ? `?${params.toString()}` : '';
    const endpoint = `${serverUrl}/sync/${encodeURIComponent(roomId)}${query}`;
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
      opened = true;
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
        setPendingUpload(false);
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
      // HTTP upgrade rejections (401 locked / 404 deleted) surface as
      // abnormal closes with no usable code in browsers. Retrying the same
      // credentials forever just spams the server: after repeated failures
      // without a single open, stop and let the host re-validate access.
      if (!opened && attempts >= MAX_NEVER_OPENED_ATTEMPTS) {
        onStatus('error');
        onAccessLost?.();
        return;
      }
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

  const hydrateOfflineDocument = async (): Promise<boolean> => {
    const update = await loadOfflineSnapshot(roomId);
    if (destroyed) return false;
    let restored = false;
    if (update) {
      try {
        Y.applyUpdate(doc, update, OFFLINE_RESTORE_ORIGIN);
        handleBoardChange();
        restored = true;
        emitOfflineState({ persisted: true, error: false });
      } catch {
        emitOfflineState({ error: true });
      }
    }
    hydrated = true;
    emitOfflineState({ hydrated: true });
    if (pendingPublish) {
      const state = pendingPublish;
      pendingPublish = null;
      publish(state);
    }
    return restored;
  };

  const handlePageHide = () => {
    if (dirtyForStorage) void persistNow();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', handlePageHide);
  }

  // Periodically re-emit so stale peers (never pruned server-side) drop
  // off even without further awareness traffic.
  const peerSweepTimer = canConnect
    ? window.setInterval(emitPeers, 10_000)
    : null;

  if (!canConnect) {
    onStatus('offline');
    void hydrateOfflineDocument().then((restored) => {
      if (destroyed) return;
      if (!restored && !pendingPublish)
        publish(getInitialState?.() ?? initialState);
      setPendingUpload(false);
      onReady?.();
    });
  } else {
    void hydrateOfflineDocument().then(() => {
      if (!destroyed) connect();
    });
  }

  return {
    publish,
    setLocalCursor,
    setLocalPresenceMeta,
    getLocalUser: () => localUser,
    destroy: () => {
      if (dirtyForStorage) void persistNow();
      destroyed = true;
      if (typeof window !== 'undefined') {
        if (retryTimer !== null) window.clearTimeout(retryTimer);
        if (initialStateTimer !== null) window.clearTimeout(initialStateTimer);
        if (persistTimer !== null) window.clearTimeout(persistTimer);
        if (peerSweepTimer !== null) window.clearInterval(peerSweepTimer);
        window.removeEventListener('pagehide', handlePageHide);
      }
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
