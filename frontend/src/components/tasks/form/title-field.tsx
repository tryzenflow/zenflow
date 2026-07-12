import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Task } from "@zenflow/shared";
import {
  Command,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useState, useRef, useEffect } from "react";
import { listTaskSuggestions } from "@/api/tasks";
import { FormControl } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const durationLabel = (m: number) =>
  m % 60 === 0
    ? `${m / 60}h`
    : m >= 60
      ? `${Math.floor(m / 60)}h ${m % 60}m`
      : `${m}m`;

/**
 * Title combobox (create mode only): the typed text *is* the title value, so a
 * brand-new title that matches nothing is always submittable — selection never
 * traps input. As the user types we fetch their existing tasks (recency-sorted,
 * server-filtered/deduped) debounced ~250ms; picking one populates the rest of
 * the form via the `onSelect` callback.
 */
export function TitleField({
  value,
  onChange,
  onSelect,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (task: Task) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Task[]>([]);
  // Monotonic request id: only the newest in-flight fetch may commit results,
  // so a slow earlier response can never clobber a newer query's suggestions.
  const requestSeq = useRef(0);

  useEffect(() => {
    const q = value.trim();
    if (!q) {
      requestSeq.current += 1; // invalidate any in-flight fetch
      setSuggestions([]);
      return;
    }
    const seq = ++requestSeq.current;
    const handle = setTimeout(() => {
      listTaskSuggestions(q)
        .then((tasks) => {
          if (seq === requestSeq.current) setSuggestions(tasks);
        })
        .catch(() => {
          if (seq === requestSeq.current) setSuggestions([]);
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [value]);

  const pick = (task: Task) => {
    onSelect(task);
    setOpen(false);
  };

  return (
    <Popover open={open && suggestions.length > 0} onOpenChange={setOpen}>
      {/* Anchor (not Trigger): the input keeps its native click/focus/typing
          behaviour; the dropdown is opened purely from focus + typing below.
          A Trigger would hijack the input's click to toggle the popover. */}
      <PopoverAnchor asChild>
        <FormControl>
          <Input
            disabled={disabled}
            placeholder="What needs to get done?"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            autoComplete="off"
          />
        </FormControl>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        // Keep typing in the input — never steal focus into the list, and don't
        // bounce focus around when it closes.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        {/* Server already filtered + ordered by recency; disable cmdk's fuzzy
            filtering/sorting so the list renders exactly as returned. */}
        <Command shouldFilter={false}>
          <CommandList>
            <CommandEmpty>No matching tasks.</CommandEmpty>
            <CommandGroup heading="Your tasks">
              {suggestions.map((task) => (
                <CommandItem
                  key={task.id}
                  value={task.id}
                  onSelect={() => pick(task)}
                  className="flex-col items-start gap-0.5"
                >
                  <span className="truncate text-xs font-medium">
                    {task.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {[
                      durationLabel(task.durationMinutes),
                      task.manuallyMoved ? "Pinned" : null,
                      ...task.tags.slice(0, 2).map((t) => `#${t}`),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
