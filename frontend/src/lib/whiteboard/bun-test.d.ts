// Minimal ambient declarations for co-located bun tests.
// The app itself never imports 'bun:test'; these exist so `tsc --noEmit`
// and `next build` stay green alongside `bun test`.
declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void): void;
  export function expect(actual: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toMatchObject(expected: unknown): void;
    not: {
      toBeNull(): void;
    };
  };
}
