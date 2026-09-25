import type { Point } from './geometry';

export type BoardNode = {
  id: string;
  label: string;
  detail: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tone: 'violet' | 'orange' | 'blue' | 'yellow' | 'mint' | 'note';
  shape?: 'round' | 'cylinder' | 'note' | 'ellipse' | 'text' | 'image';
  href?: string;
  /** Server-side image record id (R2 uploads). Used to refresh/delete. */
  imageId?: string;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  dashed?: boolean;
  opacity?: number;
  fontSize?: number;
  /** Clockwise rotation in degrees, normalized to [0, 360). Defaults to 0. */
  rotation?: number;
};

export type ArrowRouting = 'straight' | 'orthogonal' | 'curved';

export type BoardArrow = {
  id: string;
  start: Point;
  end: Point;
  color: string;
  startNodeId?: string;
  endNodeId?: string;
  routing?: ArrowRouting;
};

export type InkPoint = Point & {
  /** Pen pressure in [0, 1]. Absent on legacy/mouse points (treated as 0.5). */
  pressure?: number;
};

export type BoardStroke = {
  id: string;
  points: InkPoint[];
  color: string;
  /** Brush diameter in world units. Defaults to 6 (legacy 3px centerline). */
  brushSize?: number;
  /** perfect-freehand thinning factor in [-1, 1]. Defaults to 0.5. */
  thinning?: number;
  opacity?: number;
};
