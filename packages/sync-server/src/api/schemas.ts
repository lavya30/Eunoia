import { z } from "zod";

const MAX_TEXT_LENGTH = 120;
const MAX_PASSWORD_LENGTH = 256;
const MAX_ROOM_ID_LENGTH = 256;
const MAX_IMAGE_KEY_LENGTH = 512;

export const TierSchema = z.enum(["COMMUNITY", "PRO", "ENTERPRISE"]);

export const GenerateDiagramSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4000),
    roomId: z.string().trim().min(1).max(MAX_ROOM_ID_LENGTH).optional(),
    model: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export const WorkspaceRoleSchema = z.enum(["ADMIN", "EDITOR", "VIEWER"]);

export const CreateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
    tier: TierSchema.optional(),
  })
  .strict();

export const CreateFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  })
  .strict();

export const InviteMemberSchema = z
  .object({
    // Exactly one of userId / email identifies the invitee.
    userId: z.string().trim().min(1).max(MAX_ROOM_ID_LENGTH).optional(),
    email: z.string().trim().toLowerCase().email().max(MAX_ROOM_ID_LENGTH).optional(),
    role: WorkspaceRoleSchema.default("EDITOR"),
  })
  .strict()
  .refine((value) => value.userId !== undefined || value.email !== undefined, {
    message: "Either userId or email must be provided",
  });

export const UpdateMemberSchema = z
  .object({
    role: WorkspaceRoleSchema,
  })
  .strict();

export const MoveRoomSchema = z
  .object({
    workspaceId: z.string().trim().min(1).max(MAX_ROOM_ID_LENGTH).nullable(),
    folderId: z.string().trim().min(1).max(MAX_ROOM_ID_LENGTH).nullable().optional(),
  })
  .strict();

export const RoomListQuerySchema = z
  .object({
    workspaceId: z.string().trim().min(1).max(MAX_ROOM_ID_LENGTH).optional(),
  })
  .strict();
export const LayoutEngineSchema = z.enum(["dagre", "elk", "tala"]);
export const ImageKindSchema = z.enum(["image", "thumbnail"]);
export const ImageContentTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export const CreateRoomSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_TEXT_LENGTH).optional(),
    ownerId: z.string().trim().min(1).max(MAX_ROOM_ID_LENGTH).optional(),
    password: z.string().min(8).max(MAX_PASSWORD_LENGTH).optional(),
    tier: TierSchema.optional(),
    workspaceId: z.string().trim().min(1).max(MAX_ROOM_ID_LENGTH).optional(),
  })
  .strict();

export const UnlockRoomSchema = z
  .object({
    password: z.string().max(MAX_PASSWORD_LENGTH).optional(),
  })
  .strict();

export const RegisterUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(MAX_ROOM_ID_LENGTH),
    password: z.string().min(8).max(MAX_PASSWORD_LENGTH),
    name: z.string().trim().min(1).max(MAX_TEXT_LENGTH).optional(),
  })
  .strict();

export const CheckoutSchema = z
  .object({
    priceKey: z.string().trim().min(1).default("pro"),
      // Capped: per-seat billing with unbounded quantities is a one-line
      // API call away from absurd invoices; workspace invites enforce
      // against this count, so 100 is generous headroom.
      seats: z.coerce.number().int().positive().max(100).default(1),
  })
  .strict();

export const LoginUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(MAX_ROOM_ID_LENGTH),
    password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  })
  .strict();

export const UpdateRoomSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_TEXT_LENGTH).optional(),
    ownerId: z.string().trim().min(1).max(MAX_ROOM_ID_LENGTH).optional(),
    tier: TierSchema.optional(),
    // String replaces the password, null clears it, absent leaves it alone.
    password: z.string().min(8).max(MAX_PASSWORD_LENGTH).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export const CompileRequestSchema = z
  .object({
    source: z
      .string()
      .min(1)
      .max(900_000)
      .refine((value) => value.trim().length > 0, {
        message: "D2 source must not be empty",
      }),
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
    kind: ImageKindSchema.default("image"),
  })
  .strict();

export const ImageConfirmSchema = z
  .object({
    key: z.string().min(1).max(MAX_IMAGE_KEY_LENGTH),
    contentType: ImageContentTypeSchema.optional(),
    size: z.number().int().positive().max(50_000_000).optional(),
    kind: ImageKindSchema.default("image"),
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
    type: z.literal("cursor"),
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
    error: "Invalid request",
    code: "VALIDATION_ERROR",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    })),
  };
}
