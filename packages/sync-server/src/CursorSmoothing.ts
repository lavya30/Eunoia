export type Point = { x: number; y: number };

export type SmoothedCursor<T extends Point = Point> = T & {
  targetX: number;
  targetY: number;
};

/** Frame-rate independent-enough cursor interpolation for remote pointer telemetry. */
export class CursorSmoothing<T extends Point = Point> {
  private readonly cursors = new Map<string, SmoothedCursor<T>>();

  constructor(private readonly lerpFactor = 0.25) {}

  update(id: string, target: T): SmoothedCursor<T> {
    const current = this.cursors.get(id);
    if (!current) {
      const next = {
        ...target,
        targetX: target.x,
        targetY: target.y,
      } as SmoothedCursor<T>;
      this.cursors.set(id, next);
      return next;
    }
    current.x += (target.x - current.x) * this.lerpFactor;
    current.y += (target.y - current.y) * this.lerpFactor;
    current.targetX = target.x;
    current.targetY = target.y;
    const { x: _x, y: _y, ...metadata } = target;
    Object.assign(current, metadata);
    return current;
  }

  tick(): void {
    for (const cursor of this.cursors.values()) {
      cursor.x += (cursor.targetX - cursor.x) * this.lerpFactor;
      cursor.y += (cursor.targetY - cursor.y) * this.lerpFactor;
    }
  }

  remove(id: string): void {
    this.cursors.delete(id);
  }

  get(id: string): SmoothedCursor<T> | undefined {
    return this.cursors.get(id);
  }
}
