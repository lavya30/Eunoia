import RBush from 'rbush';
import { aabbIntersects, type Aabb } from './geometry';

export type SpatialEntry<T> = Aabb & {
  id: string;
  value: T;
};

/**
 * R-Tree spatial index (rbush-backed) for viewport culling.
 *
 * Bulk-loads on rebuild for O(N) construction; point/rect search is
 * O(log N + K) for K visible elements. Benchmarks
 * (`frontend/benchmarks/culling.bench.ts`, synthetic diagram corpus):
 * at N=10k, rebuild 1.6ms vs 6.3ms for the previous fixed-grid index,
 * zoomed-out search 0.13ms vs 2.1ms.
 */
export class SpatialIndex<T> {
  private readonly tree = new RBush<SpatialEntry<T>>();

  private readonly entries = new Map<string, SpatialEntry<T>>();

  clear(): void {
    this.tree.clear();
    this.entries.clear();
  }

  rebuild(entries: SpatialEntry<T>[]): void {
    this.tree.clear();
    this.entries.clear();
    for (const entry of entries) {
      this.entries.set(entry.id, entry);
    }
    this.tree.load(entries);
  }

  upsert(entry: SpatialEntry<T>): void {
    this.remove(entry.id);
    this.entries.set(entry.id, entry);
    this.tree.insert(entry);
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.tree.remove(entry, (a, b) => a.id === b.id);
    this.entries.delete(id);
  }

  search(bounds: Aabb): T[] {
    const found = this.tree.search(bounds);
    // rbush box search is exact for AABBs, but keep the explicit
    // intersection test as a guard against degenerate boxes.
    return found
      .filter((entry) => aabbIntersects(entry, bounds))
      .map((entry) => entry.value);
  }
}
