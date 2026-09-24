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
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  dashed?: boolean;
  opacity?: number;
  fontSize?: number;
};

export type BoardArrow = {
  id: string;
  start: Point;
  end: Point;
  color: string;
  startNodeId?: string;
  endNodeId?: string;
};

export type BoardStroke = {
  id: string;
  points: Point[];
  color: string;
};
