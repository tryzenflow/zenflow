import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Moon, Sun } from "lucide-react";
import { Dispatch, useRef, useState } from "react";
import { DayFocusBlocks, FocusBlock as IFocusBlock } from "../../types/prefs";
import {
  EARLY_BIRD_BLOCKS,
  NIGHT_OWL_BLOCKS,
  minutesToTime,
} from "../../utils/prefs";
import { FocusBlock } from "./focus-block";
import { snapToFive } from "../../utils/snap";
import { toast } from "sonner";

// Helper to convert minutes (0-1440) to a display time string (e.g., 5:00 AM)
interface FocusBlocksProps {
  focusBlocks: DayFocusBlocks;
  setFocusBlocks: Dispatch<React.SetStateAction<DayFocusBlocks>>;
}

const PIXELS_PER_MINUTE = 1; // adjust if you're scaling
const DEFAULT_BLOCK_LENGTH = 60; // 60 minutes

export function FocusBlocksPrefs({
  focusBlocks,
  setFocusBlocks,
}: FocusBlocksProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedDay, setSelectedDay] = useState<
    "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"
  >("Mon");

  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

  const applyPreset = (presetBlocks: IFocusBlock[]) => {
    const newBlocks = presetBlocks.map((b) => ({
      ...b,
      id: crypto.randomUUID(),
    }));
    setFocusBlocks((prev) => ({
      ...prev,
      [selectedDay]: newBlocks,
    }));
  };

  const applyToEveryWeekday = () => {
    toast.info("Successfully applied to every weekday");
    setFocusBlocks((prev) => ({
      Mon: prev[selectedDay],
      Tue: prev[selectedDay],
      Wed: prev[selectedDay],
      Thu: prev[selectedDay],
      Fri: prev[selectedDay],
      Sat: prev[selectedDay],
      Sun: prev[selectedDay],
    }));
  };

  return (
    <form>
      <h2 className="text-2xl font-bold mb-1">Customize focus blocks</h2>
      <p className="text-muted-foreground mb-6">
        Night owl or early bird? Customize your focus blocks to match when
        you're at your best.
      </p>

      <Tabs
        value={selectedDay}
        onValueChange={(value) => setSelectedDay(value as typeof selectedDay)}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-7 mb-6">
          {days.map((day) => (
            <TabsTrigger key={day} value={day}>
              {day}
            </TabsTrigger>
          ))}
        </TabsList>

        {days.map((day) => (
          <TabsContent key={day} value={day}>
            {/* Presets */}
            <div className="flex justify-center gap-4 mb-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => applyPreset(EARLY_BIRD_BLOCKS)}
                className="flex items-center gap-2"
              >
                <Sun className="text-yellow-500 size-4" /> Early bird
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => applyPreset(NIGHT_OWL_BLOCKS)}
                className="flex items-center gap-2"
              >
                <Moon className="text-blue-500 size-4" /> Night owl
              </Button>
            </div>

            <div
              data-block
              onClick={(e) => {
                if (!containerRef.current) return;
                const target = e.target as HTMLElement;
                if (target.dataset?.block) return;

                const rect = containerRef.current.getBoundingClientRect();
                const x = e.clientX - rect.left;

                const start = snapToFive(x / PIXELS_PER_MINUTE);

                // Get all existing blocks sorted
                const blocks = [...focusBlocks[day]].sort(
                  (a, b) => a.start - b.start
                );

                // Find the next block to the right of the click
                const nextBlock = blocks.find((b) => b.start > start);
                const prevBlock = [...blocks]
                  .reverse()
                  .find((b) => b.start <= start);

                // Determine available space
                const availableStart = prevBlock ? prevBlock.end : 0;
                const availableEnd = nextBlock ? nextBlock.start : 1440; // one day = 1440 min

                // Clamp start to available area
                const clampedStart = Math.max(start, availableStart);
                const maxLength = availableEnd - clampedStart;
                const blockLength = Math.min(DEFAULT_BLOCK_LENGTH, maxLength);

                // No room to place a block
                if (blockLength < 5) return;

                const newBlock = {
                  id: crypto.randomUUID(),
                  start: clampedStart,
                  end: clampedStart + blockLength,
                  level: Math.max(
                    1,
                    Math.floor((rect.bottom - e.clientY) / 40)
                  ),
                };

                setFocusBlocks((prev) => ({
                  ...prev,
                  [day]: [...prev[day], newBlock].sort(
                    (a, b) => a.start - b.start
                  ),
                }));
              }}
              ref={containerRef}
              className="relative border-x overflow-x-scroll border-b h-[200px] bg-gray-50/50"
            >
              <div className="absolute inset-0 flex">
                {Array(24)
                  .fill(0)
                  .map((_, i) => (
                    <div
                      key={i}
                      className="flex-1 border-l text-xs text-muted-foreground pt-1 pl-1"
                      style={{ minWidth: 60 }}
                    >
                      {i * 60 < 1440
                        ? minutesToTime(i * 60)
                            .replace(":00", "")
                            .replace(" ", "")
                        : null}
                    </div>
                  ))}
              </div>

              <div className="absolute rounded-full inset-x-0 bottom-0 h-10">
                {focusBlocks[day].map((block) => (
                  <FocusBlock
                    key={block.id}
                    block={block}
                    deleteBlock={(id) =>
                      setFocusBlocks((prev) => ({
                        ...prev,
                        [day]: prev[day].filter((b) => {
                          return b.id !== id;
                        }),
                      }))
                    }
                    onBlockChange={(id, updated) =>
                      setFocusBlocks((prev) => {
                        // Clone day's blocks array safely
                        const blocks = [...prev[day]];
                        const index = blocks.findIndex((b) => b.id === id);
                        if (index === -1) return prev;

                        // Merge updates into a new block object
                        const updatedBlock = { ...blocks[index], ...updated };

                        updatedBlock.start = snapToFive(updatedBlock.start);
                        updatedBlock.end = snapToFive(updatedBlock.end);

                        // --- Ensure minimum 5-minute width ---
                        if (updatedBlock.end <= updatedBlock.start) {
                          updatedBlock.end = updatedBlock.start + 5;
                        }

                        // --- Get all other blocks, sorted by start time ---
                        const others = blocks
                          .filter((b) => b.id !== id)
                          .sort((a, b) => a.start - b.start);

                        // --- Find nearest left and right neighbors ---
                        const prevBlock = others
                          .filter((b) => b.start <= updatedBlock.start)
                          .at(-1);
                        const nextBlock = others.find(
                          (b) => b.start >= updatedBlock.start
                        );

                        // --- Clamp to avoid overlap ---
                        if (prevBlock && updatedBlock.start < prevBlock.end) {
                          // Snap to the end of the previous block
                          updatedBlock.start = prevBlock.end;
                          updatedBlock.end = Math.max(
                            updatedBlock.start + 5,
                            updatedBlock.end
                          );
                        }

                        if (nextBlock && updatedBlock.end > nextBlock.start) {
                          // Snap to the start of the next block
                          updatedBlock.end = nextBlock.start;
                          updatedBlock.start = Math.min(
                            updatedBlock.start,
                            updatedBlock.end - 5
                          );
                        }

                        // --- Rebuild the day’s array immutably ---
                        const newBlocks = blocks.map((b, i) =>
                          i === index ? updatedBlock : b
                        );

                        // --- Return new overall state ---
                        return {
                          ...prev,
                          [day]: newBlocks,
                        };
                      })
                    }
                  />
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                No energy assigned? We'll try to keep those hours free from
                tasks.
              </p>
              <div className="flex justify-center font-medium items-center gap-2">
                <span className="flex items-center gap-1 text-sm">
                  <div className="size-4 rounded-sm bg-red-500" /> High
                </span>
                <span className="flex items-center gap-1 text-sm">
                  <div className="size-4 rounded-sm bg-yellow-500" /> Medium
                </span>
                <span className="flex items-center gap-1 text-sm">
                  <div className="size-4 rounded-sm bg-green-500" /> Low
                </span>
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
      <Button
        size="sm"
        className="mt-4"
        type="button"
        onClick={applyToEveryWeekday}
        variant="secondary"
      >
        Apply to every weekday
      </Button>
    </form>
  );
}
