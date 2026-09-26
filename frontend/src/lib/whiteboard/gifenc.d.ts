declare module 'gifenc' {
  export type GifPalette = number[][];
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray | ArrayLike<number>,
    maxColors: number,
    options?: { format?: string },
  ): GifPalette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray | ArrayLike<number>,
    palette: GifPalette,
    format?: string,
  ): Uint8Array;
  export type GifEncoder = {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      opts?: {
        palette?: GifPalette;
        delay?: number;
        repeat?: number;
        transparent?: boolean;
        transparentIndex?: number;
        first?: boolean;
      },
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  export function GIFEncoder(opts?: {
    auto?: boolean;
    initialCapacity?: number;
  }): GifEncoder;
}
