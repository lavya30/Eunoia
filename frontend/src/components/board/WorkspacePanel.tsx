'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/whiteboard/rooms-api';
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

function roleBadge(role: WorkspaceRole): string {
  return role === 'ADMIN' ? 'Admin' : role === 'EDITOR' ? 'Editor' : 'Viewer';
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function WorkspacePanel({
  userToken,
  userId,
  currentRoomId,
  onOpenRoom,
  onClose,
}: {
  userToken: string | undefined;
  userId: string | null;
  currentRoomId: string | null;
  onOpenRoom: (roomId: string) => void;
  onClose: () => void;
}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<WorkspaceRole>('VIEWER');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFolder, setNewFolder] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('EDITOR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    if (!userToken) return;
    try {
      const list = await listWorkspaces(userToken);
      setWorkspaces(list);
      if (list.length === 1) setSelectedId(list[0].workspace.id);
    } catch (err) {
      setError(errorMessage(err, 'Could not load workspaces.'));
    }
  }, [userToken]);

  /* eslint-disable react-hooks/set-state-in-effect -- initial server-state load on mount. */
  useEffect(() => {
    void refreshList();
  }, [refreshList]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const refreshDetail = useCallback(
    async (workspaceId: string) => {
      if (!userToken) return;
      try {
        const detail = await getWorkspace(workspaceId, userToken);
        const memberList = await listMembers(workspaceId, userToken);
        setOwnerId(detail.workspace.ownerId);
        setMyRole(detail.role);
        setFolders(detail.folders);
        setRooms(detail.rooms);
        setMembers(memberList.members);
        setAudit([]);
        setShowAudit(false);
        setError(null);
      } catch (err) {
        setError(errorMessage(err, 'Could not load workspace.'));
      }
    },
    [userToken],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- selection-driven server-state load. */
  useEffect(() => {
    if (selectedId) void refreshDetail(selectedId);
  }, [selectedId, refreshDetail]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const runGuarded = async (label: string, task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'SEATS_EXHAUSTED'
          ? 'Seat limit reached. Upgrade to Pro to invite more members.'
          : errorMessage(err, label),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!userToken) {
    return (
      <div
        className="room-dialog-backdrop"
        onClick={onClose}
        role="presentation"
      >
        <div
          className="room-gate-card room-dialog"
          role="dialog"
          aria-label="Workspaces"
          onClick={(event) => event.stopPropagation()}
        >
          <h1>Workspaces</h1>
          <p>Sign in to create and manage team workspaces.</p>
          <button
            type="button"
            className="room-gate-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

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
    <div className="room-dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="room-gate-card room-dialog"
        role="dialog"
        aria-label="Team workspaces"
        onClick={(event) => event.stopPropagation()}
        style={{ maxWidth: 560 }}
      >
        <h1>Workspaces</h1>
        <p>
          Team rooms, folders, and member roles share one billing seat pool.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            className="room-gate-input"
            type="text"
            placeholder="New workspace name"
            maxLength={120}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <button
            type="button"
            className="compile-button"
            disabled={busy || !newName.trim()}
            onClick={() =>
              void runGuarded('Could not create workspace.', async () => {
                const created = await createWorkspace(userToken, {
                  name: newName.trim(),
                });
                setNewName('');
                await refreshList();
                setSelectedId(created.workspace.id);
              })
            }
          >
            Create
          </button>
        </div>

        {error ? (
          <p className="room-gate-error" role="alert">
            {error}
          </p>
        ) : null}

        {workspaces.length > 0 ? (
          <div
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              marginBottom: 12,
            }}
          >
            {workspaces.map((entry) => (
              <button
                key={entry.workspace.id}
                type="button"
                onClick={() => setSelectedId(entry.workspace.id)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  border:
                    entry.workspace.id === selectedId
                      ? '2px solid #5b54c7'
                      : '1px solid #e3e2ea',
                  background:
                    entry.workspace.id === selectedId ? '#ede9ff' : '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: '#35374a',
                }}
              >
                {entry.workspace.name} · {roleBadge(entry.role)}
              </button>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, opacity: 0.7 }}>
            No workspaces yet — create one above.
          </p>
        )}

        {selected && selectedId ? (
          <div style={{ borderTop: '1px solid #eeedf2', paddingTop: 12 }}>
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
              Rooms ({rooms.length})
            </div>
            {rooms.length === 0 ? (
              <p style={{ fontSize: 13, opacity: 0.7 }}>
                No rooms yet — move a board here from its settings.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {rooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    disabled={room.id === currentRoomId}
                    onClick={() => onOpenRoom(room.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '8px 10px',
                      border: 0,
                      borderRadius: 10,
                      background:
                        room.id === currentRoomId ? '#f5f4fa' : 'transparent',
                      cursor: room.id === currentRoomId ? 'default' : 'pointer',
                      textAlign: 'left',
                      fontSize: 13,
                      color: '#35374a',
                    }}
                  >
                    <span style={{ fontWeight: 600, flex: 1 }}>
                      {room.name}
                    </span>
                    <span style={{ fontSize: 11, opacity: 0.65 }}>
                      {folderName(room.folderId)}
                      {room.id === currentRoomId ? ' · current' : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {canEdit ? (
              <form
                style={{ display: 'flex', gap: 8, marginTop: 8 }}
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = newFolder.trim();
                  if (!name) return;
                  void runGuarded('Could not create folder.', async () => {
                    await createFolder(selectedId, userToken, name);
                    setNewFolder('');
                    await refreshDetail(selectedId);
                  });
                }}
              >
                <input
                  className="room-gate-input"
                  type="text"
                  placeholder="New folder"
                  maxLength={120}
                  value={newFolder}
                  onChange={(event) => setNewFolder(event.target.value)}
                />
                <button type="submit" className="compile-button">
                  Add
                </button>
              </form>
            ) : null}

            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: '#8a8ca3',
                margin: '12px 0 6px',
              }}
            >
              Members ({members.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {members.map((member) => (
                <div
                  key={member.userId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    fontSize: 13,
                    color: '#35374a',
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {member.userId}
                  </span>
                  {canAdmin ? (
                    <select
                      aria-label={`Role for ${member.userId}`}
                      value={member.role}
                      onChange={(event) =>
                        void runGuarded('Could not change role.', async () => {
                          await updateMember(
                            selectedId,
                            member.userId,
                            userToken,
                            event.target.value as WorkspaceRole,
                          );
                          await refreshDetail(selectedId);
                        })
                      }
                      style={{
                        fontSize: 12,
                        borderRadius: 8,
                        padding: '4px 6px',
                      }}
                    >
                      <option value="VIEWER">Viewer</option>
                      <option value="EDITOR">Editor</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  ) : (
                    <span style={{ fontSize: 12, opacity: 0.65 }}>
                      {roleBadge(member.role)}
                    </span>
                  )}
                  {canAdmin ? (
                    <button
                      type="button"
                      onClick={() =>
                        void runGuarded(
                          'Could not remove member.',
                          async () => {
                            await removeMember(
                              selectedId,
                              member.userId,
                              userToken,
                            );
                            await refreshDetail(selectedId);
                          },
                        )
                      }
                      style={{
                        border: 0,
                        background: 'transparent',
                        color: '#e5484d',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      Remove
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
                  if (!email) return;
                  void runGuarded('Could not invite member.', async () => {
                    await inviteMember(selectedId, userToken, {
                      email,
                      role: inviteRole,
                    });
                    setInviteEmail('');
                    await refreshDetail(selectedId);
                  });
                }}
              >
                <input
                  className="room-gate-input"
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
                  style={{ fontSize: 13, borderRadius: 8, padding: '6px 8px' }}
                >
                  <option value="VIEWER">Viewer</option>
                  <option value="EDITOR">Editor</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <button type="submit" className="compile-button">
                  Invite
                </button>
              </form>
            ) : null}

            {canAdmin ? (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => {
                    if (showAudit) {
                      setShowAudit(false);
                      return;
                    }
                    if (!userToken || !selectedId) return;
                    void listAudit(userToken, {
                      workspaceId: selectedId,
                      limit: 30,
                    })
                      .then((res) => {
                        setAudit(res.events);
                        setShowAudit(true);
                      })
                      .catch((err) =>
                        setError(
                          err instanceof Error
                            ? err.message
                            : 'Could not load audit log.',
                        ),
                      );
                  }}
                  style={{
                    border: 0,
                    background: 'transparent',
                    color: '#5b54c7',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    padding: 0,
                  }}
                >
                  {showAudit ? 'Hide audit log' : 'View audit log'}
                </button>
                {showAudit ? (
                  <div
                    role="log"
                    aria-label="Workspace audit log"
                    style={{
                      marginTop: 6,
                      maxHeight: 180,
                      overflowY: 'auto',
                      fontSize: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    {audit.length === 0 ? (
                      <span style={{ opacity: 0.65 }}>
                        No audited actions yet.
                      </span>
                    ) : (
                      audit.map((event) => (
                        <div key={event.id} style={{ color: '#35374a' }}>
                          <span style={{ fontWeight: 700 }}>
                            {event.action}
                          </span>{' '}
                          <span style={{ opacity: 0.65 }}>
                            {new Date(event.createdAt).toLocaleString()}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {isOwner ? (
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
                    await deleteWorkspace(selectedId, userToken);
                    setSelectedId(null);
                    await refreshList();
                  });
                }}
                style={{
                  marginTop: 12,
                  border: 0,
                  background: 'transparent',
                  color: '#e5484d',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Delete workspace
              </button>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          className="room-gate-secondary"
          onClick={onClose}
          style={{ marginTop: 12 }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
