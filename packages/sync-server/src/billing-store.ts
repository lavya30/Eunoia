import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/* ── Subscription ────────────────────────────────────────────── */

export type SubscriptionRecord = {
  id: string;
  userId: string;
  provider: string;
  customerId: string | null;
  providerSubId: string | null;
  status: string;
  priceKey: string;
  seats: number;
  periodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertSubscription = {
  userId: string;
  provider: string;
  customerId?: string | null;
  providerSubId?: string | null;
  status: string;
  priceKey: string;
  seats: number;
  periodEnd?: Date | null;
};

export interface SubscriptionStore {
  upsertByUserId(input: UpsertSubscription): Promise<SubscriptionRecord>;
  findByUserId(userId: string): Promise<SubscriptionRecord | null>;
  findByCustomerId(customerId: string): Promise<SubscriptionRecord | null>;
}

/* ── Billing Events (webhook idempotency) ────────────────────── */

export interface BillingEventStore {
  /** Returns false if eventId already exists (duplicate). */
  recordEvent(eventId: string, type: string): Promise<boolean>;
}

/* ── Memory implementations ──────────────────────────────────── */

export class MemorySubscriptionStore implements SubscriptionStore {
  private readonly byUserId = new Map<string, SubscriptionRecord>();
  private readonly byCustomerId = new Map<string, string>();

  async upsertByUserId(
    input: UpsertSubscription,
  ): Promise<SubscriptionRecord> {
    const now = new Date();
    const existing = this.byUserId.get(input.userId);
    const record: SubscriptionRecord = {
      id: existing?.id ?? randomUUID(),
      userId: input.userId,
      provider: input.provider,
      customerId: input.customerId ?? existing?.customerId ?? null,
      providerSubId: input.providerSubId ?? existing?.providerSubId ?? null,
      status: input.status,
      priceKey: input.priceKey,
      seats: input.seats,
      periodEnd: input.periodEnd ?? existing?.periodEnd ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.byUserId.set(input.userId, record);
    if (record.customerId)
      this.byCustomerId.set(record.customerId, input.userId);
    return record;
  }

  async findByUserId(userId: string): Promise<SubscriptionRecord | null> {
    return this.byUserId.get(userId) ?? null;
  }

  async findByCustomerId(
    customerId: string,
  ): Promise<SubscriptionRecord | null> {
    const userId = this.byCustomerId.get(customerId);
    return userId ? (this.byUserId.get(userId) ?? null) : null;
  }
}

export class MemoryBillingEventStore implements BillingEventStore {
  private readonly seen = new Set<string>();

  async recordEvent(eventId: string, _type: string): Promise<boolean> {
    if (this.seen.has(eventId)) return false;
    this.seen.add(eventId);
    return true;
  }
}

/* ── Prisma implementations ──────────────────────────────────── */

export class PrismaSubscriptionStore implements SubscriptionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertByUserId(
    input: UpsertSubscription,
  ): Promise<SubscriptionRecord> {
    const row = await this.prisma.subscription.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        provider: input.provider,
        customerId: input.customerId,
        providerSubId: input.providerSubId,
        status: input.status,
        priceKey: input.priceKey,
        seats: input.seats,
        periodEnd: input.periodEnd,
      },
      update: {
        provider: input.provider,
        ...(input.customerId !== undefined
          ? { customerId: input.customerId }
          : {}),
        ...(input.providerSubId !== undefined
          ? { providerSubId: input.providerSubId }
          : {}),
        status: input.status,
        priceKey: input.priceKey,
        seats: input.seats,
        ...(input.periodEnd !== undefined
          ? { periodEnd: input.periodEnd }
          : {}),
      },
    });
    return toSubscriptionRecord(row);
  }

  async findByUserId(userId: string): Promise<SubscriptionRecord | null> {
    const row = await this.prisma.subscription.findUnique({
      where: { userId },
    });
    return row ? toSubscriptionRecord(row) : null;
  }

  async findByCustomerId(
    customerId: string,
  ): Promise<SubscriptionRecord | null> {
    const row = await this.prisma.subscription.findFirst({
      where: { customerId },
    });
    return row ? toSubscriptionRecord(row) : null;
  }
}

export class PrismaBillingEventStore implements BillingEventStore {
  constructor(private readonly prisma: PrismaClient) {}

  async recordEvent(eventId: string, type: string): Promise<boolean> {
    try {
      await this.prisma.billingEvent.create({
        data: { eventId, type },
      });
      return true;
    } catch (error) {
      // Unique constraint violation → duplicate event.
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      )
        return false;
      throw error;
    }
  }
}

/* ── Helpers ─────────────────────────────────────────────────── */

type SubscriptionRow = {
  id: string;
  userId: string;
  provider: string;
  customerId: string | null;
  providerSubId: string | null;
  status: string;
  priceKey: string;
  seats: number;
  periodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toSubscriptionRecord(row: SubscriptionRow): SubscriptionRecord {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    customerId: row.customerId,
    providerSubId: row.providerSubId,
    status: row.status,
    priceKey: row.priceKey,
    seats: row.seats,
    periodEnd: row.periodEnd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export {
  MemorySubscriptionStore as MemoryBillingStore,
  PrismaSubscriptionStore as PrismaBillingStore,
};

