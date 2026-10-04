'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, loadSession, type AuthSession } from '@/lib/whiteboard/auth';
import {
  fetchSubscription,
  type SubscriptionData,
} from '@/lib/whiteboard/billing-api';
import {
  createFolder,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  inviteMember,
  listAudit,
  listMembers,
  listWorkspaces,
  removeMember,
  updateMember,
  type AuditRecord,
  type Folder,
  type Membership,
  type RoomSummary,
  type WorkspaceRole,
  type WorkspaceWithRole,
} from '@/lib/whiteboard/workspaces-api';

type Tab = 'teams' | 'audit' | 'usage';

const AI_QUOTA_BY_TIER: Record<string, number> = {
  COMMUNITY: 10,
  PRO: 500,
  ENTERPRISE: 2000,
};

import {
  roleBadge,
  useGuardedWorkspace,
  workspaceErrorMessage,
} from '@/lib/whiteboard/workspace-helpers';

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function WorkspacesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [mounted, setMounted] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot hydration gate, not a render loop. */
  useEffect(() => {
    setMounted(true);
    setSession(loadSession());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const tab: Tab =
    searchParams.get('tab') === 'audit'
      ? 'audit'
      : searchParams.get('tab') === 'usage'
        ? 'usage'
        : 'teams';
  const selectedId = searchParams.get('workspace');

  const goTab = useCallback(
    (next: Tab, workspaceId: string | null = selectedId) => {
      const params = new URLSearchParams();
      params.set('tab', next);
      if (workspaceId) params.set('workspace', workspaceId);
      router.replace(`/workspaces?${params.toString()}`);
    },
    [router, selectedId],
  );

  const selectWorkspace = useCallback(
    (workspaceId: string | null) => {
      const params = new URLSearchParams();
      params.set('tab', tab);
      if (workspaceId) params.set('workspace', workspaceId);
      router.replace(`/workspaces?${params.toString()}`);
    },
    [router, tab],
  );

  if (!mounted) return null;
  if (!session) {
    return (
      <main style={styles.page}>
        <div style={{ ...styles.card, textAlign: 'center' }}>
          <h1 style={styles.h1}>Workspaces</h1>
          <p style={styles.muted}>
            Sign in to create and manage team workspaces — no board required.
          </p>
          <Link href="/login?next=/workspaces" style={styles.primaryButton}>
            Sign in
          </Link>
        </div>
      </main>
    );
  }
  return (
    <main style={styles.page}>
      <div style={styles.wrap}>
        <div style={{ marginBottom: 8 }}>
          <Link href="/" style={styles.backLink}>
            ← Eunoia
          </Link>
        </div>
        <h1 style={styles.h1}>Workspaces</h1>
        <p style={styles.muted}>
          Signed in as {session.user.email} · {session.user.tier ?? 'COMMUNITY'}
        </p>
        <nav style={styles.tabs} aria-label="Workspace sections">
          {(['teams', 'audit', 'usage'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => goTab(t)}
              aria-current={t === tab ? 'page' : undefined}
              style={{
                ...styles.tab,
                ...(t === tab ? styles.tabActive : null),
              }}
            >
              {t === 'teams' ? 'Teams' : t === 'audit' ? 'Audit log' : 'Usage'}
            </button>
          ))}
        </nav>
        {tab === 'teams' ? (
          <TeamsTab
            token={session.token}
            userId={session.user.id}
            selectedId={selectedId}
            onSelect={selectWorkspace}
            onViewAudit={(workspaceId) => goTab('audit', workspaceId)}
          />
        ) : tab === 'audit' ? (
          <AuditTab token={session.token} selectedId={selectedId} />
        ) : (
          <UsageTab
            token={session.token}
            tier={session.user.tier ?? 'COMMUNITY'}
          />
        )}
        <div style={{ marginTop: 24, fontSize: 13, display: 'flex', gap: 16 }}>
          <Link href="/board" style={styles.inlineLink}>
            Open a board →
          </Link>
          <Link href="/billing" style={styles.inlineLink}>
            Billing →
          </Link>
          <Link href="/settings" style={styles.inlineLink}>
            Settings →
          </Link>
          <Link href="/status" style={styles.inlineLink}>
            System status →
          </Link>
        </div>
      </div>
    </main>
  );
}

function TeamsTab({
  token,
  userId,
  selectedId,
  onSelect,
  onViewAudit,
}: {
  token: string;
  userId: string;
  selectedId: string | null;
  onSelect: (workspaceId: string | null) => void;
  onViewAudit: (workspaceId: string) => void;
}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<WorkspaceRole>('VIEWER');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [newName, setNewName] = useState('');
  const [newFolder, setNewFolder] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('EDITOR');
  const { busy, error, setError, runGuarded } = useGuardedWorkspace();

  const refreshList = useCallback(async () => {
    try {
      const list = await listWorkspaces(token);
      setWorkspaces(list);
      if (!selectedId && list.length === 1) onSelect(list[0].workspace.id);
    } catch (err) {
      setError(workspaceErrorMessage(err, 'Could not load workspaces.'));
    }
  }, [token, selectedId, onSelect, setError]);

  /* eslint-disable react-hooks/set-state-in-effect -- initial server-state load on mount. */
  useEffect(() => {
    void refreshList();
  }, [refreshList]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const refreshDetail = useCallback(
    async (workspaceId: string) => {
      try {
        const detail = await getWorkspace(workspaceId, token);
        const memberList = await listMembers(workspaceId, token);
        setOwnerId(detail.workspace.ownerId);
        setMyRole(detail.role);
        setFolders(detail.folders);
        setRooms(detail.rooms);
        setMembers(memberList.members);
        setError(null);
      } catch (err) {
        setError(workspaceErrorMessage(err, 'Could not load workspace.'));
      }
    },
    [token, setError],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- selection-driven server-state load. */
  useEffect(() => {
    if (selectedId) void refreshDetail(selectedId);
  }, [selectedId, refreshDetail]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const selected = workspaces.find(
    (entry) => entry.workspace.id === selectedId,
  );
  const isOwner = ownerId !== null && ownerId === userId;
  const canEdit = myRole === 'ADMIN' || myRole === 'EDITOR';
  const canAdmin = myRole === 'ADMIN';
  const folderName = (folderId: string | null) =>
    folderId
      ? (folders.find((folder) => folder.id === folderId)?.name ?? '—')
      : 'No folder';

  return (
    <div style={styles.grid}>
      <section style={styles.card} aria-label="Workspace list">
        <h2 style={styles.h2}>Teams</h2>
        <form
          style={{ display: 'flex', gap: 8, marginBottom: 12 }}
          onSubmit={(event) => {
            event.preventDefault();
            const name = newName.trim();
            if (!name) return;
            void runGuarded('Could not create workspace.', async () => {
              const created = await createWorkspace(token, { name });
              setNewName('');
              await refreshList();
              onSelect(created.workspace.id);
            });
          }}
        >
          <input
            style={styles.input}
            type="text"
            placeholder="New workspace name"
            maxLength={120}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <button
            type="submit"
            style={styles.primaryButton}
            disabled={busy || !newName.trim()}
          >
            Create
          </button>
        </form>
        {error ? (
          <p style={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {workspaces.length === 0 ? (
          <p style={styles.muted}>No workspaces yet — create one above.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {workspaces.map((entry) => (
              <button
                key={entry.workspace.id}
                type="button"
                onClick={() => onSelect(entry.workspace.id)}
                style={{
                  ...styles.listButton,
                  ...(entry.workspace.id === selectedId
                    ? styles.listButtonActive
                    : null),
                }}
              >
                <span style={{ fontWeight: 600 }}>{entry.workspace.name}</span>
                <span style={styles.mutedSmall}>{roleBadge(entry.role)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section style={styles.card} aria-label="Workspace detail">
        {!selected || !selectedId ? (
          <p style={styles.muted}>
            Select a team to manage its rooms, folders, and members.
          </p>
        ) : (
          <>
            <h2 style={styles.h2}>{selected.workspace.name}</h2>
            <p style={styles.mutedSmall}>
              {roleBadge(myRole)} · {rooms.length} rooms · {members.length}{' '}
              members
            </p>

            <h3 style={styles.h3}>Rooms</h3>
            {rooms.length === 0 ? (
              <p style={styles.muted}>
                No rooms yet — move a board here from its settings.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {rooms.map((room) => (
                  <div key={room.id} style={styles.row}>
                    <Link
                      href={`/board?room=${encodeURIComponent(room.id)}`}
                      style={{ fontWeight: 600, color: '#5b54c7' }}
                    >
                      {room.name}
                    </Link>
                    <span style={styles.mutedSmall}>
                      {folderName(room.folderId)}
                      {room.tier !== 'COMMUNITY' ? ` · ${room.tier}` : ''}
                      {room.hasPassword ? ' · locked' : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {canEdit ? (
              <form
                style={{ display: 'flex', gap: 8, marginTop: 8 }}
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = newFolder.trim();
                  if (!name || !selectedId) return;
                  void runGuarded('Could not create folder.', async () => {
                    await createFolder(selectedId, token, name);
                    setNewFolder('');
                    await refreshDetail(selectedId);
                  });
                }}
              >
                <input
                  style={styles.input}
                  type="text"
                  placeholder="New folder"
                  maxLength={120}
                  value={newFolder}
                  onChange={(event) => setNewFolder(event.target.value)}
                />
                <button type="submit" style={styles.primaryButton}>
                  Add
                </button>
              </form>
            ) : null}

            <h3 style={styles.h3}>Members</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {members.map((member) => (
                <div key={member.userId} style={styles.row}>
                  <span style={styles.ellipsis} title={member.userId}>
                    {member.userId}
                    {member.userId === ownerId ? ' · owner' : ''}
                  </span>
                  {canAdmin && member.userId !== ownerId ? (
                    <>
                      <select
                        aria-label={`Role for ${member.userId}`}
                        value={member.role}
                        onChange={(event) =>
                          void runGuarded(
                            'Could not change role.',
                            async () => {
                              if (!selectedId) return;
                              await updateMember(
                                selectedId,
                                member.userId,
                                token,
                                event.target.value as WorkspaceRole,
                              );
                              await refreshDetail(selectedId);
                            },
                          )
                        }
                        style={styles.select}
                      >
                        <option value="VIEWER">Viewer</option>
                        <option value="EDITOR">Editor</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          void runGuarded(
                            'Could not remove member.',
                            async () => {
                              if (!selectedId) return;
                              await removeMember(
                                selectedId,
                                member.userId,
                                token,
                              );
                              await refreshDetail(selectedId);
                            },
                          )
                        }
                        style={styles.dangerLink}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span style={styles.mutedSmall}>
                      {roleBadge(member.role)}
                    </span>
                  )}
                  {!isOwner && member.userId === userId ? (
                    <button
                      type="button"
                      onClick={() =>
                        void runGuarded(
                          'Could not leave workspace.',
                          async () => {
                            if (!selectedId) return;
                            await removeMember(
                              selectedId,
                              member.userId,
                              token,
                            );
                            onSelect(null);
                            await refreshList();
                          },
                        )
                      }
                      style={styles.dangerLink}
                    >
                      Leave
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            {canAdmin ? (
              <form
                style={{ display: 'flex', gap: 8, marginTop: 8 }}
                onSubmit={(event) => {
                  event.preventDefault();
                  const email = inviteEmail.trim();
                  if (!email || !selectedId) return;
                  void runGuarded('Could not invite member.', async () => {
                    await inviteMember(selectedId, token, {
                      email,
                      role: inviteRole,
                    });
                    setInviteEmail('');
                    await refreshDetail(selectedId);
                  });
                }}
              >
                <input
                  style={styles.input}
                  type="email"
                  placeholder="Invite by email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
                <select
                  aria-label="Invite role"
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(event.target.value as WorkspaceRole)
                  }
                  style={styles.select}
                >
                  <option value="VIEWER">Viewer</option>
                  <option value="EDITOR">Editor</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <button type="submit" style={styles.primaryButton}>
                  Invite
                </button>
              </form>
            ) : null}

            <div style={{ marginTop: 12, display: 'flex', gap: 16 }}>
              {canAdmin && selectedId ? (
                <button
                  type="button"
                  onClick={() => onViewAudit(selectedId)}
                  style={styles.linkButton}
                >
                  View audit log →
                </button>
              ) : null}
              {isOwner && selectedId ? (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Delete workspace "${selected.workspace.name}"? Rooms detach to personal.`,
                      )
                    )
                      return;
                    void runGuarded('Could not delete workspace.', async () => {
                      if (!selectedId) return;
                      await deleteWorkspace(selectedId, token);
                      onSelect(null);
                      await refreshList();
                    });
                  }}
                  style={styles.dangerLink}
                >
                  Delete workspace
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function AuditTab({
  token,
  selectedId,
}: {
  token: string;
  selectedId: string | null;
}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);
  const [scope, setScope] = useState<string>(selectedId ?? 'mine');
  const [filter, setFilter] = useState('');
  const [events, setEvents] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const { error, setError } = useGuardedWorkspace();

  /* Initial server-state load on mount. */
  useEffect(() => {
    listWorkspaces(token)
      .then(setWorkspaces)
      .catch((err) =>
        setError(workspaceErrorMessage(err, 'Could not load workspaces.')),
      );
  }, [token, setError]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res =
        scope === 'mine'
          ? await listAudit(token, { mine: true, limit: 100 })
          : await listAudit(token, { workspaceId: scope, limit: 100 });
      setEvents(res.events);
    } catch (err) {
      setError(workspaceErrorMessage(err, 'Could not load audit log.'));
    } finally {
      setLoading(false);
    }
  }, [token, scope, setError]);

  /* eslint-disable react-hooks/set-state-in-effect -- scope-driven server-state load. */
  useEffect(() => {
    void load();
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return events;
    return events.filter(
      (event) =>
        event.action.toLowerCase().includes(needle) ||
        (event.actorId ?? '').toLowerCase().includes(needle) ||
        (event.target ?? '').toLowerCase().includes(needle),
    );
  }, [events, filter]);

  return (
    <section style={styles.card} aria-label="Audit log">
      <h2 style={styles.h2}>Audit log</h2>
      <p style={styles.muted}>
        Workspace scopes require an Admin role; “My activity” shows your own
        actions across workspaces.
      </p>
      <div
        style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}
      >
        <select
          aria-label="Audit scope"
          value={scope}
          onChange={(event) => setScope(event.target.value)}
          style={styles.select}
        >
          <option value="mine">My activity</option>
          {workspaces.map((entry) => (
            <option key={entry.workspace.id} value={entry.workspace.id}>
              {entry.workspace.name}
            </option>
          ))}
        </select>
        <input
          style={{ ...styles.input, maxWidth: 240 }}
          type="search"
          placeholder="Filter by action, actor, target…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={styles.primaryButton}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {error ? (
        <p style={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {visible.length === 0 && !loading ? (
        <p style={styles.muted}>No audited actions match.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Time</th>
                <th style={styles.th}>Action</th>
                <th style={styles.th}>Actor</th>
                <th style={styles.th}>Target</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((event) => (
                <tr key={event.id}>
                  <td style={styles.td}>{formatTime(event.createdAt)}</td>
                  <td style={{ ...styles.td, fontWeight: 700 }}>
                    {event.action}
                  </td>
                  <td style={{ ...styles.td, ...styles.ellipsis }}>
                    {event.actorId ?? '—'}
                  </td>
                  <td style={{ ...styles.td, ...styles.ellipsis }}>
                    {event.target ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function UsageTab({ token, tier }: { token: string; tier: string }) {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(
    null,
  );
  const [aiActivity, setAiActivity] = useState<AuditRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [billingUnconfigured, setBillingUnconfigured] = useState(false);

  /* Initial server-state load on mount. */
  useEffect(() => {
    fetchSubscription(token)
      .then((res) => setSubscription(res.subscription))
      .catch((err) => {
        // Development without Razorpay keys is not an error state — tiers
        // stay database-managed until billing is configured.
        if (err instanceof ApiError && err.code === 'BILLING_NOT_CONFIGURED') {
          setBillingUnconfigured(true);
          return;
        }
        setError(workspaceErrorMessage(err, 'Could not load subscription.'));
      });
    listAudit(token, { mine: true, limit: 100 })
      .then((res) =>
        setAiActivity(
          res.events.filter((event) => event.action.startsWith('ai.')),
        ),
      )
      .catch(() => undefined);
  }, [token]);

  const quotaLimit = AI_QUOTA_BY_TIER[tier] ?? AI_QUOTA_BY_TIER.COMMUNITY;

  return (
    <div style={styles.grid}>
      <section style={styles.card} aria-label="Plan and seats">
        <h2 style={styles.h2}>Plan & seats</h2>
        {error ? (
          <p style={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {billingUnconfigured ? (
          <p style={styles.muted}>
            No billing provider connected — tiers are database-managed in this
            environment.
          </p>
        ) : null}
        <dl style={styles.dl}>
          <div style={styles.dlRow}>
            <dt style={styles.muted}>Your tier</dt>
            <dd style={styles.dd}>{tier}</dd>
          </div>
          <div style={styles.dlRow}>
            <dt style={styles.muted}>Seats</dt>
            <dd style={styles.dd}>{subscription ? subscription.seats : '—'}</dd>
          </div>
          <div style={styles.dlRow}>
            <dt style={styles.muted}>Period ends</dt>
            <dd style={styles.dd}>
              {subscription?.periodEnd
                ? formatTime(subscription.periodEnd)
                : '—'}
            </dd>
          </div>
          <div style={styles.dlRow}>
            <dt style={styles.muted}>Subscription status</dt>
            <dd style={styles.dd}>
              {subscription ? subscription.status : 'No subscription'}
            </dd>
          </div>
        </dl>
        <Link href="/billing" style={styles.inlineLink}>
          Manage billing →
        </Link>
      </section>

      <section style={styles.card} aria-label="AI usage">
        <h2 style={styles.h2}>AI usage</h2>
        <p style={styles.muted}>
          {tier} plans include {quotaLimit} AI generations per month. Your
          remaining quota is reported with every generation in the board editor.
        </p>
        <h3 style={styles.h3}>Recent AI activity</h3>
        {aiActivity.length === 0 ? (
          <p style={styles.muted}>
            No AI generations yet — describe a diagram in any board’s D2 panel
            to start.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {aiActivity.slice(0, 20).map((event) => (
              <div key={event.id} style={styles.row}>
                <span style={{ fontWeight: 700 }}>{event.action}</span>
                <span style={styles.mutedSmall}>
                  {formatTime(event.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    padding: '48px 20px',
    display: 'flex',
    justifyContent: 'center',
    background: '#faf9f7',
    color: '#25263a',
  },
  wrap: { width: '100%', maxWidth: 960 },
  backLink: { fontSize: 13, color: '#5b54c7', fontWeight: 600 },
  h1: { fontSize: 28, margin: '0 0 4px' },
  h2: { fontSize: 18, margin: '0 0 8px' },
  h3: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: '#8a8ca3',
    margin: '16px 0 6px',
  },
  muted: { fontSize: 13, color: '#6b6d85', margin: '0 0 16px' },
  mutedSmall: { fontSize: 12, color: '#6b6d85' },
  card: {
    background: '#fff',
    border: '1px solid #e3e2ea',
    borderRadius: 12,
    padding: 20,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 16,
    alignItems: 'start',
  },
  tabs: { display: 'flex', gap: 8, margin: '16px 0' },
  tab: {
    padding: '8px 16px',
    borderRadius: 999,
    border: '1px solid #e3e2ea',
    background: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    color: '#35374a',
  },
  tabActive: {
    border: '2px solid #5b54c7',
    background: '#ede9ff',
  },
  input: {
    flex: 1,
    fontSize: 13,
    borderRadius: 8,
    border: '1px solid #e3e2ea',
    padding: '8px 10px',
    minWidth: 0,
  },
  select: { fontSize: 13, borderRadius: 8, padding: '6px 8px' },
  primaryButton: {
    fontSize: 13,
    fontWeight: 700,
    borderRadius: 8,
    border: 0,
    background: '#5b54c7',
    color: '#fff',
    padding: '8px 14px',
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-block',
  },
  error: {
    fontSize: 13,
    color: '#e5484d',
    background: '#fdecec',
    borderRadius: 8,
    padding: '8px 12px',
  },
  listButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #e3e2ea',
    borderRadius: 10,
    background: '#fff',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: 13,
    color: '#35374a',
  },
  listButtonActive: { border: '2px solid #5b54c7', background: '#ede9ff' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    fontSize: 13,
    color: '#35374a',
  },
  ellipsis: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  linkButton: {
    border: 0,
    background: 'transparent',
    color: '#5b54c7',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    padding: 0,
  },
  dangerLink: {
    border: 0,
    background: 'transparent',
    color: '#e5484d',
    cursor: 'pointer',
    fontSize: 12,
  },
  inlineLink: { color: '#5b54c7', fontWeight: 600 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: '#8a8ca3',
    padding: '8px 10px',
    borderBottom: '2px solid #eeedf2',
  },
  td: {
    padding: '8px 10px',
    borderBottom: '1px solid #f0eff4',
    color: '#35374a',
    verticalAlign: 'top',
  },
  dl: { margin: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  dlRow: { display: 'flex', justifyContent: 'space-between', gap: 12 },
  dd: { margin: 0, fontWeight: 700, fontSize: 13 },
};
