import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Tier } from "./d2-compiler.js";

export type PublicUser = {
  id: string;
  email: string;
  name: string | null;
  tier: Tier;
};

export type NewUser = {
  email: string;
  name?: string;
  passwordHash: string;
};

type UserRow = PublicUser & { passwordHash: string | null };

export interface UserStore {
  /** Returns null when the email is already taken. */
  createUser(input: NewUser): Promise<PublicUser | null>;
  findByEmail(email: string): Promise<PublicUser | null>;
  findById(id: string): Promise<PublicUser | null>;
  getPasswordHash(userId: string): Promise<string | null>;
  /** Update the user's subscription tier. Returns null if user not found. */
  updateTier(userId: string, tier: Tier): Promise<PublicUser | null>;
}

/** Email identity: lowercase, trimmed. All lookups normalize first. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class MemoryUserStore implements UserStore {
  private readonly byId = new Map<string, UserRow>();
  private readonly idByEmail = new Map<string, string>();

  async createUser(input: NewUser): Promise<PublicUser | null> {
    const email = normalizeEmail(input.email);
    if (this.idByEmail.has(email)) return null;
    const row: UserRow = {
      id: randomUUID(),
      email,
      name: input.name ?? null,
      tier: "COMMUNITY",
      passwordHash: input.passwordHash,
    };
    this.byId.set(row.id, row);
    this.idByEmail.set(email, row.id);
    return toPublicUser(row);
  }

  async findByEmail(email: string): Promise<PublicUser | null> {
    const id = this.idByEmail.get(normalizeEmail(email));
    const row = id ? this.byId.get(id) : undefined;
    return row ? toPublicUser(row) : null;
  }

  async findById(id: string): Promise<PublicUser | null> {
    const row = this.byId.get(id);
    return row ? toPublicUser(row) : null;
  }

  async getPasswordHash(userId: string): Promise<string | null> {
    return this.byId.get(userId)?.passwordHash ?? null;
  }

  async updateTier(userId: string, tier: Tier): Promise<PublicUser | null> {
    const row = this.byId.get(userId);
    if (!row) return null;
    row.tier = tier;
    return toPublicUser(row);
  }
}

export class PrismaUserStore implements UserStore {
  constructor(private readonly prisma: PrismaClient) {}

  async createUser(input: NewUser): Promise<PublicUser | null> {
    try {
      const row = await this.prisma.user.create({
        data: {
          email: normalizeEmail(input.email),
          name: input.name,
          passwordHash: input.passwordHash,
        },
      });
      return toPublicUser(row);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      )
        return null;
      throw error;
    }
  }

  async findByEmail(email: string): Promise<PublicUser | null> {
    const row = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
    return row ? toPublicUser(row) : null;
  }

  async findById(id: string): Promise<PublicUser | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? toPublicUser(row) : null;
  }

  async getPasswordHash(userId: string): Promise<string | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    return row?.passwordHash ?? null;
  }

  async updateTier(userId: string, tier: Tier): Promise<PublicUser | null> {
    try {
      const row = await this.prisma.user.update({
        where: { id: userId },
        data: { tier },
      });
      return toPublicUser(row);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "P2025"
      )
        return null;
      throw error;
    }
  }
}

function toPublicUser(row: {
  id: string;
  email: string;
  name: string | null;
  tier: Tier;
}): PublicUser {
  return { id: row.id, email: row.email, name: row.name, tier: row.tier };
}
