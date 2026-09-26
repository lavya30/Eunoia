'use client';

import {
  ArrowRight,
  Circle,
  Hand,
  MousePointer2,
  Pencil,
  Square,
  StickyNote,
  Type,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PeerInfo } from '@/lib/whiteboard/sync';

/** Smoothing rate (1/s) for the exponential cursor interpolation. */
const LERP_RATE = 14;

function ToolGlyph({ tool }: { tool: string | null }) {
  // Nested <svg> with x/y is valid SVG and lets us reuse lucide icons
  // inside the world-space cursor group.
  const props = { x: 13.5, y: -12.5, width: 13, height: 13, color: '#fff' };
  switch (tool) {
    case 'hand':
      return <Hand {...props} />;
    case 'note':
      return <StickyNote {...props} />;
    case 'rectangle':
      return <Square {...props} />;
    case 'ellipse':
      return <Circle {...props} />;
    case 'arrow':
      return <ArrowRight {...props} />;
    case 'draw':
      return <Pencil {...props} />;
    case 'text':
      return <Type {...props} />;
    case 'select':
    default:
      return <MousePointer2 {...props} />;
  }
}

/**
 * Remote peer cursors with exponential (LERP) smoothing.
 *
 * Awareness updates arrive at ~20Hz and would otherwise make cursors jump
 * between samples. This component owns a rAF loop that interpolates each
 * displayed cursor toward its latest target, so only this small overlay
 * re-renders at 60fps — never the board scene.
 */
export function RemoteCursors({ peers }: { peers: PeerInfo[] }) {
  const [positions, setPositions] = useState(
    () => new Map<number, { x: number; y: number }>(),
  );
  const peersRef = useRef(peers);

  useEffect(() => {
    peersRef.current = peers;
  });

  useEffect(() => {
    const display = new Map<number, { x: number; y: number }>();
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const targets = new Map<number, { x: number; y: number }>();
      for (const peer of peersRef.current) {
        if (peer.cursor) targets.set(peer.clientId, peer.cursor);
      }
      const k = 1 - Math.exp(-dt * LERP_RATE);
      let moved = false;
      for (const [id, target] of targets) {
        const current = display.get(id) ?? { ...target };
        const next = {
          x: current.x + (target.x - current.x) * k,
          y: current.y + (target.y - current.y) * k,
        };
        if (
          Math.abs(next.x - current.x) > 0.01 ||
          Math.abs(next.y - current.y) > 0.01
        ) {
          moved = true;
        }
        display.set(id, next);
      }
      for (const id of [...display.keys()]) {
        if (!targets.has(id)) {
          display.delete(id);
          moved = true;
        }
      }
      if (moved) setPositions(new Map(display));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const metaById = new Map(peers.map((peer) => [peer.clientId, peer]));
  return (
    <>
      {[...positions].map(([clientId, pos]) => {
        const peer = metaById.get(clientId);
        if (!peer) return null;
        return (
          <g
            key={clientId}
            className="remote-cursor"
            transform={`translate(${pos.x} ${pos.y})`}
            pointerEvents="none"
          >
            <path
              d="M0 0 L0 16 L4.5 12 L7 18 L9.5 16.8 L7 11 L11.5 11 Z"
              fill={peer.user.color}
              stroke="#fff"
              strokeWidth="1.2"
            />
            <circle
              cx={20}
              cy={-6}
              r={9}
              fill={peer.user.color}
              stroke="#fff"
              strokeWidth="1.2"
            />
            <ToolGlyph tool={peer.tool} />
            <text
              x={13}
              y={13}
              className="remote-cursor-label"
              fill={peer.user.color}
            >
              {peer.user.name}
            </text>
          </g>
        );
      })}
    </>
  );
}
