'use client';

import type { BoardArrow, BoardNode, BoardStroke } from '../board-types';
import {
  confirmImageUpload,
  deleteImage,
  listImages,
  requestImageUpload,
  uploadImageBytes,
  type StoredImage,
} from '../rooms-api';
import { contentBounds } from './bounds';
import { embedRemoteImages } from './embed-images';
import { cloneBoardSvg, serializeSvg, svgStringToPngBlob } from './pipeline';

/** Preview width in px. Small enough for cards, sharp enough at 2x DPR. */
export const THUMB_WIDTH = 480;
/** Idle delay after the last mutation before a capture is attempted. */
export const THUMB_CAPTURE_DEBOUNCE_MS = 30_000;
/** Upper bound on source pixels before downscale (perf guard). */
export const THUMB_MAX_SOURCE_PX = 2048;

/**
 * Cheap content fingerprint: element counts + quantized bounds + edge ids.
 * Used to skip captures when nothing meaningful changed (e.g. pure pan).
 */
export function thumbnailContentHash(
  nodes: BoardNode[],
  arrows: BoardArrow[],
  strokes: BoardStroke[],
): string {
  const bounds = contentBounds(nodes, arrows, strokes);
  const quantize = (value: number) => Math.round(value / 8);
  const first = nodes[0]?.id ?? '-';
  const last = nodes[nodes.length - 1]?.id ?? '-';
  const lastArrow = arrows[arrows.length - 1]?.id ?? '-';
  const lastStroke = strokes[strokes.length - 1]?.id ?? '-';
  return [
    nodes.length,
    arrows.length,
    strokes.length,
    quantize(bounds.minX),
    quantize(bounds.minY),
    quantize(bounds.width),
    quantize(bounds.height),
    first,
    last,
    lastArrow,
    lastStroke,
  ].join(':');
}

export type ThumbnailCapture = {
  blob: Blob;
  width: number;
  height: number;
};

/**
 * Render a small PNG preview of the full board. Reuses the export pipeline
 * (content bounds + image embed pre-pass) so thumbnails match PNG exports
 * and never hit CORS taint or expired presigned links.
 */
export async function captureThumbnailBlob(
  svg: SVGSVGElement,
  nodes: BoardNode[],
  arrows: BoardArrow[],
  strokes: BoardStroke[],
  options: {
    roomId: string;
    ticket?: string;
    width?: number;
  },
): Promise<ThumbnailCapture> {
  if (nodes.length + arrows.length + strokes.length === 0) {
    throw new Error('Board is empty.');
  }
  const width = Math.max(160, Math.min(800, options.width ?? THUMB_WIDTH));
  const bounds = contentBounds(nodes, arrows, strokes);
  const clone = cloneBoardSvg(svg);
  clone.setAttribute(
    'viewBox',
    `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`,
  );
  clone.setAttribute('width', String(Math.round(bounds.width)));
  clone.setAttribute('height', String(Math.round(bounds.height)));
  await embedRemoteImages(clone, nodes, {
    roomId: options.roomId,
    ticket: options.ticket,
  });
  const svgString = serializeSvg(clone);
  // Fit the board into the thumbnail width; svgStringToPngBlob clamps to
  // 4096px, and the extra guard below keeps huge boards cheap to rasterize.
  const fitScale = Math.min(
    width / bounds.width,
    THUMB_MAX_SOURCE_PX / bounds.width,
    THUMB_MAX_SOURCE_PX / bounds.height,
  );
  const blob = await svgStringToPngBlob(
    svgString,
    bounds.width,
    bounds.height,
    Math.max(0.05, fitScale),
  );
  const bitmap =
    typeof createImageBitmap === 'function'
      ? await createImageBitmap(blob)
      : null;
  if (!bitmap) return { blob, width, height: width };
  try {
    const aspect = bitmap.height / Math.max(1, bitmap.width);
    const outW = width;
    const outH = Math.max(90, Math.round(width * aspect));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob, width: outW, height: outH };
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(bitmap, 0, 0, outW, outH);
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    return { blob: out ?? blob, width: outW, height: outH };
  } finally {
    bitmap.close();
  }
}

/**
 * Upload a thumbnail blob as kind='thumbnail'. Returns the stored record.
 * Best-effort by contract: callers must swallow failures silently.
 */
export async function uploadThumbnail(
  roomId: string,
  ticket: string | undefined,
  blob: Blob,
): Promise<StoredImage> {
  const grant = await requestImageUpload(roomId, ticket, {
    contentType: 'image/png',
    kind: 'thumbnail',
  });
  await uploadImageBytes(grant.uploadUrl, blob, 'image/png');
  return confirmImageUpload(roomId, ticket, {
    key: grant.key,
    contentType: 'image/png',
    size: blob.size,
    kind: 'thumbnail',
  });
}

/**
 * Keep a single live thumbnail per room: delete every confirmed thumbnail
 * except the newest one. Returns the number of pruned records.
 */
export async function pruneOldThumbnails(
  roomId: string,
  ticket: string | undefined,
  keepId: string,
): Promise<number> {
  const items = await listImages(roomId, ticket, 'thumbnail');
  let pruned = 0;
  for (const item of items) {
    if (item.id === keepId) continue;
    try {
      await deleteImage(roomId, item.id, ticket);
      pruned += 1;
    } catch {
      // Pruning is hygiene, not correctness — a leftover preview is
      // harmless and gets collected on the next capture.
    }
  }
  return pruned;
}

/** Newest-first thumbnail listing for preview surfaces. */
export async function listThumbnails(
  roomId: string,
  ticket: string | undefined,
): Promise<StoredImage[]> {
  return listImages(roomId, ticket, 'thumbnail');
}
