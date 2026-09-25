'use client';

import { useState } from 'react';
import {
  ApiError,
  createRoom,
  getRoom,
  unlockRoom,
  type RoomMetadata,
} from '@/lib/whiteboard/rooms-api';
import { setTicket } from '@/lib/whiteboard/tickets';

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

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await unlockRoom(roomId, password || undefined);
      setTicket(result.roomId, result.ticket, result.expiresIn);
      onUnlocked(await getRoom(result.roomId, result.ticket), result.ticket);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not unlock the room. Try again.',
      );
    } finally {
      setBusy(false);
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

export function CreateRoomDialog({
  onCreated,
  onClose,
}: {
  onCreated: (meta: RoomMetadata) => void;
  onClose: () => void;
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
        await createRoom({
          name: name.trim() || undefined,
          password: password || undefined,
        }),
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
      </div>
    </div>
  );
}
