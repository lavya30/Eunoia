import { aabbIntersects, type Aabb } from './geometry';

export type SpatialEntry<T> = Aabb & {
  id: string;
  value: T;
};

export class SpatialIndex<T> {
  private readonly cellSize: number;

  private readonly cells = new Map<string, Set<string>>();

  private readonly entries = new Map<string, SpatialEntry<T>>();

  constructor(cellSize = 240) {
    this.cellSize = cellSize;
  }

  clear(): void {
    this.cells.clear();
    this.entries.clear();
  }

  rebuild(entries: SpatialEntry<T>[]): void {
    this.clear();
    entries.forEach((entry) => this.upsert(entry));
  }

  upsert(entry: SpatialEntry<T>): void {
    this.remove(entry.id);
    this.entries.set(entry.id, entry);

    for (const key of this.keysFor(entry)) {
      const cell = this.cells.get(key) ?? new Set<string>();
      cell.add(entry.id);
      this.cells.set(key, cell);
    }
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    for (const key of this.keysFor(entry)) {
      const cell = this.cells.get(key);
      cell?.delete(id);
      if (cell?.size === 0) this.cells.delete(key);
    }

    this.entries.delete(id);
  }

  search(bounds: Aabb): T[] {
    const candidateIds = new Set<string>();

    for (const key of this.keysFor(bounds)) {
      this.cells.get(key)?.forEach((id) => candidateIds.add(id));
    }

    return Array.from(candidateIds)
      .map((id) => this.entries.get(id))
      .filter((entry): entry is SpatialEntry<T> => Boolean(entry))
      .filter((entry) => aabbIntersects(entry, bounds))
      .map((entry) => entry.value);
  }

  private keysFor(bounds: Aabb): string[] {
    const minCellX = Math.floor(bounds.minX / this.cellSize);
    const maxCellX = Math.floor(bounds.maxX / this.cellSize);
    const minCellY = Math.floor(bounds.minY / this.cellSize);
    const maxCellY = Math.floor(bounds.maxY / this.cellSize);
    const keys: string[] = [];

    for (let x = minCellX; x <= maxCellX; x += 1) {
      for (let y = minCellY; y <= maxCellY; y += 1) {
        keys.push(`${x}:${y}`);
      }
    }

    return keys;
  }
}
