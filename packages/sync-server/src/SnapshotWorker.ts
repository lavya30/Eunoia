import { compressSync } from 'fflate';
import * as Y from 'yjs';
import type { SnapshotStore } from './RoomLoader.js';

export class SnapshotWorker {
  private timer?: ReturnType<typeof setTimeout>;
  private dirty = false;
  private flushPromise?: Promise<void>;

  constructor(
    private readonly roomId: string,
    private readonly store: SnapshotStore,
    private readonly debounceMs: number,
  ) {}

  schedule(doc: Y.Doc): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush(doc);
    }, this.debounceMs);
  }

  async flush(doc: Y.Doc): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    if (!this.dirty) return;
    this.dirty = false;
    const state = Y.encodeStateAsUpdate(doc);
    const version = Buffer.from(Y.encodeStateVector(doc)).toString('base64url');
    const compressed = compressSync(state);
    this.flushPromise = this.store
      .saveSnapshot({
        roomId: this.roomId,
        docVersion: version,
        data: compressed,
        createdAt: new Date(),
      })
      .finally(() => {
        this.flushPromise = undefined;
        if (this.dirty) void this.flush(doc);
      });
    return this.flushPromise;
  }

  async dispose(doc: Y.Doc): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.flush(doc);
  }
}
