import { randomUUID } from "node:crypto";
import { compressSync } from "fflate";
import * as Y from "yjs";
import type { SnapshotStore } from "./RoomLoader.js";

export type SnapshotFlushReport = {
  roomId: string;
  outcome: "success" | "error";
  durationMs: number;
  bytes: number;
};

export class SnapshotWorker {
  private timer?: ReturnType<typeof setTimeout>;
  private dirty = false;
  private flushPromise?: Promise<void>;

  constructor(
    private readonly roomId: string,
    private readonly store: SnapshotStore,
    private readonly debounceMs: number,
    private readonly onFlush?: (report: SnapshotFlushReport) => void,
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
    this.flushPromise = this.drain(doc);
    return this.flushPromise;
  }

  /**
   * Persist until clean. Concurrent callers share the in-flight drain, which
   * only resolves once fully drained — so `forceFlush`/`dispose` never
   * proceed while a re-flush is still saving.
   */
  private async drain(doc: Y.Doc): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        const started = Date.now();
        const state = Y.encodeStateAsUpdate(doc);
        const version = Buffer.from(Y.encodeStateVector(doc)).toString(
          "base64url",
        );
        const compressed = compressSync(state);
        try {
          await this.store.saveSnapshot({
            id: randomUUID(),
            roomId: this.roomId,
            docVersion: version,
            data: compressed,
            createdAt: new Date(),
          });
          this.onFlush?.({
            roomId: this.roomId,
            outcome: "success",
            durationMs: Date.now() - started,
            bytes: compressed.length,
          });
        } catch (error) {
          this.onFlush?.({
            roomId: this.roomId,
            outcome: "error",
            durationMs: Date.now() - started,
            bytes: compressed.length,
          });
          throw error;
        }
      }
    } finally {
      this.flushPromise = undefined;
    }
  }

  /**
   * Drop pending timer/dirty state when the room moves to a new doc
   * generation (snapshot restore). Callers must drain first via
   * `forceFlush`/`dispose` — reset asserts nothing is in flight.
   */
  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.dirty = false;
  }

  async dispose(doc: Y.Doc): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.flush(doc);
  }

  /**
   * Persist unconditionally, even with no pending changes. Used by snapshot
   * restore so the pre-restore state is always recoverable from history.
   */
  async forceFlush(doc: Y.Doc): Promise<void> {
    this.dirty = true;
    await this.flush(doc);
  }
}
