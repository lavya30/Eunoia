import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export type AuditRecord = {
  id: string;
  actorId: string | null;
  workspaceId: string | null;
  action: string;
  target: string | null;
  createdAt: Date;
};

export type AuditQuery = {
  workspaceId?: string;
  actorId?: string;
  limit?: number;
  before?: Date;
};

export interface AuditStore {
  recordEvent(input: {
    actorId?: string | null;
    workspaceId?: string | null;
    action: string;
    target?: string | null;
  }): Promise<AuditRecord>;
  listEvents(query?: AuditQuery): Promise<AuditRecord[]>;
}

const DEFAULT_LIMIT = 50;

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(200, Math.max(1, Math.floor(limit)));
}

export class MemoryAuditStore implements AuditStore {
  private readonly events: AuditRecord[] = [];

  async recordEvent(input: {
    actorId?: string | null;
    workspaceId?: string | null;
    action: string;
    target?: string | null;
  }): Promise<AuditRecord> {
    const record: AuditRecord = {
      id: randomUUID(),
      actorId: input.actorId ?? null,
      workspaceId: input.workspaceId ?? null,
      action: input.action,
      target: input.target ?? null,
      createdAt: new Date(),
    };
    this.events.push(record);
    return record;
  }

  async listEvents(query: AuditQuery = {}): Promise<AuditRecord[]> {
    const limit = clampLimit(query.limit);
    return this.events
      .filter(
        (event) =>
          (query.workspaceId === undefined ||
            event.workspaceId === query.workspaceId) &&
          (query.actorId === undefined || event.actorId === query.actorId) &&
          (!query.before || event.createdAt < query.before),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}

export class PrismaAuditStore implements AuditStore {
  constructor(private readonly prisma: PrismaClient) {}

  async recordEvent(input: {
    actorId?: string | null;
    workspaceId?: string | null;
    action: string;
    target?: string | null;
  }): Promise<AuditRecord> {
    return (await this.prisma.auditEvent.create({ data: input })) as AuditRecord;
  }

  async listEvents(query: AuditQuery = {}): Promise<AuditRecord[]> {
    return (await this.prisma.auditEvent.findMany({
      where: {
        ...(query.workspaceId !== undefined
          ? { workspaceId: query.workspaceId }
          : {}),
        ...(query.actorId !== undefined ? { actorId: query.actorId } : {}),
        ...(query.before ? { createdAt: { lt: query.before } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: clampLimit(query.limit),
    })) as AuditRecord[];
  }
}

/**
 * Best-effort audit write: observability must never break the request it
 * observes. Failures are swallowed (and logged by the caller's logger).
 */
export async function recordAudit(
  store: AuditStore | undefined,
  input: {
    actorId?: string | null;
    workspaceId?: string | null;
    action: string;
    target?: string | null;
  },
  log?: (error: unknown) => void,
): Promise<void> {
  if (!store) return;
  try {
    await store.recordEvent(input);
  } catch (error) {
    log?.(error);
  }
}
