import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";

/** Content types accepted for room image uploads. */
export const IMAGE_CONTENT_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

export type ImageContentType = keyof typeof IMAGE_CONTENT_TYPES;
export type ImageKind = "image" | "thumbnail";
export const IMAGE_KINDS: ImageKind[] = ["image", "thumbnail"];

export type StoredImage = {
  id: string;
  roomId: string;
  key: string;
  url: string;
  contentType: string;
  size: number | null;
  kind: string;
  createdAt: Date;
  updatedAt: Date;
};

export type NewImage = {
  roomId: string;
  key: string;
  url: string;
  contentType: string;
  size: number | null;
  kind: ImageKind;
};

export interface ImageStore {
  createImage(image: NewImage): Promise<StoredImage>;
  listImages(roomId: string, kind?: ImageKind): Promise<StoredImage[]>;
  getImage(id: string): Promise<StoredImage | null>;
  findByKey(key: string): Promise<StoredImage | null>;
  deleteImage(id: string): Promise<void>;
}

/** Wiring for the image endpoints: metadata store plus object storage. */
export type ImageDeps = {
  imageStore: ImageStore;
  /** Null when R2 is unconfigured — image routes then return 503. */
  r2: R2Client | null;
};

export class MemoryImageStore implements ImageStore {
  readonly images = new Map<string, StoredImage>();

  async createImage(image: NewImage): Promise<StoredImage> {
    const now = new Date();
    const stored: StoredImage = {
      ...image,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.images.set(stored.id, stored);
    return stored;
  }

  async listImages(roomId: string, kind?: ImageKind): Promise<StoredImage[]> {
    return [...this.images.values()]
      .filter(
        (image) => image.roomId === roomId && (!kind || image.kind === kind),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getImage(id: string): Promise<StoredImage | null> {
    return this.images.get(id) ?? null;
  }

  async findByKey(key: string): Promise<StoredImage | null> {
    for (const image of this.images.values())
      if (image.key === key) return image;
    return null;
  }

  async deleteImage(id: string): Promise<void> {
    this.images.delete(id);
  }
}

export class PrismaImageStore implements ImageStore {
  constructor(private readonly prisma: PrismaClient) {}

  async createImage(image: NewImage): Promise<StoredImage> {
    return this.prisma.imageAsset.create({ data: image });
  }

  async listImages(roomId: string, kind?: ImageKind): Promise<StoredImage[]> {
    return this.prisma.imageAsset.findMany({
      where: { roomId, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  async getImage(id: string): Promise<StoredImage | null> {
    return this.prisma.imageAsset.findUnique({ where: { id } });
  }

  async findByKey(key: string): Promise<StoredImage | null> {
    return this.prisma.imageAsset.findUnique({ where: { key } });
  }

  async deleteImage(id: string): Promise<void> {
    await this.prisma.imageAsset.delete({ where: { id } });
  }
}

export type ObjectHead = {
  contentType?: string;
  size?: number;
};

/**
 * Object-storage client. Bytes live in R2; Postgres keeps metadata only.
 * `head()` returns null when the object does not exist.
 */
export type ObjectBody = {
  body: Uint8Array;
  contentType?: string;
  size?: number;
};

export interface R2Client {
  presignUpload(
    key: string,
    contentType: string,
    expiresInSec: number,
  ): Promise<{ url: string; expiresIn: number }>;
  presignDownload(
    key: string,
    expiresInSec: number,
  ): Promise<{ url: string; expiresIn: number }>;
  publicUrl(key: string): string | undefined;
  head(key: string): Promise<ObjectHead | null>;
  /**
   * Fetch object bytes for the same-origin export proxy. Returns null when
   * the object does not exist; other failures throw and surface as 502s.
   */
  getObject(key: string): Promise<ObjectBody | null>;
  delete(key: string): Promise<void>;
}

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl?: string;
};

/** Undefined when R2 is not configured — image endpoints then return 503. */
export function resolveR2Config(config: Config): R2Config | undefined {
  if (
    !config.r2AccountId ||
    !config.r2AccessKeyId ||
    !config.r2SecretAccessKey ||
    !config.r2Bucket
  )
    return undefined;
  return {
    accountId: config.r2AccountId,
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
    bucket: config.r2Bucket,
    publicBaseUrl: config.r2PublicBaseUrl,
  };
}

export class S3R2Client implements R2Client {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl?: string;

  constructor(config: R2Config) {
    this.bucket = config.bucket;
    this.publicBaseUrl = config.publicBaseUrl?.replace(/\/+$/, "");
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async presignUpload(key: string, contentType: string, expiresInSec: number) {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: expiresInSec },
    );
    return { url, expiresIn: expiresInSec };
  }

  async presignDownload(key: string, expiresInSec: number) {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSec },
    );
    return { url, expiresIn: expiresInSec };
  }

  publicUrl(key: string): string | undefined {
    return this.publicBaseUrl ? `${this.publicBaseUrl}/${key}` : undefined;
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { contentType: out.ContentType, size: out.ContentLength };
    } catch (error) {
      // Only absence maps to "not found" — credential, network, and outage
      // failures must surface as 502s, not phantom 404s that clients retry.
      if (isR2NotFound(error)) return null;
      throw error;
    }
  }

  async getObject(key: string): Promise<ObjectBody | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!out.Body) return null;
      const body = await out.Body.transformToByteArray();
      return {
        body: new Uint8Array(body),
        contentType: out.ContentType,
        size:
          typeof out.ContentLength === "number" ? out.ContentLength : undefined,
      };
    } catch (error) {
      if (isR2NotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

/** True for object-absence failures (as opposed to credential/network errors). */
export function isR2NotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    candidate.name === "NotFound" ||
    candidate.name === "NoSuchKey" ||
    candidate.Code === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

/** In-memory fake for tests and local dev without R2 credentials. */
export class MemoryR2Client implements R2Client {
  private readonly objects = new Map<
    string,
    { contentType: string; bytes?: Uint8Array }
  >();

  /** Seed bytes directly (tests/dev) — presigned uploads record empty bodies. */
  seedObject(key: string, contentType: string, bytes: Uint8Array): void {
    this.objects.set(key, { contentType, bytes });
  }

  async presignUpload(key: string, contentType: string, expiresInSec: number) {
    const existing = this.objects.get(key);
    this.objects.set(key, {
      contentType,
      bytes: existing?.bytes ?? MemoryR2Client.placeholderPng(),
    });
    return { url: `memory://upload/${key}`, expiresIn: expiresInSec };
  }

  async presignDownload(key: string, expiresInSec: number) {
    return { url: `memory://download/${key}`, expiresIn: expiresInSec };
  }

  publicUrl(): string | undefined {
    return undefined;
  }

  async head(key: string): Promise<ObjectHead | null> {
    const object = this.objects.get(key);
    // Deliberately no `size`: the fake never observes real PUT bytes, so
    // confirm must fall back to the client-reported size (the oversize and
    // lifecycle tests depend on this). Real byte serving lives in getObject.
    return object ? { contentType: object.contentType } : null;
  }

  async getObject(key: string): Promise<ObjectBody | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: object.bytes ?? MemoryR2Client.placeholderPng(),
      contentType: object.contentType,
      size: object.bytes?.byteLength,
    };
  }

  /** 1x1 transparent PNG so export-proxy tests have deterministic bytes. */
  private static placeholderPng(): Uint8Array {
    return new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
      0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84,
      120, 156, 99, 96, 0, 0, 0, 2, 0, 1, 226, 33, 188, 51, 0, 0, 0, 0, 73, 69,
      78, 68, 174, 66, 96, 130,
    ]);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export function isImageContentType(value: unknown): value is ImageContentType {
  return typeof value === "string" && value in IMAGE_CONTENT_TYPES;
}

export function isImageKind(value: unknown): value is ImageKind {
  return value === "image" || value === "thumbnail";
}

/** Server-generated keys are namespaced per room so ownership is checkable. */
export function buildImageKey(
  roomId: string,
  contentType: ImageContentType,
): string {
  const ext = IMAGE_CONTENT_TYPES[contentType];
  return `rooms/${roomId}/${randomUUID()}.${ext}`;
}

export function keyBelongsToRoom(key: string, roomId: string): boolean {
  return key.startsWith(`rooms/${roomId}/`);
}
