'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  createRoom,
  getRoom,
  listImages,
  unlockRoom,
  type RoomMetadata,
} from '@/lib/whiteboard/rooms-api';
import { getTicket, setTicket } from '@/lib/whiteboard/tickets';
import type { RecentRoom } from '@/lib/whiteboard/recent-rooms';

export function UnlockDialog({
  roomId,
  onUnlocked,
  onCreateNew,
}: {
  roomId: string;
  onUnlocked: (meta: RoomMetadata, ticket: string) => void;
  onCreateNew: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards the unlock round-trip against unmount/room-switch: a late
  // response for a stale roomId must not store tickets or fire callbacks.
  const liveRoomRef = useRef(roomId);
  useEffect(() => {
    liveRoomRef.current = roomId;
  }, [roomId]);

  const submit = async () => {
    if (busy) return;
    const attemptRoomId = roomId;
    setBusy(true);
    setError(null);
    try {
      const result = await unlockRoom(attemptRoomId, password || undefined);
      if (liveRoomRef.current !== attemptRoomId) return;
      setTicket(result.roomId, result.ticket, result.expiresIn);
      onUnlocked(await getRoom(result.roomId, result.ticket), result.ticket);
    } catch (err) {
      if (liveRoomRef.current !== attemptRoomId) return;
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not unlock the room. Try again.',
      );
    } finally {
      if (liveRoomRef.current === attemptRoomId) setBusy(false);
    }
  };

  return (
    <div className="eunoia-board-shell room-gate">
      <div
        className="room-gate-card"
        role="alertdialog"
        aria-label="Locked board"
      >
        <h1>This board is locked</h1>
        <p>Enter the room password to join.</p>
        <form
          className="room-gate-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            className="room-gate-input"
            type="password"
            autoFocus
            autoComplete="current-password"
            placeholder="Room password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? (
            <p className="room-gate-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="compile-button" disabled={busy}>
            {busy ? 'Unlocking…' : 'Unlock board'}
          </button>
          <button
            type="button"
            className="room-gate-secondary"
            onClick={onCreateNew}
          >
            Create a new board instead
          </button>
        </form>
      </div>
    </div>
  );
}

function RecentRoomRow({
  room,
  current,
  onOpen,
}: {
  room: RecentRoom;
  current: boolean;
  onOpen: (roomId: string) => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    listImages(room.id, getTicket(room.id), 'thumbnail')
      .then((items) => {
        if (!cancelled) setThumbUrl(items[0]?.url ?? null);
      })
      .catch(() => {
        // Locked/unreachable rooms simply show the placeholder tile.
        if (!cancelled) setThumbUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [room.id]);
  return (
    <button
      type="button"
      disabled={current}
      onClick={() => onOpen(room.id)}
      className="recent-room-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 10px',
        border: 0,
        borderRadius: 10,
        background: current ? '#f5f4fa' : 'transparent',
        cursor: current ? 'default' : 'pointer',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => {
        if (!current) e.currentTarget.style.background = '#f5f4fa';
      }}
      onMouseLeave={(e) => {
        if (!current) e.currentTarget.style.background = 'transparent';
      }}
    >
      {thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl}
          alt=""
          width={72}
          height={44}
          loading="lazy"
          style={{
            width: 72,
            height: 44,
            objectFit: 'cover',
            borderRadius: 8,
            border: '1px solid #e3e2ea',
            background: '#fff',
            flexShrink: 0,
          }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            width: 72,
            height: 44,
            borderRadius: 8,
            border: '1px dashed #d5d3e3',
            background:
              'linear-gradient(135deg, #f6f4ff 0%, #eef4ff 60%, #fdf6e8 100%)',
            flexShrink: 0,
          }}
        />
      )}
      <span
        style={{
          minWidth: 0,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 13,
          color: '#35374a',
          fontWeight: 600,
        }}
      >
        {room.name}
        {current ? ' (current)' : ''}
      </span>
    </button>
  );
}

export function CreateRoomDialog({
  userToken,
  onCreated,
  onClose,
  recentRooms = [],
  currentRoomId = null,
  onOpenRoom,
}: {
  userToken?: string;
  onCreated: (meta: RoomMetadata) => void;
  onClose: () => void;
  recentRooms?: RecentRoom[];
  currentRoomId?: string | null;
  onOpenRoom?: (roomId: string) => void;
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (password && password.length < 8) {
      setError(
        'Password must be at least 8 characters (or leave it empty for an open room).',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await createRoom(
          {
            name: name.trim() || undefined,
            password: password || undefined,
          },
          userToken,
        ),
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not create the room. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="room-dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="room-gate-card room-dialog"
        role="dialog"
        aria-label="Create a new board"
        onClick={(event) => event.stopPropagation()}
      >
        <h1>New board</h1>
        <p>Rooms sync live over WebSocket and persist server-side snapshots.</p>
        <form
          className="room-gate-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            className="room-gate-input"
            type="text"
            autoFocus
            placeholder="Board name (optional)"
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className="room-gate-input"
            type="password"
            autoComplete="new-password"
            placeholder="Password (optional, min 8 chars)"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? (
            <p className="room-gate-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="compile-button" disabled={busy}>
            {busy ? 'Creating…' : 'Create board'}
          </button>
          <button
            type="button"
            className="room-gate-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
        </form>
        {recentRooms.length > 0 && onOpenRoom ? (
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
              Recent boards
            </div>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
              role="list"
            >
              {recentRooms.map((room) => (
                <RecentRoomRow
                  key={room.id}
                  room={room}
                  current={room.id === currentRoomId}
                  onOpen={onOpenRoom}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
