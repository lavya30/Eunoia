'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  listSnapshots,
  restoreSnapshot,
  type SnapshotMeta,
} from '@/lib/whiteboard/rooms-api';

const PAGE_SIZE = 20;

function relativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta) || delta < 0) return 'just now';
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function HistoryPanel({
  roomId,
  ticket,
  onClose,
}: {
  roomId: string;
  ticket: string | undefined;
  onClose: () => void;
}) {
  // `null` doubles as the loading state so no effect-time setState is
  // needed; the parent keys this panel by room for a fresh mount.
  const [snapshots, setSnapshots] = useState<SnapshotMeta[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before?: string) => {
      setError(null);
      try {
        const page = await listSnapshots(roomId, ticket, {
          limit: PAGE_SIZE,
          before,
        });
        setSnapshots((prev) => (before ? [...(prev ?? []), ...page] : page));
        setHasMore(page.length === PAGE_SIZE);
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : 'Could not load history.',
        );
      }
    },
    [roomId, ticket],
  );

  useEffect(() => {
    // Mount fetch inlined as a promise chain: setState inside .then/.catch
    // callbacks is subscription-style and lint-clean.
    listSnapshots(roomId, ticket, { limit: PAGE_SIZE })
      .then((page) => {
        setSnapshots(page);
        setHasMore(page.length === PAGE_SIZE);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError ? err.message : 'Could not load history.',
        );
      });
  }, [roomId, ticket]);

  const loadMore = () => {
    const oldest = snapshots?.[snapshots.length - 1];
    if (!oldest || loadingMore) return;
    setLoadingMore(true);
    void load(oldest.createdAt).finally(() => setLoadingMore(false));
  };

  const restore = (snapshot: SnapshotMeta) => {
    if (
      restoringId ||
      !window.confirm(
        `Restore the board to the snapshot from ${new Date(snapshot.createdAt).toLocaleString()}? Current state is kept in history.`,
      )
    ) {
      return;
    }
    setRestoringId(snapshot.id);
    setError(null);
    void restoreSnapshot(roomId, snapshot.id, ticket)
      .then(() => load())
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not restore the snapshot.',
        );
      })
      .finally(() => setRestoringId(null));
  };

  return (
    <aside className="history-panel" aria-label="Board history">
      <div className="history-panel-header">
        <strong>History</strong>
        <button
          type="button"
          className="header-icon-button"
          aria-label="Close history"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {snapshots === null ? (
        <p className="history-panel-empty">Loading snapshots…</p>
      ) : error && snapshots.length === 0 ? (
        <p className="history-panel-empty room-gate-error">{error}</p>
      ) : snapshots.length === 0 ? (
        <p className="history-panel-empty">
          No snapshots yet. They accumulate automatically as you work.
        </p>
      ) : (
        <ul className="history-panel-list">
          {snapshots.map((snapshot, index) => (
            <li key={snapshot.id} className="history-panel-row">
              <div className="history-panel-meta">
                <span>
                  {index === 0 && !hasMore ? 'Latest · ' : ''}
                  {relativeTime(snapshot.createdAt)}
                </span>
                <span className="history-panel-sub">
                  {new Date(snapshot.createdAt).toLocaleString()}
                </span>
              </div>
              <button
                type="button"
                className="history-panel-restore"
                disabled={restoringId !== null}
                onClick={() => restore(snapshot)}
              >
                {restoringId === snapshot.id ? 'Restoring…' : 'Restore'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (snapshots?.length ?? 0) > 0 ? (
        <p className="history-panel-empty room-gate-error">{error}</p>
      ) : null}
      {hasMore && snapshots !== null && snapshots.length > 0 ? (
        <button
          type="button"
          className="room-gate-secondary"
          disabled={loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? 'Loading…' : 'Load older snapshots'}
        </button>
      ) : null}
    </aside>
  );
}
