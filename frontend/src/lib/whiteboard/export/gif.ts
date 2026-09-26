'use client';

import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { BoardArrow, BoardNode, BoardStroke } from '../board-types';
import type { ContentBounds } from './bounds';
import { embedRemoteImages } from './embed-images';
import { cloneBoardSvg, serializeSvg, svgStringToImage } from './pipeline';

export type HistoryGifInput = {
  svg: SVGSVGElement;
  nodes: BoardNode[];
  arrows: BoardArrow[];
  strokes: BoardStroke[];
  bounds: ContentBounds;
  roomId: string | null;
  ticket?: string;
  /** 2–24 frames; defaults to element-count scaled. */
  frames?: number;
  width?: number;
  delayMs?: number;
  onProgress?: (done: number, total: number) => void;
};

function hideBeyond(
  root: SVGSVGElement,
  selector: string,
  reveal: number,
): void {
  const elements = Array.from(root.querySelectorAll(selector));
  elements.forEach((el, index) => {
    if (index >= reveal) (el as SVGElement).style.display = 'none';
  });
}

/**
 * History-replay GIF: build-up animation revealing nodes/arrows/strokes
 * proportionally per frame (creation-order replay without server
 * snapshots). Flat vector boards quantize cleanly with gifenc.
 */
export async function buildHistoryGif(input: HistoryGifInput): Promise<Blob> {
  const totalElements =
    input.nodes.length + input.arrows.length + input.strokes.length;
  if (totalElements === 0) {
    throw new Error('Add shapes to the board before exporting a GIF.');
  }
  const frames = Math.max(
    2,
    Math.min(24, input.frames ?? Math.min(16, Math.max(4, totalElements))),
  );
  const width = Math.max(240, Math.min(800, input.width ?? 600));
  const aspect = input.bounds.height / Math.max(1, input.bounds.width);
  const height = Math.max(135, Math.round(width * aspect));
  const delayMs = input.delayMs ?? 420;

  // Base: export-ready SVG with embedded data: images + content viewBox.
  const base = cloneBoardSvg(input.svg);
  base.setAttribute(
    'viewBox',
    `${input.bounds.minX} ${input.bounds.minY} ${input.bounds.width} ${input.bounds.height}`,
  );
  base.setAttribute('width', String(input.bounds.width));
  base.setAttribute('height', String(input.bounds.height));
  await embedRemoteImages(base, input.nodes, {
    roomId: input.roomId,
    ticket: input.ticket,
  });
  const baseString = serializeSvg(base);

  const gif = GIFEncoder();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');

  for (let frame = 0; frame < frames; frame += 1) {
    const progress = (frame + 1) / (frames + 1);
    const nodesReveal = Math.ceil(input.nodes.length * progress);
    const arrowsReveal = Math.ceil(input.arrows.length * progress);
    const strokesReveal = Math.ceil(input.strokes.length * progress);

    const doc = new DOMParser().parseFromString(baseString, 'image/svg+xml');
    const frameSvg = doc.documentElement as unknown as SVGSVGElement;
    hideBeyond(frameSvg, '.canvas-node', nodesReveal);
    hideBeyond(frameSvg, '.arrow-group', arrowsReveal);
    hideBeyond(frameSvg, '.stroke-group', strokesReveal);
    const frameString = new XMLSerializer().serializeToString(frameSvg);

    const img = await svgStringToImage(frameString);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    // Contain-fit the content viewBox into the GIF canvas.
    const fit = Math.min(
      width / input.bounds.width,
      height / input.bounds.height,
    );
    const drawW = input.bounds.width * fit;
    const drawH = input.bounds.height * fit;
    ctx.drawImage(img, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const palette = quantize(rgba, 256, { format: 'rgb565' });
    const index = applyPalette(rgba, palette, 'rgb565');
    gif.writeFrame(index, width, height, {
      palette,
      delay: delayMs,
      repeat: 0,
    });
    input.onProgress?.(frame + 1, frames + 1);
  }

  gif.finish();
  input.onProgress?.(frames + 1, frames + 1);
  const bytes = gif.bytes();
  return new Blob([bytes as unknown as BlobPart], { type: 'image/gif' });
}
