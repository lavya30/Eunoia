/**
 * Smart Alignment Guides & Snapping Engine.
 *
 * Computes magnetic alignment guidelines between a dragged/moving bounding box
 * and nearby static nodes on the canvas.
 */

import type { Aabb, Point } from './geometry';

export type SmartGuide = {
  id: string;
  orientation: 'horizontal' | 'vertical';
  /** Start and end points in world coordinates for SVG rendering. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type SnapCandidate = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SmartSnapResult = {
  snappedX: number;
  snappedY: number;
  guides: SmartGuide[];
};

/**
 * Computes alignment snapping against other nodes.
 *
 * @param dragAabb - The bounding box of the dragged node / selection.
 * @param candidates - Other static nodes on the canvas to snap against.
 * @param threshold - Distance threshold in world units to trigger snap (default: 6).
 */
export function computeSmartSnap(
  dragAabb: Aabb,
  candidates: SnapCandidate[],
  threshold = 6,
): SmartSnapResult {
  let deltaX = 0;
  let deltaY = 0;
  let minDiffX = threshold + 1;
  let minDiffY = threshold + 1;

  const dragLeft = dragAabb.minX;
  const dragCenter = (dragAabb.minX + dragAabb.maxX) / 2;
  const dragRight = dragAabb.maxX;

  const dragTop = dragAabb.minY;
  const dragMiddle = (dragAabb.minY + dragAabb.maxY) / 2;
  const dragBottom = dragAabb.maxY;

  const guides: SmartGuide[] = [];
  let bestGuideX: SmartGuide | null = null;
  let bestGuideY: SmartGuide | null = null;

  for (const candidate of candidates) {
    const candLeft = candidate.x;
    const candCenter = candidate.x + candidate.width / 2;
    const candRight = candidate.x + candidate.width;

    const candTop = candidate.y;
    const candMiddle = candidate.y + candidate.height / 2;
    const candBottom = candidate.y + candidate.height;

    // --- X-axis (Vertical guidelines) ---
    const xChecks: [number, number][] = [
      [dragLeft, candLeft],
      [dragLeft, candRight],
      [dragCenter, candCenter],
      [dragRight, candLeft],
      [dragRight, candRight],
    ];

    for (const [dVal, cVal] of xChecks) {
      const diff = Math.abs(dVal - cVal);
      if (diff <= threshold && diff < minDiffX) {
        minDiffX = diff;
        deltaX = cVal - dVal;
        const minY = Math.min(dragAabb.minY, candidate.y) - 20;
        const maxY =
          Math.max(dragAabb.maxY, candidate.y + candidate.height) + 20;
        bestGuideX = {
          id: `v_${candidate.id}_${cVal}`,
          orientation: 'vertical',
          x1: cVal,
          y1: minY,
          x2: cVal,
          y2: maxY,
        };
      }
    }

    // --- Y-axis (Horizontal guidelines) ---
    const yChecks: [number, number][] = [
      [dragTop, candTop],
      [dragTop, candBottom],
      [dragMiddle, candMiddle],
      [dragBottom, candTop],
      [dragBottom, candBottom],
    ];

    for (const [dVal, cVal] of yChecks) {
      const diff = Math.abs(dVal - cVal);
      if (diff <= threshold && diff < minDiffY) {
        minDiffY = diff;
        deltaY = cVal - dVal;
        const minX = Math.min(dragAabb.minX, candidate.x) - 20;
        const maxX =
          Math.max(dragAabb.maxX, candidate.x + candidate.width) + 20;
        bestGuideY = {
          id: `h_${candidate.id}_${cVal}`,
          orientation: 'horizontal',
          x1: minX,
          y1: cVal,
          x2: maxX,
          y2: cVal,
        };
      }
    }
  }

  if (bestGuideX) guides.push(bestGuideX);
  if (bestGuideY) guides.push(bestGuideY);

  return {
    snappedX: dragAabb.minX + deltaX,
    snappedY: dragAabb.minY + deltaY,
    guides,
  };
}
