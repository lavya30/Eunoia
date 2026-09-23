import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

const WS_MESSAGE_SYNC = 0;
const WS_MESSAGE_AWARENESS = 1;
const REMOTE_ORIGIN = Symbol('remote-sync');

export type SyncBoardState = {
  nodes: unknown[];
  arrows: unknown[];
  strokes: unknown[];
  code: string;
};

export type SyncStatus =
  'offline' | 'connecting' | 'connected' | 'reconnecting' | 'error';

type SyncSessionOptions = {
  roomId: string;
  serverUrl: string | null;
  initialState: SyncBoardState;
  getInitialState?: () => SyncBoardState;
  onState: (state: SyncBoardState) => void;
  onStatus: (status: SyncStatus) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
};

type SyncSession = {
  publish: (state: SyncBoardState) => void;
  destroy: () => void;
};

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
    onError,
    onReady,
    onState,
    onStatus,
    roomId,
    serverUrl,
  } = options;
  if (
    !serverUrl ||
    typeof window === 'undefined' ||
    typeof WebSocket === 'undefined'
  ) {
    onStatus('offline');
    return { publish: () => undefined, destroy: () => undefined };
  }

  const doc = new Y.Doc();
  const board = doc.getMap<string>('board');
  let socket: WebSocket | null = null;
  let retryTimer: number | null = null;
  let initialStateTimer: number | null = null;
  let destroyed = false;
  let attempts = 0;

  const send = (message: Uint8Array) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(message);
  };

  const publish = (state: SyncBoardState) => {
    doc.transact(() => {
      for (const [key, value] of stateEntries(state)) {
        if (board.get(key) !== value) board.set(key, value);
      }
    }, 'local-ui');
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
    const endpoint = `${serverUrl}/sync/${encodeURIComponent(roomId)}`;
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
          // Presence updates are intentionally optional for this client.
        }
      } catch {
        onStatus('error');
        onError?.('The live sync message was invalid. Reconnecting…');
      }
    };

    socket.onclose = () => {
      socket = null;
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
  connect();

  return {
    publish,
    destroy: () => {
      destroyed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (initialStateTimer !== null) window.clearTimeout(initialStateTimer);
      board.unobserve(handleBoardChange);
      doc.off('update', handleUpdate);
      socket?.close(1000, 'Board closed');
      doc.destroy();
    },
  };
}
