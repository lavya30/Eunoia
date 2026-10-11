'use client';

import type { PointerEvent as ReactPointerEvent } from 'react';
import type {
  BoardArrow,
  BoardNode,
  BoardStroke,
} from '@/lib/whiteboard/board-types';
import type { Point } from '@/lib/whiteboard/geometry';
import {
  detectNodePortDirection,
  generateOrthogonalWaypoints,
  nodesToObstacles,
} from '@/lib/whiteboard/geometry';
import { arrowPath, inkOutlinePath, smoothPath } from '@/lib/whiteboard/paths';

type ElementPointerHandler = (
  event: ReactPointerEvent<SVGGElement | SVGCircleElement>,
  elementId: string,
) => void;

type EndpointHandler = (
  event: ReactPointerEvent<SVGCircleElement>,
  arrowId: string,
  endpoint: 'start' | 'end',
) => void;

export type WaypointHandler = (
  event: ReactPointerEvent<SVGRectElement | SVGCircleElement>,
  arrowId: string,
  index: number,
  initialWaypoints: Point[],
) => void;

/**
 * Freehand stroke group (extracted from WhiteboardPage so the canvas can
 * paint nodes/arrows/strokes in one global z-order).
 */
export function StrokeElement({
  stroke,
  selected,
  interactiveCursor,
  onPointerDown,
}: {
  stroke: BoardStroke;
  selected: boolean;
  interactiveCursor: boolean;
  onPointerDown: ElementPointerHandler;
}) {
  // Pressure ink renders as a filled variable-width outline; legacy
  // centerline strokes keep the uniform look.
  const inkD = inkOutlinePath(stroke);
  const isOutline = inkD.endsWith('Z');
  return (
    <g
      className={`stroke-group ${selected ? 'is-selected' : ''}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown(event, stroke.id);
      }}
    >
      <path
        d={isOutline ? inkD : smoothPath(stroke.points)}
        fill={isOutline ? 'transparent' : 'none'}
        stroke="transparent"
        strokeWidth="18"
        style={{ cursor: interactiveCursor ? 'pointer' : 'default' }}
      />
      {isOutline ? (
        <path
          d={inkD}
          fill={stroke.color}
          fillOpacity={stroke.opacity ?? 1}
          stroke="none"
        />
      ) : (
        <path
          d={smoothPath(stroke.points)}
          fill="none"
          stroke={stroke.color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {selected && (
        <path
          d={isOutline ? inkD : smoothPath(stroke.points)}
          fill="none"
          stroke="#6965db"
          strokeWidth={isOutline ? 2 : 6}
          strokeDasharray="4 4"
          opacity="0.7"
        />
      )}
    </g>
  );
}

/**
 * Connector arrow group with endpoint and orthogonal waypoint bend handles
 * when selected.
 */
export function ArrowElement({
  arrow,
  selected,
  markerId,
  interactiveCursor,
  nodes,
  onPointerDown,
  onEndpointPointerDown,
  onWaypointPointerDown,
}: {
  arrow: BoardArrow;
  selected: boolean;
  markerId: string;
  interactiveCursor: boolean;
  nodes?: BoardNode[];
  onPointerDown: ElementPointerHandler;
  onEndpointPointerDown: EndpointHandler;
  onWaypointPointerDown?: WaypointHandler;
}) {
  const routedD = arrowPath(arrow, nodes);

  // Determine active orthogonal waypoints for bend-point handles
  const isOrthogonal = arrow.routing === 'orthogonal';
  let activeWaypoints: Point[] = [];
  if (selected && isOrthogonal) {
    if (arrow.waypoints && arrow.waypoints.length > 0) {
      activeWaypoints = arrow.waypoints;
    } else {
      const obstacles = nodes
        ? nodesToObstacles(nodes, [
            arrow.startNodeId ?? '',
            arrow.endNodeId ?? '',
          ])
        : [];
      let startDirection = undefined;
      let endDirection = undefined;
      if (nodes) {
        if (arrow.startNodeId) {
          const sNode = nodes.find((n) => n.id === arrow.startNodeId);
          if (sNode)
            startDirection = detectNodePortDirection(sNode, arrow.start);
        }
        if (arrow.endNodeId) {
          const eNode = nodes.find((n) => n.id === arrow.endNodeId);
          if (eNode) endDirection = detectNodePortDirection(eNode, arrow.end);
        }
      }
      activeWaypoints = generateOrthogonalWaypoints(arrow.start, arrow.end, {
        obstacles,
        startDirection,
        endDirection,
      });
    }
  }

  return (
    <g
      className={`arrow-group ${selected ? 'is-selected' : ''}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown(event, arrow.id);
      }}
    >
      <path
        d={routedD}
        fill="none"
        stroke="transparent"
        strokeWidth="18"
        style={{ cursor: interactiveCursor ? 'pointer' : 'default' }}
      />
      <path
        d={routedD}
        fill="none"
        stroke={arrow.color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        markerEnd={`url(#${markerId})`}
      />
      {selected && (
        <>
          <path
            d={routedD}
            fill="none"
            stroke="#6965db"
            strokeWidth="5"
            strokeDasharray="4 4"
            opacity="0.6"
          />
          <circle
            cx={arrow.start.x}
            cy={arrow.start.y}
            r="6"
            fill="#ffffff"
            stroke="#6965db"
            strokeWidth="2.5"
            style={{ cursor: 'move' }}
            onPointerDown={(event) => {
              event.stopPropagation();
              onEndpointPointerDown(event, arrow.id, 'start');
            }}
          />
          {activeWaypoints.map((wp, idx) => (
            <rect
              key={`wp-${idx}`}
              x={wp.x - 5}
              y={wp.y - 5}
              width="10"
              height="10"
              rx="2.5"
              fill="#ffffff"
              stroke="#6965db"
              strokeWidth="2.5"
              style={{ cursor: 'grab' }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onWaypointPointerDown?.(event, arrow.id, idx, activeWaypoints);
              }}
            >
              <title>Drag bend point</title>
            </rect>
          ))}
          <circle
            cx={arrow.end.x}
            cy={arrow.end.y}
            r="6"
            fill="#ffffff"
            stroke="#6965db"
            strokeWidth="2.5"
            style={{ cursor: 'move' }}
            onPointerDown={(event) => {
              event.stopPropagation();
              onEndpointPointerDown(event, arrow.id, 'end');
            }}
          />
        </>
      )}
    </g>
  );
}
