import { Injectable } from "@nestjs/common";
import { EnergyBlock } from "generated/prisma";
import { normalize } from "./utils";
import { ALPHA, CONF_GAIN } from "./constants";

@Injectable()
export class EnergyLearningService {
  observeManualPlacement(
    blocks: Omit<EnergyBlock, "id" | "userPreferenceId">[],
    start: number,
    end: number,
    taskEnergy: number,
  ): Omit<EnergyBlock, "id" | "userPreferenceId">[] {
    let newBlocks: Omit<EnergyBlock, "id" | "userPreferenceId">[] = [];

    // 1. Sort blocks defensively
    blocks.sort((a, b) => a.start - b.start);

    // 2. Find overlaps
    const overlaps = blocks.filter((b) => b.start < end && b.end > start);

    // 3. No overlap → create new block
    if (overlaps.length === 0) {
      newBlocks = [
        ...blocks,
        {
          start,
          end,
          energy: taskEnergy,
          confidence: 0.2,
        },
      ];
      return normalize(newBlocks);
    }

    // 4. Process each overlapping block
    for (const block of overlaps) {
      // left remainder
      if (block.start < start) {
        newBlocks.push({
          ...block,
          end: start,
        });
      }

      // overlapping segment
      const overlapStart = Math.max(block.start, start);
      const overlapEnd = Math.min(block.end, end);
      const overlapLen = overlapEnd - overlapStart;
      const blockLen = block.end - block.start;

      const ratio = overlapLen / blockLen;
      const alpha = ALPHA * ratio;

      newBlocks.push({
        start: overlapStart,
        end: overlapEnd,
        energy: block.energy + alpha * (taskEnergy - block.energy),
        confidence: Math.min(1, block.confidence + CONF_GAIN),
      });

      // right remainder
      if (block.end > end) {
        newBlocks.push({
          ...block,
          start: end,
        });
      }
    }

    // 5. Add untouched blocks
    for (const block of blocks) {
      const touched = overlaps.includes(block);
      if (!touched) {
        newBlocks.push(block);
      }
    }

    // 6. Normalize
    return normalize(newBlocks);
  }
}
