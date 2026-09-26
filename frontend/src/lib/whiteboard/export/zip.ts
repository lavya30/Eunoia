'use client';

import JSZip from 'jszip';
import type { BoardArrow, BoardNode, BoardStroke } from '../board-types';
import type { Camera } from '../geometry';

export type BoardBundleInput = {
  boardTitle: string;
  roomId: string | null;
  roomTier: string | null;
  nodes: BoardNode[];
  arrows: BoardArrow[];
  strokes: BoardStroke[];
  camera: Camera;
  svgString: string;
  pngBlob: Blob;
  pdfBytes: Uint8Array;
};

/** Board-bundle ZIP: vector PDF + hi-res PNG + SVG + JSON + manifest. */
export async function buildBoardBundle(input: BoardBundleInput): Promise<Blob> {
  const zip = new JSZip();
  const json = JSON.stringify(
    {
      nodes: input.nodes,
      arrows: input.arrows,
      strokes: input.strokes,
      camera: input.camera,
    },
    null,
    2,
  );
  zip.file('board.json', json);
  zip.file('board.svg', input.svgString);
  zip.file('board.png', input.pngBlob);
  zip.file('board.pdf', input.pdfBytes);
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        title: input.boardTitle,
        roomId: input.roomId,
        roomTier: input.roomTier,
        exportedAt: new Date().toISOString(),
        app: 'Eunoia Export Pro',
        files: ['board.pdf', 'board.png', 'board.svg', 'board.json'],
        counts: {
          nodes: input.nodes.length,
          arrows: input.arrows.length,
          strokes: input.strokes.length,
        },
      },
      null,
      2,
    ),
  );
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
