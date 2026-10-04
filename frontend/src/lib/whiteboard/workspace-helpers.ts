'use client';

import { useCallback, useState } from 'react';
import { ApiError } from './rooms-api';
import type { Folder, WorkspaceRole } from './workspaces-api';

export function roleBadge(role: WorkspaceRole): string {
  return role === 'ADMIN' ? 'Admin' : role === 'EDITOR' ? 'Editor' : 'Viewer';
}

export function workspaceErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function resolveFolderName(
  folders: Folder[],
  folderId: string | null,
): string {
  if (!folderId) return 'No folder';
  return folders.find((folder) => folder.id === folderId)?.name ?? '—';
}

export function useGuardedWorkspace() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runGuarded = useCallback(
    async (label: string, task: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await task();
      } catch (err) {
        setError(
          err instanceof ApiError && err.code === 'SEATS_EXHAUSTED'
            ? 'Seat limit reached. Upgrade to Pro to invite more members.'
            : workspaceErrorMessage(err, label),
        );
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );
  return { busy, error, setError, runGuarded };
}
