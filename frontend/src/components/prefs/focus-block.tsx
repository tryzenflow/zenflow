import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuRadioGroup,
  ContextMenuLabel,
  ContextMenuRadioItem,
  ContextMenuGroup,
  ContextMenuSeparator,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import React, { useRef, useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import { FocusBlock as IFocusBlock } from "../../types/prefs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { Trash } from "lucide-react";
import { minutesToTime } from "../../utils/prefs";
import { snapToFive } from "../../utils/snap";

interface FocusBlockProps {
  block: IFocusBlock;
  onBlockChange: (id: string, updated: Partial<IFocusBlock>) => void;
  deleteBlock: (id: string) => void;
}

const BOUNDARY = 5;
const MIN_BLOCK_MINUTES = 5;
const PIXELS_PER_MINUTE = 1;

export function FocusBlock({
  block,
  onBlockChange,
  deleteBlock,
}: FocusBlockProps) {
  const colorMap = { 3: "bg-red-500", 2: "bg-yellow-500", 1: "bg-green-500" };
  const blockRef = useRef<HTMLDivElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState<
    "move" | "resizeLeft" | "resizeRight" | null
  >(null);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [initialStart, setInitialStart] = useState(block.start);
  const [initialEnd, setInitialEnd] = useState(block.end);

  // ---- Handle mouse down ----
  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!blockRef.current) return;
    const rect = blockRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;

    if (offsetX < BOUNDARY) {
      setDragType("resizeLeft");
    } else if (offsetX > rect.width - BOUNDARY) {
      setDragType("resizeRight");
    } else {
      setDragType("move");
    }

    setIsDragging(true);
    setDragStartX(e.clientX);
    setInitialStart(block.start);
    setInitialEnd(block.end);
    e.stopPropagation();
    e.preventDefault();
  };

  const onMouseMove = (e: MouseEvent) => {
    e.stopPropagation();
    if (!isDragging || dragStartX === null || !dragType) return;
    const delta = e.clientX - dragStartX; // 1 px = 1 min
    const newStart = initialStart + delta;
    const newEnd = initialEnd + delta;

    if (dragType === "move") {
      onBlockChange(block.id, {
        start: snapToFive(newStart),
        end: snapToFive(newEnd),
      });
    } else if (dragType === "resizeLeft") {
      onBlockChange(block.id, {
        start: snapToFive(
          Math.min(initialStart + delta, initialEnd - MIN_BLOCK_MINUTES)
        ),
      });
    } else if (dragType === "resizeRight") {
      onBlockChange(block.id, {
        end: snapToFive(
          Math.max(initialEnd + delta, initialStart + MIN_BLOCK_MINUTES)
        ),
      });
    }
  };

  // ---- Handle mouse up ----
  const onMouseUp = (e: MouseEvent) => {
    e.stopPropagation();
    setIsDragging(false);
    setDragType(null);
    setDragStartX(null);
  };

  // ---- Cursor change on hover ----
  const onMouseMoveOver = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!blockRef.current || isDragging) return;
    const rect = blockRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;

    if (offsetX < BOUNDARY || offsetX > rect.width - BOUNDARY) {
      blockRef.current.style.cursor = "ew-resize";
    } else {
      blockRef.current.style.cursor = "grab";
    }
  };

  // ---- Global listeners during drag ----
  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    } else {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging, dragType, dragStartX, initialStart, initialEnd]);

  return (
    <TooltipProvider key={block.id}>
      <Tooltip>
        <ContextMenu>
          <TooltipTrigger asChild>
            <ContextMenuTrigger asChild>
              <div
                data-block
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMoveOver}
                ref={blockRef}
                className={cn(
                  "absolute h-full transition-all cursor-pointer rounded-full opacity-70 hover:opacity-100",
                  colorMap[block.level]
                )}
                style={{
                  left: `${block.start * PIXELS_PER_MINUTE}px`,
                  width: `${(block.end - block.start) * PIXELS_PER_MINUTE}px`,
                  bottom: `${(block.level - 1) * 48}px`,
                }}
              />
            </ContextMenuTrigger>
          </TooltipTrigger>
          <ContextMenuContent>
            <ContextMenuRadioGroup
              value={block.level.toString()}
              onValueChange={(value) =>
                onBlockChange(block.id, {
                  level: +value as IFocusBlock["level"],
                })
              }
              onClick={(e) => e.stopPropagation()}
            >
              <ContextMenuLabel>Focus</ContextMenuLabel>
              <ContextMenuRadioItem value="1">
                <div className="size-4 bg-green-500 rounded-sm" /> Low
              </ContextMenuRadioItem>
              <ContextMenuRadioItem value="2">
                <div className="size-4 bg-yellow-500 rounded-sm" /> Medium
              </ContextMenuRadioItem>
              <ContextMenuRadioItem value="3">
                <div className="size-4 bg-red-500 rounded-sm" /> High
              </ContextMenuRadioItem>
            </ContextMenuRadioGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  deleteBlock(block.id);
                }}
                variant="destructive"
              >
                <Trash className="size-4 text-destructive" />
                Delete
              </ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuContent>
        </ContextMenu>
        <TooltipContent>
          {minutesToTime(block.start)} - {minutesToTime(block.end)} (
          {block.level === 3 ? "High" : block.level === 2 ? "Medium" : "Low"})
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
