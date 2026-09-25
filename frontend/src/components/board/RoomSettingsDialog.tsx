'use client';

import { useState } from 'react';
import {
  ApiError,
  updateRoom,
  type RoomMetadata,
} from '@/lib/whiteboard/rooms-api';
import { clearTicket } from '@/lib/whiteboard/tickets';

export function RoomSettingsDialog({
  room,
  ticket,
  userToken,
  onUpdated,
  onClose,
}: {
  room: RoomMetadata;
  ticket: string | undefined;
  userToken?: string;
  onUpdated: (meta: RoomMetadata) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(room.name);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (clearPassword: boolean) => {
    if (busy) return;
    const trimmedName = name.trim().slice(0, 120);
    if (!trimmedName) {
      setError('Give the board a name.');
      return;
    }
    if (password && password.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const passwordChanged = clearPassword || password.length > 0;
      onUpdated(
        await updateRoom(
          room.id,
          ticket,
          {
            ...(trimmedName !== room.name ? { name: trimmedName } : {}),
            ...(clearPassword
              ? { password: null }
              : password
                ? { password }
                : {}),
          },
          userToken,
        ),
      );
      // Rotation invalidates every minted ticket server-side, including the
      // one in use: drop it so the next sync round trips the unlock dialog
      // instead of 401-looping.
      if (passwordChanged) clearTicket(room.id);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not save settings.',
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
        aria-label="Board settings"
        onClick={(event) => event.stopPropagation()}
      >
        <h1>Board settings</h1>
        <p>
          Tier: <strong>{room.tier}</strong> ·{' '}
          {room.hasPassword ? 'Locked with a password' : 'Open room'} · Tier
          upgrades are managed server-side.
        </p>
        <form
          className="room-gate-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(false);
          }}
        >
          <input
            className="room-gate-input"
            type="text"
            autoFocus
            placeholder="Board name"
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className="room-gate-input"
            type="password"
            autoComplete="new-password"
            placeholder={
              room.hasPassword
                ? 'New password (leave empty to keep)'
                : 'Set a password (optional, min 8 chars)'
            }
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? (
            <p className="room-gate-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="compile-button" disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
          {room.hasPassword ? (
            <button
              type="button"
              className="room-gate-secondary"
              disabled={busy}
              onClick={() => void submit(true)}
            >
              Remove password (make open)
            </button>
          ) : null}
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
