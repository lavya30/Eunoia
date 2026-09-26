'use client';

import type { BoardNode } from '../board-types';
import { fetchImageBytes, freshImageUrl } from '../rooms-api';
import { blobToDataUrl, fetchBlobWithTimeout } from './pipeline';

export type EmbedResult = {
  embedded: number;
  failed: number;
  /** Original href → data: URL for reuse (vector PDF image embedding). */
  imageData: Map<string, string>;
};

type ImageTarget = {
  element: SVGImageElement;
  node: BoardNode | undefined;
  href: string;
};

/**
 * Replace remote <image href> values in an SVG clone with data: URLs so
 * PNG/PDF/GIF rasterization never hits CORS taint or expired presigned
 * links. Order per image: same-origin bytes proxy (imageId) → fresh
 * presigned URL → direct href fetch. Failures paint a placeholder rect
 * instead of failing the whole export.
 */
export async function embedRemoteImages(
  clone: SVGSVGElement,
  nodes: BoardNode[],
  options: {
    roomId: string | null;
    ticket?: string;
    timeoutMs?: number;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<EmbedResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const images = Array.from(
    clone.querySelectorAll('image'),
  ) as unknown as SVGImageElement[];
  const byHref = new Map<string, BoardNode>();
  for (const node of nodes) {
    if (node.shape === 'image' && typeof node.href === 'string') {
      byHref.set(node.href, node);
    }
  }
  const targets: ImageTarget[] = [];
  for (const element of images) {
    const href =
      element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
    if (!href || href.startsWith('data:')) continue;
    targets.push({ element, node: byHref.get(href), href });
  }
  let embedded = 0;
  let failed = 0;
  let done = 0;
  const cache = new Map<string, string>();
  for (const target of targets) {
    try {
      const cached = cache.get(target.href);
      if (cached) {
        target.element.setAttribute('href', cached);
        embedded += 1;
      } else {
        const dataUrl = await fetchImageAsDataUrl(target, options, timeoutMs);
        cache.set(target.href, dataUrl);
        target.element.setAttribute('href', dataUrl);
        target.element.removeAttribute('crossorigin');
        embedded += 1;
      }
    } catch {
      failed += 1;
      markImagePlaceholder(target.element);
    } finally {
      done += 1;
      options.onProgress?.(done, targets.length);
    }
  }
  return { embedded, failed, imageData: cache };
}

async function fetchImageAsDataUrl(
  target: ImageTarget,
  options: { roomId: string | null; ticket?: string },
  timeoutMs: number,
): Promise<string> {
  // 1. Same-origin proxy — no CORS, no expiry. Needs room + imageId.
  if (options.roomId && target.node?.imageId) {
    try {
      const blob = await fetchImageBytes(
        options.roomId,
        target.node.imageId,
        options.ticket,
      );
      return await blobToDataUrl(blob);
    } catch {
      // Fall through to presigned/direct fetch.
    }
  }
  // 2. Refresh expiring presigned URLs once, then fetch direct.
  let href = target.href;
  if (options.roomId && target.node?.imageId) {
    try {
      const fresh = await freshImageUrl(
        options.roomId,
        target.node.imageId,
        options.ticket,
      );
      if (fresh.url) href = fresh.url;
    } catch {
      // Keep the stale href as a last resort.
    }
  }
  // 3. Direct fetch (works for public R2 base URLs with CORS enabled).
  const blob = await fetchBlobWithTimeout(href, { mode: 'cors' }, timeoutMs);
  return blobToDataUrl(blob);
}

function markImagePlaceholder(element: SVGImageElement): void {
  // Keep layout stable: drop the broken href and let the existing
  // .node-image-frame rect show the slot; flag for raster debugging.
  element.setAttribute('data-export-missing', 'true');
  element.removeAttribute('href');
}
