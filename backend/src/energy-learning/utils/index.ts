import { EnergyBlock } from "generated/prisma";
import { MAX_BLOCKS, MERGE_EPS, MIN_BLOCK } from "../constants";

type EnergyBlockWithoutId = Omit<EnergyBlock, "id" | "userPreferenceId">;

export function normalize(
  blocks: EnergyBlockWithoutId[],
): EnergyBlockWithoutId[] {
  let result = mergeAdjacent(blocks);
  result = dropTinyBlocks(result);
  result = limitBlockCount(result);
  return result;
}

function mergeAdjacent(blocks: EnergyBlockWithoutId[]): EnergyBlockWithoutId[] {
  blocks.sort((a, b) => a.start - b.start);

  const merged: EnergyBlockWithoutId[] = [];

  for (const block of blocks) {
    const last = merged[merged.length - 1];

    if (
      last &&
      last.end === block.start &&
      Math.abs(last.energy - block.energy) < MERGE_EPS
    ) {
      // weighted merge
      const len1 = last.end - last.start;
      const len2 = block.end - block.start;
      const total = len1 + len2;

      last.energy = (last.energy * len1 + block.energy * len2) / total;

      last.confidence = Math.max(last.confidence, block.confidence);
      last.end = block.end;
    } else {
      merged.push({ ...block });
    }
  }

  return merged;
}

function dropTinyBlocks(
  blocks: EnergyBlockWithoutId[],
): EnergyBlockWithoutId[] {
  return blocks.filter((b) => b.end - b.start >= MIN_BLOCK);
}

function limitBlockCount(
  blocks: EnergyBlockWithoutId[],
): EnergyBlockWithoutId[] {
  if (blocks.length <= MAX_BLOCKS) return blocks;

  // merge smallest confidence blocks first
  blocks.sort((a, b) => a.confidence - b.confidence);

  while (blocks.length > MAX_BLOCKS) {
    const b = blocks.shift()!;
    const next = blocks[0];

    if (!next) break;

    next.start = b.start;
    next.energy = (b.energy + next.energy) / 2;
    next.confidence = Math.max(b.confidence, next.confidence);
  }

  return blocks.sort((a, b) => a.start - b.start);
}
