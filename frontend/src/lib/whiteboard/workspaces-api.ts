import { ApiError } from './rooms-api';
import { resolveSyncHttpUrl } from './sync';

export type WorkspaceRole = 'ADMIN' | 'EDITOR' | 'VIEWER';

export type Workspace = {
  id: string;
  name: string;
  ownerId: string;
  tier: 'COMMUNITY' | 'PRO' | 'ENTERPRISE';
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceWithRole = {
  workspace: Workspace;
  role: WorkspaceRole;
};

export type Folder = {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
};

export type Membership = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: string;
};

export type RoomSummary = {
  id: string;
  name: string;
  ownerId: string;
  tier: 'COMMUNITY' | 'PRO' | 'ENTERPRISE';
  workspaceId: string | null;
  folderId: string | null;
  hasPassword: boolean;
};

function baseUrl(): string {
  const url = resolveSyncHttpUrl();
  if (!url)
    throw new ApiError(
      0,
      'Live services are unavailable until NEXT_PUBLIC_SYNC_SERVER_URL is configured.',
    );
  return url;
}

async function request<T>(
  method: string,
  path: string,
  options: { userToken?: string; body?: unknown } = {},
): Promise<T> {
  const url = `${baseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(options.body !== undefined
          ? { 'content-type': 'application/json' }
          : {}),
        ...(options.userToken
          ? { authorization: `Bearer ${options.userToken}` }
          : {}),
      },
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(
      0,
      'Could not reach the sync server. Check your connection.',
    );
  }
  if (method === 'DELETE' && response.status === 204) return undefined as T;
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text.trim() ? (JSON.parse(text) as unknown) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const body =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : null;
    throw new ApiError(
      response.status,
      body && typeof body.error === 'string' && body.error
        ? body.error
        : text.trim().slice(0, 200) || `Request failed (${response.status}).`,
      body && typeof body.code === 'string' ? body.code : null,
    );
  }
  return payload as T;
}

export async function listWorkspaces(
  userToken: string,
): Promise<WorkspaceWithRole[]> {
  const res = await request<{ workspaces: WorkspaceWithRole[] }>(
    'GET',
    '/api/workspaces',
    { userToken },
  );
  return res.workspaces;
}

export async function createWorkspace(
  userToken: string,
  input: { name: string; tier?: Workspace['tier'] },
): Promise<{ workspace: Workspace; role: WorkspaceRole }> {
  return request('POST', '/api/workspaces', { userToken, body: input });
}

export async function getWorkspace(
  workspaceId: string,
  userToken: string,
): Promise<{
  workspace: Workspace;
  role: WorkspaceRole;
  folders: Folder[];
  rooms: RoomSummary[];
}> {
  return request('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}`, {
    userToken,
  });
}

export async function deleteWorkspace(
  workspaceId: string,
  userToken: string,
): Promise<void> {
  await request(
    'DELETE',
    `/api/workspaces/${encodeURIComponent(workspaceId)}`,
    {
      userToken,
    },
  );
}

export async function createFolder(
  workspaceId: string,
  userToken: string,
  name: string,
): Promise<{ folder: Folder }> {
  return request(
    'POST',
    `/api/workspaces/${encodeURIComponent(workspaceId)}/folders`,
    { userToken, body: { name } },
  );
}

export async function inviteMember(
  workspaceId: string,
  userToken: string,
  input: { userId?: string; email?: string; role?: WorkspaceRole },
): Promise<{ membership: Membership }> {
  return request(
    'POST',
    `/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
    { userToken, body: input },
  );
}

export async function listMembers(
  workspaceId: string,
  userToken: string,
): Promise<{ members: Membership[] }> {
  return request(
    'GET',
    `/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
    { userToken },
  );
}

export async function updateMember(
  workspaceId: string,
  memberId: string,
  userToken: string,
  role: WorkspaceRole,
): Promise<{ membership: Membership }> {
  return request(
    'PATCH',
    `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
    { userToken, body: { role } },
  );
}

export async function removeMember(
  workspaceId: string,
  memberId: string,
  userToken: string,
): Promise<void> {
  await request(
    'DELETE',
    `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
    { userToken },
  );
}

export type AuditRecord = {
  id: string;
  actorId: string | null;
  workspaceId: string | null;
  action: string;
  target: string | null;
  createdAt: string;
};

export async function listAudit(
  userToken: string,
  query: { workspaceId?: string; mine?: boolean; limit?: number } = {},
): Promise<{ events: AuditRecord[] }> {
  const params = new URLSearchParams();
  if (query.workspaceId) params.set('workspaceId', query.workspaceId);
  if (query.mine) params.set('mine', '1');
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return request('GET', `/api/audit${suffix}`, { userToken });
}

export async function listRooms(
  userToken: string,
  workspaceId?: string,
): Promise<{ rooms: RoomSummary[] }> {
  const query = workspaceId
    ? `?workspaceId=${encodeURIComponent(workspaceId)}`
    : '';
  return request('GET', `/api/rooms${query}`, { userToken });
}

export async function moveRoom(
  roomId: string,
  ticket: string | undefined,
  userToken: string | undefined,
  input: { workspaceId: string | null; folderId?: string | null },
): Promise<RoomSummary & { hasPassword: boolean }> {
  const url = new URL(
    `${baseUrl()}/api/rooms/${encodeURIComponent(roomId)}/move`,
  );
  if (ticket) url.searchParams.set('ticket', ticket);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(ticket
          ? { authorization: `Bearer ${ticket}` }
          : userToken
            ? { authorization: `Bearer ${userToken}` }
            : {}),
        ...(userToken ? { 'x-user-token': userToken } : {}),
      },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ApiError(
      0,
      'Could not reach the sync server. Check your connection.',
    );
  }
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text.trim() ? (JSON.parse(text) as unknown) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const body =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : null;
    throw new ApiError(
      response.status,
      body && typeof body.error === 'string' && body.error
        ? body.error
        : text.trim().slice(0, 200) || `Request failed (${response.status}).`,
      body && typeof body.code === 'string' ? body.code : null,
    );
  }
  return payload as RoomSummary & { hasPassword: boolean };
}
