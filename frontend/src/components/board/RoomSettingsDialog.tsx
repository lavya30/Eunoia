'use client';

import { useEffect, useState } from 'react';
import {
  ApiError,
  updateRoom,
  type RoomMetadata,
} from '@/lib/whiteboard/rooms-api';
import { clearTicket } from '@/lib/whiteboard/tickets';
import {
  listWorkspaces,
  moveRoom,
  type WorkspaceWithRole,
} from '@/lib/whiteboard/workspaces-api';

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
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);
  const [targetWorkspace, setTargetWorkspace] = useState<string>(
    room.workspaceId ?? '',
  );

  useEffect(() => {
    if (!userToken) return;
    listWorkspaces(userToken)
      .then(setWorkspaces)
      .catch(() => undefined);
  }, [userToken]);

  const submitMove = async () => {
    if (busy) return;
    const next = targetWorkspace === '' ? null : targetWorkspace;
    if (next === room.workspaceId) return;
    setBusy(true);
    setError(null);
    try {
      onUpdated(
        (await moveRoom(room.id, ticket, userToken, {
          workspaceId: next,
        })) as unknown as RoomMetadata,
      );
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not move board.');
    } finally {
      setBusy(false);
    }
  };

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
        {userToken && (workspaces.length > 0 || room.workspaceId) ? (
          <div style={{ marginTop: 12 }}>
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
              Workspace
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                aria-label="Board workspace"
                value={targetWorkspace}
                onChange={(event) => setTargetWorkspace(event.target.value)}
                style={{
                  flex: 1,
                  fontSize: 13,
                  borderRadius: 8,
                  padding: '8px 10px',
                }}
              >
                <option value="">Personal (no workspace)</option>
                {workspaces.map((entry) => (
                  <option key={entry.workspace.id} value={entry.workspace.id}>
                    {entry.workspace.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="compile-button"
                disabled={
                  busy || (targetWorkspace || null) === room.workspaceId
                }
                onClick={() => void submitMove()}
              >
                Move
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
