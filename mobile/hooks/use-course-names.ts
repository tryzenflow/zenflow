import { listTags } from "@/api/tags";
import { useEffect, useState } from "react";

/**
 * The user's tag names, which the composer offers as courses. Loads once per
 * mount; a failed load leaves the list empty rather than blocking the form.
 */
export function useCourseNames(): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    listTags()
      .then((tags) => {
        if (live) setNames(tags.map((tag) => tag.name));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return names;
}
