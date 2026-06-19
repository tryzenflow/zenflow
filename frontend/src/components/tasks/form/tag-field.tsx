import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { X, Tag, Check, Plus } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { listTags } from "@/api/tags";
import { cn } from "@/lib/utils";
import { FormDescription } from "@/components/ui/form";

/**
 * Combobox tag editor backed by a `string[]` field of tag NAMES.
 *
 * Existing tags are fetched from `GET /tags` and offered in a searchable list;
 * typing a name that matches none of them surfaces a "Create …" option that
 * adds the name as a *pending* tag (no API call — the backend upserts unknown
 * names on save). Pending tags are a UI-only distinction (dashed chip + "new"
 * hint); the form value is just the flat list of names.
 */
export function TagsField({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [existing, setExisting] = useState<string[]>([]);

  useEffect(() => {
    listTags()
      .then((tags) => setExisting(tags.map((t) => t.name)))
      .catch(() => setExisting([]));
  }, []);

  const trimmed = query.trim();
  // Existing tags shown in the list: not already selected (cmdk filters by text).
  const options = useMemo(() => {
    const selected = new Set(value);
    return existing.filter((name) => !selected.has(name));
  }, [existing, value]);
  // Offer "Create" when the typed text is non-empty, not already selected, and
  // not an exact (case-insensitive) match of an existing tag.
  const canCreate =
    !!trimmed &&
    !value.some((t) => t.toLowerCase() === trimmed.toLowerCase()) &&
    !existing.some((t) => t.toLowerCase() === trimmed.toLowerCase());

  const add = (name: string) => {
    const clean = name.trim();
    if (!clean || value.some((t) => t.toLowerCase() === clean.toLowerCase()))
      return;
    onChange([...value, clean]);
    setQuery("");
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => {
            const isPending = !existing.includes(tag);
            return (
              <span
                key={tag}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                  isPending
                    ? "border-dashed border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground",
                )}
                title={isPending ? "New tag — created on save" : undefined}
              >
                #{tag}
                {isPending && (
                  <span className="text-[8px] font-bold uppercase tracking-wide opacity-70">
                    new
                  </span>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => remove(tag)}
                  className="transition-colors hover:text-foreground"
                  aria-label={`Remove ${tag}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-transparent px-3 text-sm text-muted-foreground transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Tag className="size-3.5 shrink-0" />
            Add tag…
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
        >
          <Command>
            <CommandInput
              placeholder="Search or create…"
              value={query}
              onValueChange={setQuery}
              className="h-9"
            />
            <CommandList>
              {!canCreate && <CommandEmpty>No tags found.</CommandEmpty>}
              {options.length > 0 && (
                <CommandGroup heading="Existing">
                  {options.map((name) => (
                    <CommandItem
                      key={name}
                      value={name}
                      onSelect={() => add(name)}
                    >
                      #{name}
                      <Check className="ml-auto opacity-0" />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {canCreate && (
                <CommandGroup heading="Create">
                  <CommandItem
                    value={`__create__${trimmed}`}
                    onSelect={() => add(trimmed)}
                  >
                    <Plus className="size-4" />
                    Create "{trimmed}"
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <FormDescription className="text-xs text-muted-foreground">
        Tags help our system learn your preferences and personalize your
        schedule in the future.
      </FormDescription>
    </div>
  );
}
