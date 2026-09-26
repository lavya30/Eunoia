import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Tier } from "./d2-compiler.js";

export type WorkspaceRole = "ADMIN" | "EDITOR" | "VIEWER";

export const WORKSPACE_ROLES: WorkspaceRole[] = ["ADMIN", "EDITOR", "VIEWER"];

const ROLE_RANK: Record<WorkspaceRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  ADMIN: 2,
};

/** True when `have` satisfies a `need`-or-higher gate. Owners count as ADMIN. */
export function roleAtLeast(
  have: WorkspaceRole | null,
  need: WorkspaceRole,
): boolean {
  if (!have) return false;
  return ROLE_RANK[have] >= ROLE_RANK[need];
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return (
    value === "ADMIN" || value === "EDITOR" || value === "VIEWER"
  );
}

export type WorkspaceRecord = {
  id: string;
  name: string;
  ownerId: string;
  tier: Tier;
  createdAt: Date;
  updatedAt: Date;
};

export type FolderRecord = {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: Date;
};

export type MembershipRecord = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: Date;
};

export type WorkspaceWithRole = {
  workspace: WorkspaceRecord;
  /** Effective role: ADMIN for the owner, else the membership role. */
  role: WorkspaceRole;
};

export interface WorkspaceStore {
  createWorkspace(input: {
    name: string;
    ownerId: string;
    tier?: Tier;
  }): Promise<WorkspaceRecord>;
  getWorkspace(id: string): Promise<WorkspaceRecord | null>;
  listWorkspacesForUser(userId: string): Promise<WorkspaceWithRole[]>;
  deleteWorkspace(id: string): Promise<void>;
  createFolder(workspaceId: string, name: string): Promise<FolderRecord>;
  listFolders(workspaceId: string): Promise<FolderRecord[]>;
  getFolder(id: string): Promise<FolderRecord | null>;
  upsertMembership(input: {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
  }): Promise<MembershipRecord>;
  removeMembership(workspaceId: string, userId: string): Promise<void>;
  getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<MembershipRecord | null>;
  listMembers(workspaceId: string): Promise<MembershipRecord[]>;
  countMembers(workspaceId: string): Promise<number>;
}

export class MemoryWorkspaceStore implements WorkspaceStore {
  private readonly workspaces = new Map<string, WorkspaceRecord>();
  private readonly folders = new Map<string, FolderRecord>();
  private readonly memberships = new Map<string, MembershipRecord>();

  private static membershipKey(workspaceId: string, userId: string): string {
    return `${workspaceId}:${userId}`;
  }

  async createWorkspace(input: {
    name: string;
    ownerId: string;
    tier?: Tier;
  }): Promise<WorkspaceRecord> {
    const now = new Date();
    const workspace: WorkspaceRecord = {
      id: randomUUID(),
      name: input.name,
      ownerId: input.ownerId,
      tier: input.tier ?? "COMMUNITY",
      createdAt: now,
      updatedAt: now,
    };
    this.workspaces.set(workspace.id, workspace);
    return workspace;
  }

  async getWorkspace(id: string): Promise<WorkspaceRecord | null> {
    return this.workspaces.get(id) ?? null;
  }

  async listWorkspacesForUser(userId: string): Promise<WorkspaceWithRole[]> {
    const result: WorkspaceWithRole[] = [];
    for (const workspace of this.workspaces.values()) {
      if (workspace.ownerId === userId) {
        result.push({ workspace, role: "ADMIN" });
        continue;
      }
      const membership = this.memberships.get(
        MemoryWorkspaceStore.membershipKey(workspace.id, userId),
      );
      if (membership) result.push({ workspace, role: membership.role });
    }
    return result.sort(
      (a, b) => b.workspace.createdAt.getTime() - a.workspace.createdAt.getTime(),
    );
  }

  async deleteWorkspace(id: string): Promise<void> {
    this.workspaces.delete(id);
    for (const [folderId, folder] of this.folders) {
      if (folder.workspaceId === id) this.folders.delete(folderId);
    }
    for (const [key, membership] of this.memberships) {
      if (membership.workspaceId === id) this.memberships.delete(key);
    }
  }

  async createFolder(
    workspaceId: string,
    name: string,
  ): Promise<FolderRecord> {
    const folder: FolderRecord = {
      id: randomUUID(),
      workspaceId,
      name,
      createdAt: new Date(),
    };
    this.folders.set(folder.id, folder);
    return folder;
  }

  async listFolders(workspaceId: string): Promise<FolderRecord[]> {
    return [...this.folders.values()]
      .filter((folder) => folder.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getFolder(id: string): Promise<FolderRecord | null> {
    return this.folders.get(id) ?? null;
  }

  async upsertMembership(input: {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
  }): Promise<MembershipRecord> {
    const existing = this.memberships.get(
      MemoryWorkspaceStore.membershipKey(input.workspaceId, input.userId),
    );
    if (existing) {
      const next = { ...existing, role: input.role };
      this.memberships.set(
        MemoryWorkspaceStore.membershipKey(input.workspaceId, input.userId),
        next,
      );
      return next;
    }
    const record: MembershipRecord = {
      ...input,
      createdAt: new Date(),
    };
    this.memberships.set(
      MemoryWorkspaceStore.membershipKey(input.workspaceId, input.userId),
      record,
    );
    return record;
  }

  async removeMembership(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    this.memberships.delete(
      MemoryWorkspaceStore.membershipKey(workspaceId, userId),
    );
  }

  async getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<MembershipRecord | null> {
    return (
      this.memberships.get(
        MemoryWorkspaceStore.membershipKey(workspaceId, userId),
      ) ?? null
    );
  }

  async listMembers(workspaceId: string): Promise<MembershipRecord[]> {
    return [...this.memberships.values()]
      .filter((membership) => membership.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async countMembers(workspaceId: string): Promise<number> {
    let count = 0;
    for (const membership of this.memberships.values()) {
      if (membership.workspaceId === workspaceId) count += 1;
    }
    return count;
  }
}

export class PrismaWorkspaceStore implements WorkspaceStore {
  constructor(private readonly prisma: PrismaClient) {}

  async createWorkspace(input: {
    name: string;
    ownerId: string;
    tier?: Tier;
  }): Promise<WorkspaceRecord> {
    return this.prisma.workspace.create({
      data: {
        name: input.name,
        ownerId: input.ownerId,
        tier: input.tier ?? "COMMUNITY",
      },
    }) as Promise<WorkspaceRecord>;
  }

  async getWorkspace(id: string): Promise<WorkspaceRecord | null> {
    const row = await this.prisma.workspace.findUnique({ where: { id } });
    return row as unknown as WorkspaceRecord | null;
  }

  async listWorkspacesForUser(userId: string): Promise<WorkspaceWithRole[]> {
    const rows = await this.prisma.workspace.findMany({
      where: {
        OR: [{ ownerId: userId }, { memberships: { some: { userId } } }],
      },
      include: { memberships: { where: { userId } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      workspace: row as unknown as WorkspaceRecord,
      role:
        row.ownerId === userId
          ? ("ADMIN" as const)
          : ((row.memberships[0]?.role ?? "VIEWER") as WorkspaceRole),
    }));
  }

  async deleteWorkspace(id: string): Promise<void> {
    await this.prisma.workspace.delete({ where: { id } });
  }

  async createFolder(
    workspaceId: string,
    name: string,
  ): Promise<FolderRecord> {
    return (await this.prisma.folder.create({
      data: { workspaceId, name },
    })) as unknown as FolderRecord;
  }

  async listFolders(workspaceId: string): Promise<FolderRecord[]> {
    return (await this.prisma.folder.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    })) as unknown as FolderRecord[];
  }

  async getFolder(id: string): Promise<FolderRecord | null> {
    return (await this.prisma.folder.findUnique({
      where: { id },
    })) as unknown as FolderRecord | null;
  }

  async upsertMembership(input: {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
  }): Promise<MembershipRecord> {
    return (await this.prisma.membership.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: input.workspaceId,
          userId: input.userId,
        },
      },
      update: { role: input.role },
      create: input,
    })) as unknown as MembershipRecord;
  }

  async removeMembership(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    await this.prisma.membership
      .delete({ where: { workspaceId_userId: { workspaceId, userId } } })
      .catch(() => undefined);
  }

  async getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<MembershipRecord | null> {
    return (await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    })) as unknown as MembershipRecord | null;
  }

  async listMembers(workspaceId: string): Promise<MembershipRecord[]> {
    return (await this.prisma.membership.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    })) as unknown as MembershipRecord[];
  }

  async countMembers(workspaceId: string): Promise<number> {
    return this.prisma.membership.count({ where: { workspaceId } });
  }
}
