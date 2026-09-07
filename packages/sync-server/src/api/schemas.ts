import { z } from 'zod';

const MAX_TEXT_LENGTH = 120;
const MAX_PASSWORD_LENGTH = 256;
const MAX_ROOM_ID_LENGTH = 256;
const MAX_IMAGE_KEY_LENGTH = 512;

export const TierSchema = z.enum(['COMMUNITY', 'PRO', 'ENTERPRISE']);
export const LayoutEngineSchema = z.enum(['dagre', 'elk', 'tala']);
export const ImageKindSchema = z.enum(['image', 'thumbnail']);
export const ImageContentTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export const CreateRoomSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_TEXT_LENGTH).optional(),
    ownerId: z.string().trim().min(1).max(MAX_ROOM_ID_LENGTH).optional(),
    password: z.string().min(8).max(MAX_PASSWORD_LENGTH).optional(),
    tier: TierSchema.optional(),
  })
  .strict();

export const UnlockRoomSchema = z
  .object({
    password: z.string().max(MAX_PASSWORD_LENGTH).optional(),
  })
  .strict();

export const CompileRequestSchema = z
  .object({
    source: z.string().min(1).max(900_000),
    engine: LayoutEngineSchema.optional(),
    roomId: z.string().trim().min(1).max(MAX_ROOM_ID_LENGTH).optional(),
    // Accepted for backwards compatibility, but deliberately ignored by the
    // route. The room's stored tier is authoritative.
    tier: TierSchema.optional(),
  })
  .strict();

export const ImageRequestUploadSchema = z
  .object({
    contentType: ImageContentTypeSchema,
    kind: ImageKindSchema.default('image'),
  })
  .strict();

export const ImageConfirmSchema = z
  .object({
    key: z.string().min(1).max(MAX_IMAGE_KEY_LENGTH),
    contentType: ImageContentTypeSchema.optional(),
    size: z.number().int().positive().max(50_000_000).optional(),
    kind: ImageKindSchema.default('image'),
  })
  .strict();

export const ImageListQuerySchema = z
  .object({
    kind: ImageKindSchema.optional(),
  })
  .strict();

export const SnapshotQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    before: z.coerce.date().optional(),
  })
  .strict();

export const CursorTelemetrySchema = z
  .object({
    type: z.literal('cursor'),
    // Clients may include this legacy field, but the server always replaces it.
    clientId: z.string().trim().max(MAX_ROOM_ID_LENGTH).optional(),
    x: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
    y: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
    user: z
      .object({
        name: z.string().trim().max(MAX_TEXT_LENGTH).optional(),
        color: z.string().trim().max(64).optional(),
      })
      .strict()
      .optional(),
    tool: z.string().trim().max(64).optional(),
    timestamp: z.number().finite().optional(),
  })
  .strict();

export function validationError(error: z.ZodError) {
  return {
    error: 'Invalid request',
    code: 'VALIDATION_ERROR',
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    })),
  };
}
