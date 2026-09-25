import { resolveSyncHttpUrl } from './sync';

export type RoomTier = 'COMMUNITY' | 'PRO' | 'ENTERPRISE';

export type RoomMetadata = {
  id: string;
  name: string;
  ownerId: string;
  tier: RoomTier;
  hasPassword: boolean;
};

export type UnlockResult = {
  ticket: string;
  expiresIn: number;
  roomId: string;
};

export type SnapshotMeta = {
  id: string;
  docVersion: string;
  createdAt: string;
};

export type RestoreResult = {
  restored: string;
  restoredAt: string;
};

export type ImageKind = 'image' | 'thumbnail';

export type StoredImage = {
  id: string;
  roomId: string;
  key: string;
  url: string;
  contentType: string;
  size: number | null;
  kind: ImageKind;
  createdAt: string;
  updatedAt: string;
};

export type UploadGrant = {
  key: string;
  uploadUrl: string;
  expiresIn: number;
  contentType: string;
  kind: ImageKind;
};

export type ImageUrl = {
  url: string;
  expiresIn: number | null;
};

export type ValidationIssue = {
  path: string;
  message: string;
  code: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly issues: ValidationIssue[];

  constructor(
    status: number,
    message: string,
    code: string | null = null,
    issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

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
  options: {
    ticket?: string;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
  } = {},
): Promise<T> {
  const url = new URL(`${baseUrl()}${path}`);
  if (options.ticket) url.searchParams.set('ticket', options.ticket);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers: {
        ...(options.body !== undefined
          ? { 'content-type': 'application/json' }
          : {}),
        ...(options.ticket
          ? { authorization: `Bearer ${options.ticket}` }
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
  const payload: unknown = text.trim() ? safeJson(text) : null;
  if (!response.ok) throw toApiError(response.status, payload, text);
  return payload as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toApiError(status: number, payload: unknown, raw: string): ApiError {
  const body =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : null;
  const message =
    body && typeof body.error === 'string' && body.error
      ? body.error
      : raw.trim().slice(0, 200) || `Request failed (${status}).`;
  const code = body && typeof body.code === 'string' ? body.code : null;
  const issues =
    body && Array.isArray(body.issues)
      ? (body.issues as ValidationIssue[]).filter(
          (issue) => issue && typeof issue.message === 'string',
        )
      : [];
  return new ApiError(status, message, code, issues);
}

export function isRoomNotFound(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    error.code === 'ROOM_NOT_FOUND'
  );
}

export function isRoomLocked(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    error.code === 'ROOM_LOCKED'
  );
}

export async function createRoom(
  input: {
    name?: string;
    ownerId?: string;
    password?: string;
    tier?: RoomTier;
  } = {},
): Promise<RoomMetadata> {
  return request<RoomMetadata>('POST', '/api/rooms', { body: input });
}

export async function getRoom(
  roomId: string,
  ticket?: string,
): Promise<RoomMetadata> {
  return request<RoomMetadata>(
    'GET',
    `/api/rooms/${encodeURIComponent(roomId)}`,
    { ticket },
  );
}

export async function unlockRoom(
  roomId: string,
  password?: string,
): Promise<UnlockResult> {
  return request<UnlockResult>(
    'POST',
    `/api/rooms/${encodeURIComponent(roomId)}/unlock`,
    {
      body: { password },
    },
  );
}

export async function deleteRoom(
  roomId: string,
  ticket?: string,
): Promise<void> {
  await request<void>('DELETE', `/api/rooms/${encodeURIComponent(roomId)}`, {
    ticket,
  });
}

export async function updateRoom(
  roomId: string,
  ticket: string | undefined,
  input: {
    name?: string;
    ownerId?: string;
    tier?: RoomTier;
    password?: string | null;
  },
): Promise<RoomMetadata> {
  return request<RoomMetadata>(
    'PATCH',
    `/api/rooms/${encodeURIComponent(roomId)}`,
    { ticket, body: input },
  );
}

export async function listSnapshots(
  roomId: string,
  ticket: string | undefined,
  query: { limit?: number; before?: string } = {},
): Promise<SnapshotMeta[]> {
  return request<SnapshotMeta[]>(
    'GET',
    `/api/rooms/${encodeURIComponent(roomId)}/snapshots`,
    {
      ticket,
      query,
    },
  );
}

export async function restoreSnapshot(
  roomId: string,
  snapshotId: string,
  ticket?: string,
): Promise<RestoreResult> {
  return request<RestoreResult>(
    'POST',
    `/api/rooms/${encodeURIComponent(roomId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`,
    { ticket },
  );
}

export async function requestImageUpload(
  roomId: string,
  ticket: string | undefined,
  input: { contentType: string; kind?: ImageKind },
): Promise<UploadGrant> {
  return request<UploadGrant>(
    'POST',
    `/api/rooms/${encodeURIComponent(roomId)}/images/request-upload`,
    {
      ticket,
      body: input,
    },
  );
}

export async function uploadImageBytes(
  uploadUrl: string,
  bytes: Blob,
  contentType: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: bytes,
    });
  } catch {
    throw new ApiError(0, 'Image upload failed: could not reach storage.');
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      `Image upload failed (${response.status}).`,
    );
  }
}

export async function confirmImageUpload(
  roomId: string,
  ticket: string | undefined,
  input: { key: string; contentType?: string; size?: number; kind?: ImageKind },
): Promise<StoredImage> {
  return request<StoredImage>(
    'POST',
    `/api/rooms/${encodeURIComponent(roomId)}/images/confirm`,
    {
      ticket,
      body: input,
    },
  );
}

export async function listImages(
  roomId: string,
  ticket: string | undefined,
  kind?: ImageKind,
): Promise<StoredImage[]> {
  return request<StoredImage[]>(
    'GET',
    `/api/rooms/${encodeURIComponent(roomId)}/images`,
    {
      ticket,
      query: { kind },
    },
  );
}

export async function freshImageUrl(
  roomId: string,
  imageId: string,
  ticket?: string,
): Promise<ImageUrl> {
  return request<ImageUrl>(
    'GET',
    `/api/rooms/${encodeURIComponent(roomId)}/images/${encodeURIComponent(imageId)}/url`,
    { ticket },
  );
}

export async function deleteImage(
  roomId: string,
  imageId: string,
  ticket?: string,
): Promise<void> {
  await request<void>(
    'DELETE',
    `/api/rooms/${encodeURIComponent(roomId)}/images/${encodeURIComponent(imageId)}`,
    { ticket },
  );
}
