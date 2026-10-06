'use client';

import { useMemo } from 'react';
import type { LaserPoint } from '@/lib/whiteboard/laser';
import { laserTrailSvgPath } from '@/lib/whiteboard/laser';

export interface RemoteLaserPeer {
  id: string;
  name: string;
  color: string;
  points: LaserPoint[];
}

interface LaserOverlayProps {
  localPoints: LaserPoint[];
  localColor?: string;
  remoteLasers: RemoteLaserPeer[];
}

export function LaserOverlay({
  localPoints,
  localColor = '#ef4444',
  remoteLasers,
}: LaserOverlayProps) {
  const localPath = useMemo(
    () => laserTrailSvgPath(localPoints),
    [localPoints],
  );
  const localTip = localPoints[localPoints.length - 1];

  return (
    <g className="laser-overlay" pointerEvents="none" aria-hidden="true">
      <defs>
        <filter id="laserGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Local laser trail */}
      {localPoints.length >= 2 && localPath && (
        <g filter="url(#laserGlow)">
          <path
            d={localPath}
            fill="none"
            stroke={localColor}
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.4"
          />
          <path
            d={localPath}
            fill="none"
            stroke="#ffffff"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.95"
          />
        </g>
      )}

      {/* Local laser tip dot */}
      {localTip && (
        <g transform={`translate(${localTip.x}, ${localTip.y})`}>
          <circle r="9" fill={localColor} opacity="0.35" />
          <circle r="4.5" fill={localColor} />
          <circle r="2.2" fill="#ffffff" />
        </g>
      )}

      {/* Remote peer laser trails */}
      {remoteLasers.map((peer) => {
        if (peer.points.length === 0) return null;
        const path = laserTrailSvgPath(peer.points);
        const tip = peer.points[peer.points.length - 1];
        return (
          <g key={peer.id}>
            {peer.points.length >= 2 && path && (
              <g filter="url(#laserGlow)">
                <path
                  d={path}
                  fill="none"
                  stroke={peer.color}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.4"
                />
                <path
                  d={path}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.95"
                />
              </g>
            )}
            {tip && (
              <g transform={`translate(${tip.x}, ${tip.y})`}>
                <circle r="9" fill={peer.color} opacity="0.35" />
                <circle r="4.5" fill={peer.color} />
                <circle r="2.2" fill="#ffffff" />
                <g transform="translate(10, -10)">
                  <rect
                    x="0"
                    y="-12"
                    width={peer.name.length * 7 + 12}
                    height="18"
                    rx="4"
                    fill={peer.color}
                    opacity="0.9"
                  />
                  <text
                    x="6"
                    y="1"
                    fill="#ffffff"
                    fontSize="11"
                    fontWeight="600"
                    fontFamily="system-ui, -apple-system, sans-serif"
                  >
                    {peer.name}
                  </text>
                </g>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
