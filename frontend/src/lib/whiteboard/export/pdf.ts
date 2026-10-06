'use client';

import { PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib';
import type { BoardArrow, BoardNode, BoardStroke } from '../board-types';
import type { ContentBounds } from './bounds';

const TONE_FILL: Record<string, string> = {
  violet: '#ede9ff',
  orange: '#ffe0ca',
  blue: '#dceefa',
  yellow: '#fff0b9',
  mint: '#dff4e8',
  note: '#fff0b8',
};

const TONE_STROKE: Record<string, string> = {
  violet: '#756bce',
  orange: '#ec8b57',
  blue: '#5a94c7',
  yellow: '#d2ab40',
  mint: '#72ae8b',
  note: '#e2bd53',
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.trim().replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.slice(0, 6);
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value) || full.length !== 6) {
    return { r: 0.15, g: 0.15, b: 0.23 };
  }
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
  };
}

function pdfColor(hex: string | undefined, fallback: string) {
  const { r, g, b } = hexToRgb(hex ?? fallback);
  return rgb(r, g, b);
}

function dataUrlBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export type VectorPdfInput = {
  nodes: BoardNode[];
  arrows: BoardArrow[];
  strokes: BoardStroke[];
  bounds: ContentBounds;
  title: string;
  /** href → data: URL for image nodes (built by the embed pre-pass). */
  imageData?: Map<string, string>;
  onProgress?: (done: number, total: number) => void;
};

/**
 * True vector PDF: shapes map to PDF draw ops (selectable text, scalable
 * geometry) instead of a wrapped PNG. One page sized to the board content
 * plus margin; world units map 1:1 to PDF points.
 */
export async function buildVectorPdf(
  input: VectorPdfInput,
): Promise<Uint8Array> {
  const { nodes, arrows, strokes, bounds, title } = input;
  const margin = 36;
  const maxPage = 14400; // pdf-lib ~200in limit
  const rawW = bounds.width + margin * 2;
  const rawH = bounds.height + margin * 2;
  const fit = Math.min(1, maxPage / rawW, maxPage / rawH);
  const pageW = Math.max(72, rawW * fit);
  const pageH = Math.max(72, rawH * fit);
  // World → page: translate by bounds origin + margin, flip Y (PDF origin
  // is bottom-left, board origin is top-left).
  const tx = (x: number) => (x - bounds.minX + margin) * fit;
  const ty = (y: number) => pageH - (y - bounds.minY + margin) * fit;
  const dim = (v: number) => v * fit;

  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer('Eunoia Export Pro');
  const page = doc.addPage([pageW, pageH]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const total = nodes.length + arrows.length + strokes.length;
  let done = 0;
  const tick = () => {
    done += 1;
    input.onProgress?.(done, total);
  };

  for (const node of nodes) {
    const fill = node.fill ?? TONE_FILL[node.tone] ?? '#ffffff';
    const stroke = node.stroke ?? TONE_STROKE[node.tone] ?? '#25263a';
    const opacity = node.opacity ?? 1;
    const rotation = node.rotation ? { angle: node.rotation } : undefined;
    const x = tx(node.x);
    const topY = ty(node.y);
    const w = dim(Math.max(1, node.width));
    const h = dim(Math.max(1, node.height));
    const y = topY - h; // pdf-lib rect origin is bottom-left

    if (node.shape === 'image') {
      const dataUrl =
        (node.href ? input.imageData?.get(node.href) : undefined) ??
        (node.href?.startsWith('data:') ? node.href : undefined);
      const bytes = dataUrl ? dataUrlBytes(dataUrl) : null;
      if (bytes) {
        try {
          const embedded = dataUrl!.startsWith('data:image/png')
            ? await doc.embedPng(bytes)
            : await doc.embedJpg(bytes).catch(() => null);
          const drawable =
            embedded ?? (await doc.embedPng(bytes).catch(() => null));
          if (drawable) {
            page.drawImage(drawable, { x, y, width: w, height: h, opacity });
          } else {
            drawPlaceholder();
          }
        } catch {
          drawPlaceholder();
        }
      } else {
        drawPlaceholder();
      }
      function drawPlaceholder() {
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          borderColor: pdfColor(stroke, '#72ae8b'),
          borderWidth: 1.5,
          color: pdfColor('#dff4e8', '#dff4e8'),
          opacity,
          ...rotation,
        });
      }
    } else if (node.shape === 'ellipse') {
      page.drawEllipse({
        x: x + w / 2,
        y: y + h / 2,
        xScale: w / 2,
        yScale: h / 2,
        borderColor: pdfColor(stroke, '#25263a'),
        borderWidth: dim(node.strokeWidth ?? 2),
        color: pdfColor(fill, '#ffffff'),
        opacity,
      });
    } else {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        borderColor: pdfColor(stroke, '#25263a'),
        borderWidth: dim(node.strokeWidth ?? 2),
        color: pdfColor(fill, '#ffffff'),
        opacity,
        ...rotation,
      });
    }

    if (node.shape !== 'image') {
      drawWrappedText(
        page,
        node.label,
        x + dim(10),
        topY - dim(node.shape === 'text' ? 4 : 24),
        w - dim(20),
        node.shape === 'text' ? (node.fontSize ?? 16) * fit : 11 * fit,
        bold,
        pdfColor('#25263a', '#25263a'),
      );
      if (node.detail && node.shape !== 'text') {
        drawWrappedText(
          page,
          node.detail,
          x + dim(10),
          topY - dim(40),
          w - dim(20),
          7 * fit,
          regular,
          pdfColor('#777a8e', '#777a8e'),
        );
      }
    }
    tick();
  }

  for (const arrow of arrows) {
    const color = pdfColor(arrow.color, '#25263a');
    page.drawLine({
      start: { x: tx(arrow.start.x), y: ty(arrow.start.y) },
      end: { x: tx(arrow.end.x), y: ty(arrow.end.y) },
      thickness: dim(2),
      color,
      opacity: 1,
    });
    // Arrowhead: small filled triangle at the end angle.
    const angle = Math.atan2(
      ty(arrow.end.y) - ty(arrow.start.y),
      tx(arrow.end.x) - tx(arrow.start.x),
    );
    const size = dim(9);
    const tip = { x: tx(arrow.end.x), y: ty(arrow.end.y) };
    const left = {
      x: tip.x - size * Math.cos(angle - 0.42),
      y: tip.y - size * Math.sin(angle - 0.42),
    };
    const right = {
      x: tip.x - size * Math.cos(angle + 0.42),
      y: tip.y - size * Math.sin(angle + 0.42),
    };
    page.drawSvgPath(
      `M ${tip.x} ${tip.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z`,
      { color, borderColor: color, borderWidth: 0.5 },
    );
    tick();
  }

  for (const stroke of strokes) {
    const color = pdfColor(stroke.color, '#25263a');
    const points = stroke.points;
    for (let i = 1; i < points.length; i += 1) {
      page.drawLine({
        start: { x: tx(points[i - 1].x), y: ty(points[i - 1].y) },
        end: { x: tx(points[i].x), y: ty(points[i].y) },
        thickness: dim(stroke.brushSize ?? 6) * 0.6,
        color,
        opacity: stroke.opacity ?? 1,
      });
    }
    tick();
  }

  return doc.save();
}

export type PresentationPdfInput = {
  frames: BoardNode[];
  nodes?: BoardNode[];
  allNodes?: BoardNode[];
  arrows?: BoardArrow[];
  strokes?: BoardStroke[];
  title: string;
  imageData?: Map<string, string>;
  onProgress?: (done: number, total: number) => void;
};

/**
 * Multi-page presentation PDF: each frame becomes a dedicated slide page
 * containing its bounded elements and slide title.
 */
export async function buildPresentationPdf(
  input: PresentationPdfInput,
): Promise<Uint8Array> {
  const { frames, title, onProgress } = input;
  const allNodes = input.nodes ?? input.allNodes ?? [];
  const doc = await PDFDocument.create();
  doc.setTitle(`${title} - Presentation`);
  doc.setCreator('Eunoia Whiteboard');

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const total = frames.length;
  let done = 0;
  const tick = () => {
    done += 1;
    onProgress?.(done, total);
  };

  for (const frame of frames) {
    const pageWidth = Math.max(400, Math.min(2400, frame.width));
    const pageHeight = Math.max(300, Math.min(1800, frame.height));
    const page = doc.addPage([pageWidth, pageHeight]);

    // Background
    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
      color: rgb(0.98, 0.98, 0.99),
    });

    // Header badge
    const headerTitle = frame.label || 'Slide';
    page.drawText(headerTitle, {
      x: 24,
      y: pageHeight - 32,
      size: 16,
      font: bold,
      color: rgb(0.2, 0.2, 0.3),
    });

    const tx = (x: number) => x - frame.x;
    const ty = (y: number) => pageHeight - (y - frame.y);

    // Contained nodes (excluding other frames)
    const containedNodes = allNodes.filter(
      (n) =>
        n.id !== frame.id &&
        n.shape !== 'frame' &&
        n.x >= frame.x &&
        n.x + n.width <= frame.x + frame.width &&
        n.y >= frame.y &&
        n.y + n.height <= frame.y + frame.height,
    );

    for (const node of containedNodes) {
      const x = tx(node.x);
      const y = ty(node.y + node.height);
      const w = node.width;
      const h = node.height;
      const fill = pdfColor(node.fill, TONE_FILL[node.tone] ?? '#ede9ff');
      const stroke = pdfColor(node.stroke, TONE_STROKE[node.tone] ?? '#756bce');

      if (node.shape === 'ellipse') {
        page.drawEllipse({
          x: x + w / 2,
          y: y + h / 2,
          xScale: w / 2,
          yScale: h / 2,
          color: fill,
          borderColor: stroke,
          borderWidth: node.strokeWidth ?? 1.5,
        });
      } else {
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          color: fill,
          borderColor: stroke,
          borderWidth: node.strokeWidth ?? 1.5,
        });
      }

      if (node.label) {
        drawWrappedText(
          page,
          node.label,
          x + 10,
          y + h - 18,
          w - 20,
          Math.min(14, (node.fontSize ?? 14)),
          bold,
          pdfColor('#25263a', '#25263a'),
        );
      }
    }

    tick();
  }

  return doc.save();
}

function drawWrappedText(
  page: ReturnType<PDFDocument['addPage']>,
  text: string,
  x: number,
  topY: number,
  maxWidth: number,
  fontSize: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
): void {
  if (!text || maxWidth <= 0 || fontSize <= 0) return;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= 6) break;
    }
  }
  if (current && lines.length < 7) lines.push(current);
  lines.slice(0, 7).forEach((line, index) => {
    page.drawText(line, {
      x,
      y: topY - index * (fontSize + 3),
      size: fontSize,
      font,
      color,
    });
  });
}
