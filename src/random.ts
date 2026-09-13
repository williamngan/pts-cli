import { createHash } from "node:crypto";

import type { RandomFacts } from "./renderTypes.js";

export const RANDOM_ALGORITHM = "pts-render-seed-v1" as const;

export function effectivePtsSeed(seed: string): string {
  return (
    seed
      .replace(/(^\s*)|(\s*$)/gi, "")
      // Match Pts UHEPRNG's effective-key cleanup exactly.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F]/gi, "")
  );
}

function rotateLeft(value: number, count: number): number {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

export function createSeededRandom(
  effectiveSeed: string,
  domain: "legacy-math" | "worker-math",
): () => number {
  const digest = createHash("sha256")
    .update(RANDOM_ALGORITHM + "\0" + domain + "\0" + effectiveSeed, "utf8")
    .digest();
  const initialState: number[] = [
    digest.readUInt32LE(0),
    digest.readUInt32LE(4),
    digest.readUInt32LE(8),
    digest.readUInt32LE(12),
  ];
  const state: number[] = initialState.every((word) => word === 0)
    ? [0x6d2b79f5, 0x1b56c4e9, 0x9e3779b9, 0x243f6a88]
    : initialState;

  return (): number => {
    const s0 = state[0] ?? 0;
    const s1 = state[1] ?? 0;
    const s2 = state[2] ?? 0;
    const s3 = state[3] ?? 0;
    const result = Math.imul(rotateLeft(Math.imul(s1, 5), 7), 9) >>> 0;
    const temporary = (s1 << 9) >>> 0;

    state[2] = (s2 ^ s0) >>> 0;
    state[3] = (s3 ^ s1) >>> 0;
    state[1] = (s1 ^ (state[2] ?? 0)) >>> 0;
    state[0] = (s0 ^ (state[3] ?? 0)) >>> 0;
    state[2] = ((state[2] ?? 0) ^ temporary) >>> 0;
    state[3] = rotateLeft(state[3] ?? 0, 11);
    return result / 0x1_0000_0000;
  };
}

export function applyRandomSeed(
  Pts: typeof import("pts"),
  seed: string | undefined,
): RandomFacts {
  if (seed === undefined) {
    return {
      seed: null,
      effectiveSeed: null,
      algorithm: null,
      seedApplied: false,
    };
  }

  const effectiveSeed = effectivePtsSeed(seed);
  Pts.Num.seed(seed);
  Math.random = createSeededRandom(effectiveSeed, "worker-math");
  return {
    seed,
    effectiveSeed,
    algorithm: RANDOM_ALGORITHM,
    seedApplied: true,
  };
}
