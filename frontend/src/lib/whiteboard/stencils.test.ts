import { describe, expect, test } from 'bun:test';
import {
  STENCILS,
  createStencilNode,
  getStencil,
  searchStencils,
} from './stencils';

describe('stencils', () => {
  test('ids are unique and namespaced', () => {
    const ids = STENCILS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STENCILS) {
      expect(s.id.startsWith(`${s.category}:`)).toBe(true);
      expect(s.body.length).toBeGreaterThan(0);
    }
  });

  test('getStencil resolves known ids and rejects unknown', () => {
    expect(getStencil('aws:s3')?.name).toBe('Amazon S3');
    expect(getStencil('nope:x')).toBeNull();
    expect(getStencil(undefined)).toBeNull();
  });

  test('search matches name, keywords, and category filter', () => {
    expect(searchStencils('s3').some((s) => s.id === 'aws:s3')).toBe(true);
    expect(searchStencils('cache').some((s) => s.id === 'database:redis')).toBe(
      true,
    );
    const k8s = searchStencils('', 'k8s');
    expect(k8s.length).toBeGreaterThan(0);
    expect(k8s.every((s) => s.category === 'k8s')).toBe(true);
    expect(searchStencils('zzzz-none')).toEqual([]);
  });

  test('createStencilNode builds a hero icon node', () => {
    const node = createStencilNode(getStencil('k8s:pod')!, 'n1', 10, 20);
    expect(node).toMatchObject({
      id: 'n1',
      x: 10,
      y: 20,
      icon: 'k8s:pod',
      iconLayout: 'hero',
      label: 'Pod',
    });
  });
});
