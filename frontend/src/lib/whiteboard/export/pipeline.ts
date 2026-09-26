'use client';

export function boardFileSlug(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return slug || 'board';
}

export function downloadBlob(blob: Blob, filename: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

/** Clone the live board SVG minus selection/marquee/cursor overlays. */
export function cloneBoardSvg(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('[data-interactive]').forEach((el) => el.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return clone;
}

export function serializeSvg(clone: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(clone);
}

export function svgStringToImage(svgString: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // SVG source is a data: URL and embedded images are inlined by the
    // embed pre-pass, so rasterization never taints the canvas.
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error('The board image could not be rasterized.'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
  });
}

/**
 * Rasterize an SVG string to PNG. Dimensions are CSS pixels before scaling;
 * output is clamped to 4096px per side to respect mobile Safari limits.
 */
export async function svgStringToPngBlob(
  svgString: string,
  cssWidth: number,
  cssHeight: number,
  scale = 2,
): Promise<Blob> {
  if (!(cssWidth > 0) || !(cssHeight > 0)) {
    throw new Error('The board has no visible area to export.');
  }
  const maxPixels = 4096;
  const clampedScale = Math.min(
    scale,
    maxPixels / cssWidth,
    maxPixels / cssHeight,
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cssWidth * clampedScale));
  canvas.height = Math.max(1, Math.round(cssHeight * clampedScale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
  const img = await svgStringToImage(svgString);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(clampedScale, clampedScale);
  ctx.drawImage(img, 0, 0, cssWidth, cssHeight);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (!blob) throw new Error('The PNG canvas was tainted. Try SVG instead.');
  return blob;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not encode image bytes.'));
    reader.readAsDataURL(blob);
  });
}

export async function fetchBlobWithTimeout(
  input: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Blob> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (!response.ok)
      throw new Error(`Image fetch failed (${response.status}).`);
    return await response.blob();
  } finally {
    window.clearTimeout(timer);
  }
}
