'use client';

import React, { useCallback, useMemo, useRef } from 'react';
import type {
  BoardArrow,
  BoardNode,
  BoardStroke,
} from '@/lib/whiteboard/board-types';
import type { Camera, Viewport } from '@/lib/whiteboard/geometry';
import { cameraViewBox } from '@/lib/whiteboard/geometry';
import { contentBounds } from '@/lib/whiteboard/export/bounds';

const MINIMAP_WIDTH = 180;
const MINIMAP_HEIGHT = 110;
const MINIMAP_PADDING = 150; // World margin around content

const TONE_COLORS: Record<string, string> = {
  violet: '#756bce',
  orange: '#ec8b57',
  blue: '#5a94c7',
  yellow: '#d2ab40',
  mint: '#72ae8b',
  note: '#e2bd53',
};

type MinimapProps = {
  nodes: BoardNode[];
  arrows: BoardArrow[];
  strokes: BoardStroke[];
  camera: Camera;
  canvasViewport: Viewport;
  onPanTo: (worldX: number, worldY: number) => void;
  visible: boolean;
  onClose?: () => void;
};

export function Minimap({
  nodes,
  arrows,
  strokes,
  camera,
  canvasViewport,
  onPanTo,
  visible,
}: MinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Compute union bounding box of all canvas elements plus current camera view
  const viewBox = useMemo(
    () => cameraViewBox(camera, canvasViewport),
    [camera, canvasViewport],
  );

  const worldBounds = useMemo(() => {
    const rawBounds = contentBounds(nodes, arrows, strokes);
    const minX = Math.min(rawBounds.minX, viewBox.minX) - MINIMAP_PADDING;
    const minY = Math.min(rawBounds.minY, viewBox.minY) - MINIMAP_PADDING;
    const maxX = Math.max(rawBounds.maxX, viewBox.maxX) + MINIMAP_PADDING;
    const maxY = Math.max(rawBounds.maxY, viewBox.maxY) + MINIMAP_PADDING;
    const width = Math.max(100, maxX - minX);
    const height = Math.max(100, maxY - minY);

    return { minX, minY, maxX, maxY, width, height };
  }, [arrows, nodes, strokes, viewBox]);

  // World to minimap pixel scale
  const scale = useMemo(() => {
    const scaleX = MINIMAP_WIDTH / worldBounds.width;
    const scaleY = MINIMAP_HEIGHT / worldBounds.height;
    return Math.min(scaleX, scaleY);
  }, [worldBounds]);

  const offsetX = (MINIMAP_WIDTH - worldBounds.width * scale) / 2;
  const offsetY = (MINIMAP_HEIGHT - worldBounds.height * scale) / 2;

  const toMinimapX = useCallback(
    (worldX: number) => (worldX - worldBounds.minX) * scale + offsetX,
    [worldBounds.minX, scale, offsetX],
  );

  const toMinimapY = useCallback(
    (worldY: number) => (worldY - worldBounds.minY) * scale + offsetY,
    [worldBounds.minY, scale, offsetY],
  );

  const toWorld = useCallback(
    (mapX: number, mapY: number) => {
      const worldX = (mapX - offsetX) / scale + worldBounds.minX;
      const worldY = (mapY - offsetY) / scale + worldBounds.minY;
      return { worldX, worldY };
    },
    [offsetX, offsetY, scale, worldBounds.minX, worldBounds.minY],
  );

  const handlePointerAction = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const mapX = Math.max(
        0,
        Math.min(MINIMAP_WIDTH, event.clientX - rect.left),
      );
      const mapY = Math.max(
        0,
        Math.min(MINIMAP_HEIGHT, event.clientY - rect.top),
      );
      const { worldX, worldY } = toWorld(mapX, mapY);
      onPanTo(worldX, worldY);
    },
    [onPanTo, toWorld],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      isDraggingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      handlePointerAction(event);
    },
    [handlePointerAction],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      handlePointerAction(event);
    },
    [handlePointerAction],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [],
  );

  if (!visible) return null;

  // Viewport rectangle in minimap space
  const vpX = toMinimapX(viewBox.minX);
  const vpY = toMinimapY(viewBox.minY);
  const vpW = Math.max(6, viewBox.width * scale);
  const vpH = Math.max(6, viewBox.height * scale);

  return (
    <div
      ref={containerRef}
      className="canvas-minimap"
      role="region"
      aria-label="Canvas overview minimap"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: 'absolute',
        bottom: 74,
        right: 18,
        width: MINIMAP_WIDTH,
        height: MINIMAP_HEIGHT,
        backgroundColor: 'rgba(28, 29, 41, 0.92)',
        border: '1px solid rgba(105, 101, 219, 0.35)',
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        cursor: 'crosshair',
        zIndex: 40,
        userSelect: 'none',
        backdropFilter: 'blur(8px)',
      }}
    >
      <svg
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        {/* Render strokes as simple lines/points */}
        {strokes.map((stroke) => {
          if (stroke.points.length < 2) return null;
          const d = stroke.points
            .map(
              (p, i) =>
                `${i === 0 ? 'M' : 'L'} ${toMinimapX(p.x)} ${toMinimapY(p.y)}`,
            )
            .join(' ');
          return (
            <path
              key={stroke.id}
              d={d}
              fill="none"
              stroke={stroke.color || '#6b7192'}
              strokeWidth={Math.max(1, (stroke.brushSize ?? 4) * scale)}
              opacity={0.7}
            />
          );
        })}

        {/* Render arrows as lines */}
        {arrows.map((arrow) => (
          <line
            key={arrow.id}
            x1={toMinimapX(arrow.start.x)}
            y1={toMinimapY(arrow.start.y)}
            x2={toMinimapX(arrow.end.x)}
            y2={toMinimapY(arrow.end.y)}
            stroke={arrow.color || '#6b7192'}
            strokeWidth={1}
            opacity={0.65}
          />
        ))}

        {/* Render nodes as miniature rectangles */}
        {nodes.map((node) => {
          const nx = toMinimapX(node.x);
          const ny = toMinimapY(node.y);
          const nw = Math.max(2, node.width * scale);
          const nh = Math.max(2, node.height * scale);
          const color = node.stroke || TONE_COLORS[node.tone] || '#756bce';
          return (
            <rect
              key={node.id}
              x={nx}
              y={ny}
              width={nw}
              height={nh}
              rx={1}
              fill={node.fill || TONE_COLORS[node.tone] || '#756bce'}
              stroke={color}
              strokeWidth={0.5}
              opacity={0.85}
            />
          );
        })}

        {/* Current Camera Viewport outline */}
        <rect
          x={vpX}
          y={vpY}
          width={vpW}
          height={vpH}
          rx={2}
          fill="rgba(105, 101, 219, 0.22)"
          stroke="#8b86ee"
          strokeWidth={1.5}
        />
      </svg>
    </div>
  );
}
