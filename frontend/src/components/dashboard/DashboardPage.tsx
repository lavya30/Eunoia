'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadSession, getSessionToken } from '@/lib/whiteboard/auth';
import { parseBoardExport, parseD2Import } from '@/lib/whiteboard/board-import';
import {
  loadDashboard,
  type DashboardRoom,
} from '@/lib/whiteboard/dashboard-api';
import {
  getFavoriteRoomIds,
  isRoomArchived,
  toggleRoomArchived,
  toggleRoomFavorite,
} from '@/lib/whiteboard/favorites';
import { getRecentRooms } from '@/lib/whiteboard/recent-rooms';
import { createRoom, deleteRoom, updateRoom } from '@/lib/whiteboard/rooms-api';
import { BOARD_TEMPLATES } from '@/lib/whiteboard/templates';

type Tab = 'boards' | 'starred' | 'recent' | 'trash';

type LocalTrashEntry = {
  id: string;
  name: string;
  deletedAt: number;
};

const TRASH_KEY = 'eunoia:trash:v1';

function readTrash(): LocalTrashEntry[] {
  try {
    const raw = window.localStorage.getItem(TRASH_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is LocalTrashEntry =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as LocalTrashEntry).id === 'string' &&
        typeof (entry as LocalTrashEntry).deletedAt === 'number',
    );
  } catch {
    return [];
  }
}

export function DashboardPage() {
  const router = useRouter();
  const [rooms, setRooms] = useState<DashboardRoom[]>([]);
  const [teamRooms, setTeamRooms] = useState<DashboardRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('boards');
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [trash, setTrash] = useState<LocalTrashEntry[]>([]);
  const [, setFavoritesTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  // One-shot hydration: dashboard aggregation touches localStorage.
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot hydration gate, not a render loop. */
  useEffect(() => {
    let cancelled = false;
    setTrash(readTrash());
    loadDashboard()
      .then((data) => {
        if (cancelled) return;
        setRooms(data.personal);
        setTeamRooms(data.workspaceRooms);
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load boards.',
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const refresh = useCallback(() => {
    setFavoritesTick((tick) => tick + 1);
    void loadDashboard()
      .then((data) => {
        setRooms(data.personal);
        setTeamRooms(data.workspaceRooms);
      })
      .catch(() => {
        // Keep stale list; the error banner already explains.
      });
  }, []);

  const allBoards = useMemo(() => {
    const seen = new Map<string, DashboardRoom>();
    for (const room of [...rooms, ...teamRooms]) seen.set(room.id, room);
    return [...seen.values()];
  }, [rooms, teamRooms]);

  const favoriteRoomIds = new Set(getFavoriteRoomIds());
  const needle = query.trim().toLowerCase();

  const filtered = allBoards.filter((room) => {
    if (tab === 'starred' && !favoriteRoomIds.has(room.id)) return false;
    if (!showArchived && isRoomArchived(room.id)) return false;
    if (needle && !`${room.name} ${room.id}`.toLowerCase().includes(needle))
      return false;
    return true;
  });

  const createBoard = useCallback(
    async (name: string, d2?: string) => {
      try {
        const meta = await createRoom({ name }, getSessionToken() ?? undefined);
        if (d2) {
          try {
            window.sessionStorage.setItem(`eunoia:template-d2:${meta.id}`, d2);
          } catch {
            // Best-effort handoff; the board still opens empty.
          }
        }
        router.push(`/board?room=${encodeURIComponent(meta.id)}`);
      } catch (createError) {
        setError(
          createError instanceof Error
            ? createError.message
            : 'Could not create a board.',
        );
      }
    },
    [router],
  );

  const moveToTrash = useCallback(
    async (room: DashboardRoom) => {
      const confirmed = window.confirm(
        `Move “${room.name}” to Trash? You can restore it from local trash for 30 days.`,
      );
      if (!confirmed) return;
      try {
        await deleteRoom(room.id, undefined, getSessionToken() ?? undefined);
      } catch {
        // Server delete is best-effort (offline rooms have no counterpart).
      }
      const next = [
        { id: room.id, name: room.name, deletedAt: Date.now() },
        ...readTrash(),
      ].slice(0, 50);
      try {
        window.localStorage.setItem(TRASH_KEY, JSON.stringify(next));
      } catch {
        // Best-effort.
      }
      setTrash(next);
      setNotice(`Moved “${room.name}” to Trash.`);
      refresh();
    },
    [refresh],
  );

  const onImportFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith('.d2')) {
        const d2 = parseD2Import(text);
        if (!d2) {
          setError('That D2 file is empty.');
          return;
        }
        await createBoard(file.name.replace(/\.d2$/i, ''), d2);
        return;
      }
      const parsed = parseBoardExport(text);
      if (!parsed) {
        setError('That file is not an Eunoia board export (.json).');
        return;
      }
      const meta = await createRoom(
        { name: file.name.replace(/\.json$/i, '') || 'Imported board' },
        getSessionToken() ?? undefined,
      );
      try {
        window.sessionStorage.setItem(
          `eunoia:import-board:${meta.id}`,
          JSON.stringify(parsed),
        );
      } catch {
        // Best-effort handoff.
      }
      router.push(`/board?room=${encodeURIComponent(meta.id)}&import=1`);
    },
    [createBoard, router],
  );

  if (loading) {
    return (
      <main style={styles.page}>
        <p style={styles.muted}>Loading your boards…</p>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.topbar}>
          <Link href="/" style={styles.backLink}>
            ← Eunoia
          </Link>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/board" style={styles.secondaryButton}>
              New board
            </Link>
            <Link href="/workspaces" style={styles.secondaryButton}>
              Workspaces
            </Link>
          </div>
        </div>
        <h1 style={styles.h1}>Boards</h1>
        <p style={styles.muted}>
          Personal, team, and recent boards. Star favorites, archive what is
          done, and restore from Trash within 30 days.
        </p>
        {error ? (
          <p role="alert" style={styles.error}>
            {error}
          </p>
        ) : null}
        {notice ? <p style={styles.notice}>{notice}</p> : null}
        <div style={styles.controls}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search boards…"
            aria-label="Search boards"
            style={styles.search}
          />
          <div style={styles.tabs} role="tablist" aria-label="Board filters">
            {(['boards', 'starred', 'recent', 'trash'] as Tab[]).map(
              (value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                  style={{
                    ...styles.tab,
                    ...(tab === value ? styles.tabActive : {}),
                  }}
                >
                  {value === 'boards'
                    ? `All (${allBoards.length})`
                    : value === 'starred'
                      ? 'Starred'
                      : value === 'recent'
                        ? 'Recent'
                        : `Trash (${trash.length})`}
                </button>
              ),
            )}
          </div>
          <label style={styles.checkbox}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Show archived
          </label>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={() => importInputRef.current?.click()}
          >
            Import JSON / D2
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.d2,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void onImportFile(file).catch(() => {});
            }}
          />
        </div>

        {tab === 'trash' ? (
          <TrashList
            trash={trash}
            onClear={() => {
              try {
                window.localStorage.removeItem(TRASH_KEY);
              } catch {
                // Best-effort.
              }
              setTrash([]);
            }}
          />
        ) : tab === 'recent' ? (
          <RecentList />
        ) : (
          <ul style={styles.grid}>
            {filtered.map((room) => (
              <li key={room.id} style={styles.card}>
                <Link
                  href={`/board?room=${encodeURIComponent(room.id)}`}
                  style={styles.cardTitle}
                >
                  {room.name}
                </Link>
                <p style={styles.cardMeta}>
                  {room.tier} · {room.workspaceId ? 'Team' : 'Personal'}
                  {room.hasPassword ? ' · Locked' : ''}
                  {room.visitedAt
                    ? ` · ${new Date(room.visitedAt).toLocaleDateString()}`
                    : ''}
                </p>
                {room.tags.length > 0 ? (
                  <p style={styles.tags}>{room.tags.join(' · ')}</p>
                ) : null}
                <div style={styles.cardActions}>
                  <button
                    type="button"
                    style={styles.link}
                    onClick={() => {
                      toggleRoomFavorite(room.id);
                      refresh();
                    }}
                    aria-pressed={favoriteRoomIds.has(room.id)}
                  >
                    {favoriteRoomIds.has(room.id) ? '★ Unstar' : '☆ Star'}
                  </button>
                  <button
                    type="button"
                    style={styles.link}
                    onClick={() => {
                      toggleRoomArchived(room.id);
                      refresh();
                    }}
                  >
                    {isRoomArchived(room.id) ? 'Unarchive' : 'Archive'}
                  </button>
                  <button
                    type="button"
                    style={{ ...styles.link, color: '#e5484d' }}
                    onClick={() => void moveToTrash(room)}
                  >
                    Trash
                  </button>
                </div>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li style={styles.empty}>
                No boards match. Create one, try a template below, or import a
                previous export.
              </li>
            ) : null}
          </ul>
        )}

        <section aria-label="Templates" style={styles.templates}>
          <h2 style={styles.h2}>Start from a template</h2>
          <ul style={styles.grid}>
            {BOARD_TEMPLATES.map((template) => (
              <li key={template.id} style={styles.card}>
                <h3 style={styles.cardTitle}>{template.name}</h3>
                <p style={styles.cardMeta}>{template.description}</p>
                <button
                  type="button"
                  style={styles.primaryButton}
                  onClick={() => void createBoard(template.name, template.d2)}
                >
                  Use template
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function TrashList({
  trash,
  onClear,
}: {
  trash: LocalTrashEntry[];
  onClear: () => void;
}) {
  if (trash.length === 0)
    return (
      <p style={styles.muted}>Trash is empty. Deleted boards land here.</p>
    );
  return (
    <div>
      <p style={styles.muted}>
        Trash is local-first for 30 days; server copies are hard-deleted on
        move. Restoring recreates the board under a new id.
      </p>
      <ul style={styles.grid}>
        {trash.map((entry) => (
          <li key={`${entry.id}-${entry.deletedAt}`} style={styles.card}>
            <h3 style={styles.cardTitle}>{entry.name}</h3>
            <p style={styles.cardMeta}>
              Deleted {new Date(entry.deletedAt).toLocaleString()}
            </p>
            <RestoreButton entry={entry} />
          </li>
        ))}
      </ul>
      <button type="button" style={styles.secondaryButton} onClick={onClear}>
        Empty trash
      </button>
    </div>
  );
}

function RestoreButton({ entry }: { entry: LocalTrashEntry }) {
  const router = useRouter();
  return (
    <button
      type="button"
      style={styles.primaryButton}
      onClick={() =>
        void createRoom({ name: entry.name }, getSessionToken() ?? undefined)
          .then((meta) =>
            router.push(`/board?room=${encodeURIComponent(meta.id)}`),
          )
          .catch(() => {})
      }
    >
      Restore as new board
    </button>
  );
}

function RecentList() {
  const recent = getRecentRooms();
  const session = loadSession();
  if (recent.length === 0)
    return (
      <p style={styles.muted}>
        No recent boards yet.{' '}
        {!session ? 'Sign in to sync recents across devices.' : ''}
      </p>
    );
  return (
    <ul style={styles.grid}>
      {recent.map((room) => (
        <li key={room.id} style={styles.card}>
          <Link
            href={`/board?room=${encodeURIComponent(room.id)}`}
            style={styles.cardTitle}
          >
            {room.name}
          </Link>
          <p style={styles.cardMeta}>
            Visited {new Date(room.visitedAt).toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  );
}

export async function renameBoardFromDashboard(
  roomId: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await updateRoom(roomId, undefined, { name: trimmed });
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '32px 16px', display: 'flex', justifyContent: 'center' },
  wrap: { maxWidth: 1024, width: '100%' },
  topbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  backLink: { color: '#5b54c7', fontWeight: 600, fontSize: 14 },
  h1: { fontSize: 28, margin: '0 0 4px' },
  h2: { fontSize: 18, margin: '0 0 12px' },
  muted: { color: '#6b6e86', fontSize: 14 },
  error: {
    background: '#fdecec',
    color: '#b42318',
    padding: 10,
    borderRadius: 8,
    fontSize: 13,
  },
  notice: {
    background: '#eef4ff',
    color: '#3538a5',
    padding: 10,
    borderRadius: 8,
    fontSize: 13,
  },
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    margin: '16px 0',
  },
  search: {
    border: '1px solid #e3e2ea',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 14,
    minWidth: 220,
  },
  tabs: { display: 'flex', gap: 6 },
  tab: {
    border: '1px solid #e3e2ea',
    background: '#fff',
    borderRadius: 999,
    padding: '6px 12px',
    fontSize: 13,
    cursor: 'pointer',
  },
  tabActive: { background: '#35374a', color: '#fff', borderColor: '#35374a' },
  checkbox: { display: 'flex', gap: 6, fontSize: 13, alignItems: 'center' },
  grid: {
    listStyle: 'none',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 12,
    padding: 0,
    margin: '0 0 24px',
  },
  card: {
    border: '1px solid #e3e2ea',
    borderRadius: 12,
    padding: 14,
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  cardTitle: { fontWeight: 700, fontSize: 15, color: '#252747' },
  cardMeta: { fontSize: 12, color: '#6b6e86', margin: 0 },
  tags: { fontSize: 12, color: '#5b54c7', margin: 0 },
  cardActions: { display: 'flex', gap: 12, marginTop: 4 },
  link: {
    background: 'transparent',
    border: 0,
    color: '#5b54c7',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    padding: 0,
  },
  empty: { fontSize: 14, color: '#6b6e86' },
  primaryButton: {
    background: '#5b54c7',
    color: '#fff',
    border: 0,
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    textAlign: 'center',
  },
  secondaryButton: {
    border: '1px solid #e3e2ea',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 600,
    color: '#35374a',
    background: '#fff',
  },
  templates: { marginTop: 8 },
};
