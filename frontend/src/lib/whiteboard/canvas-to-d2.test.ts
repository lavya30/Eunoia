import { describe, expect, test } from 'bun:test';
import type { BoardArrow, BoardNode } from './board-types';
import { canvasToD2, sanitizeD2Identifier } from './canvas-to-d2';

describe('canvasToD2', () => {
  test('sanitizes identifiers and avoids D2 reserved keywords', () => {
    expect(sanitizeD2Identifier('API Gateway', 'node_1')).toBe('api_gateway');
    expect(sanitizeD2Identifier('123 Numbers', 'node_2')).toBe(
      'node_123_numbers',
    );
    expect(sanitizeD2Identifier('direction', 'node_3')).toBe('n_direction');
    expect(sanitizeD2Identifier('style', 'node_4')).toBe('n_style');
    expect(sanitizeD2Identifier('   ', 'fallback')).toBe('fallback');
  });

  test('converts basic nodes with distinct shapes and labels', () => {
    const nodes: BoardNode[] = [
      {
        id: 'n1',
        label: 'Client Browser',
        detail: '',
        x: 0,
        y: 0,
        width: 140,
        height: 70,
        tone: 'violet',
        shape: 'ellipse',
      },
      {
        id: 'n2',
        label: 'PostgreSQL DB',
        detail: 'Primary storage',
        x: 300,
        y: 0,
        width: 160,
        height: 90,
        tone: 'blue',
        shape: 'cylinder',
      },
      {
        id: 'n3',
        label: 'Auth Decision',
        detail: '',
        x: 150,
        y: 100,
        width: 120,
        height: 80,
        tone: 'yellow',
        shape: 'diamond',
      },
    ];

    const d2 = canvasToD2(nodes, [], { includeStyles: false });
    expect(d2).toContain('client_browser: "Client Browser" {');
    expect(d2).toContain('shape: circle');
    expect(d2).toContain('postgresql_db: "PostgreSQL DB" {');
    expect(d2).toContain('shape: cylinder');
    expect(d2).toContain('description: "Primary storage"');
    expect(d2).toContain('auth_decision: "Auth Decision" {');
    expect(d2).toContain('shape: diamond');
  });

  test('converts stencil icons into icon attributes', () => {
    const nodes: BoardNode[] = [
      {
        id: 's1',
        label: 'S3 Storage',
        detail: '',
        x: 0,
        y: 0,
        width: 120,
        height: 120,
        tone: 'orange',
        shape: 'round',
        icon: 'aws:s3',
      },
    ];

    const d2 = canvasToD2(nodes, [], { includeStyles: false });
    expect(d2).toContain('icon: "aws:s3"');
  });

  test('disambiguates duplicate labels with sequential suffixes', () => {
    const nodes: BoardNode[] = [
      {
        id: 'n1',
        label: 'Worker',
        detail: '',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        tone: 'mint',
      },
      {
        id: 'n2',
        label: 'Worker',
        detail: '',
        x: 200,
        y: 0,
        width: 100,
        height: 50,
        tone: 'mint',
      },
    ];

    const d2 = canvasToD2(nodes, [], { includeStyles: false });
    expect(d2).toContain('worker: "Worker"');
    expect(d2).toContain('worker_2: "Worker"');
  });

  test('connects nodes with arrows using IDs and proximity fallback', () => {
    const nodes: BoardNode[] = [
      {
        id: 'frontend',
        label: 'Frontend',
        detail: '',
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        tone: 'violet',
      },
      {
        id: 'backend',
        label: 'Backend',
        detail: '',
        x: 300,
        y: 0,
        width: 100,
        height: 60,
        tone: 'blue',
      },
    ];

    const arrows: BoardArrow[] = [
      // Explicit connection
      {
        id: 'a1',
        startNodeId: 'frontend',
        endNodeId: 'backend',
        start: { x: 100, y: 30 },
        end: { x: 300, y: 30 },
        color: '#5b54c7',
      },
      // Proximity connection (no explicit IDs)
      {
        id: 'a2',
        start: { x: 320, y: 20 },
        end: { x: 50, y: 20 },
        color: '#6b7192',
      },
    ];

    const d2 = canvasToD2(nodes, arrows);
    expect(d2).toContain('frontend -> backend');
    expect(d2).toContain('backend -> frontend');
  });

  test('nests nodes inside frames and scopes paths properly', () => {
    const nodes: BoardNode[] = [
      // Frame
      {
        id: 'f1',
        label: 'Cloud VPC',
        detail: '',
        x: 100,
        y: 100,
        width: 600,
        height: 400,
        tone: 'mint',
        shape: 'frame',
      },
      // Inside Frame
      {
        id: 'api',
        label: 'API Service',
        detail: '',
        x: 150,
        y: 150,
        width: 120,
        height: 60,
        tone: 'violet',
      },
      // Outside Frame
      {
        id: 'db',
        label: 'External Database',
        detail: '',
        x: 800,
        y: 150,
        width: 120,
        height: 60,
        tone: 'blue',
        shape: 'cylinder',
      },
    ];

    const arrows: BoardArrow[] = [
      {
        id: 'a1',
        startNodeId: 'api',
        endNodeId: 'db',
        start: { x: 270, y: 180 },
        end: { x: 800, y: 180 },
        color: '#6b7192',
      },
    ];

    const d2 = canvasToD2(nodes, arrows, { includeStyles: false });
    expect(d2).toContain('cloud_vpc: "Cloud VPC" {');
    expect(d2).toContain('  api_service: "API Service"');
    expect(d2).toContain('cloud_vpc.api_service -> external_database');
  });

  test('honors selectedNodeIds filter', () => {
    const nodes: BoardNode[] = [
      {
        id: 'n1',
        label: 'Node One',
        detail: '',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        tone: 'mint',
      },
      {
        id: 'n2',
        label: 'Node Two',
        detail: '',
        x: 200,
        y: 0,
        width: 100,
        height: 50,
        tone: 'mint',
      },
      {
        id: 'n3',
        label: 'Node Three',
        detail: '',
        x: 400,
        y: 0,
        width: 100,
        height: 50,
        tone: 'mint',
      },
    ];

    const d2 = canvasToD2(nodes, [], { selectedNodeIds: ['n1', 'n3'] });
    expect(d2).toContain('node_one: "Node One"');
    expect(d2).toContain('node_three: "Node Three"');
    expect(d2).not.toContain('Node Two');
  });

  test('detects horizontal direction automatically', () => {
    const nodes: BoardNode[] = [
      {
        id: '1',
        label: 'Start',
        detail: '',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        tone: 'mint',
      },
      {
        id: '2',
        label: 'End',
        detail: '',
        x: 500,
        y: 20,
        width: 100,
        height: 50,
        tone: 'mint',
      },
    ];
    const d2 = canvasToD2(nodes, []);
    expect(d2).toContain('direction: right');
  });

  test('applies styling including stroke, fill, dashed, and opacity', () => {
    const nodes: BoardNode[] = [
      {
        id: 'styled',
        label: 'Dashed Box',
        detail: '',
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        tone: 'orange',
        fill: '#ffe0ca',
        stroke: '#ff6b4a',
        strokeWidth: 4,
        dashed: true,
        opacity: 0.85,
      },
    ];
    const arrows: BoardArrow[] = [
      {
        id: 'a1',
        startNodeId: 'styled',
        endNodeId: 'styled2',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
        color: '#ff6b4a',
      },
    ];

    const d2 = canvasToD2(nodes, arrows, { includeStyles: true });
    expect(d2).toContain('style.fill: "#ffe0ca"');
    expect(d2).toContain('style.stroke: "#ff6b4a"');
    expect(d2).toContain('style.stroke-width: 4');
    expect(d2).toContain('style.stroke-dash: 3');
    expect(d2).toContain('style.opacity: 0.85');
  });

  test('handles multi-level nested frames', () => {
    const nodes: BoardNode[] = [
      {
        id: 'outer',
        label: 'VPC',
        detail: '',
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        tone: 'mint',
        shape: 'frame',
      },
      {
        id: 'inner',
        label: 'Private Subnet',
        detail: '',
        x: 50,
        y: 50,
        width: 400,
        height: 300,
        tone: 'mint',
        shape: 'frame',
      },
      {
        id: 'pod',
        label: 'App Pod',
        detail: '',
        x: 100,
        y: 100,
        width: 120,
        height: 60,
        tone: 'blue',
      },
    ];

    const d2 = canvasToD2(nodes, [], { includeStyles: false });
    expect(d2).toContain('vpc: "VPC" {');
    expect(d2).toContain('private_subnet: "Private Subnet" {');
    expect(d2).toContain('app_pod: "App Pod"');
  });

  test('returns empty string for empty canvas', () => {
    expect(canvasToD2([], [])).toBe('');
  });
});
