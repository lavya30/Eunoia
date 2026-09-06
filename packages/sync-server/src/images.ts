import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';

/** Content types accepted for room image uploads. */
export const IMAGE_CONTENT_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;

export type ImageContentType = keyof typeof IMAGE_CONTENT_TYPES;
export type ImageKind = 'image' | 'thumbnail';
export const IMAGE_KINDS: ImageKind[] = ['image', 'thumbnail'];

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
      orderBy: { createdAt: 'desc' },
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
    this.publicBaseUrl = config.publicBaseUrl?.replace(/\/+$/, '');
    this.client = new S3Client({
      region: 'auto',
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
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
      .catch(() => undefined);
  }
}

/** In-memory fake for tests and local dev without R2 credentials. */
export class MemoryR2Client implements R2Client {
  private readonly objects = new Map<string, { contentType: string }>();

  async presignUpload(key: string, contentType: string, expiresInSec: number) {
    this.objects.set(key, { contentType });
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
    return object ? { contentType: object.contentType } : null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export function isImageContentType(value: unknown): value is ImageContentType {
  return typeof value === 'string' && value in IMAGE_CONTENT_TYPES;
}

export function isImageKind(value: unknown): value is ImageKind {
  return value === 'image' || value === 'thumbnail';
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
