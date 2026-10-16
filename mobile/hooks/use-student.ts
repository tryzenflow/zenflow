import { getStudent } from "@/api/student";
import type { StudentProfileDto } from "@zenflow/shared";
import { useEffect, useState } from "react";

/** How often to look again while the profile is still being fetched. */
const POLL_MS = 8_000;
const MAX_POLLS = 8;

/**
 * The DLU student profile. It arrives from a background job after the student
 * connects the portal, so while it is missing this checks a few more times and
 * then stops. `enabled` is false when no portal is connected.
 */
export function useStudent(enabled: boolean): StudentProfileDto | null {
  const [profile, setProfile] = useState<StudentProfileDto | null>(null);

  useEffect(() => {
    if (!enabled) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const { profile: next } = await getStudent();
        if (cancelled) return;
        setProfile(next);
        // Marks land a moment after the profile; keep looking until they do.
        const settled = next !== null && next.marksFetchedAt !== null;
        if (!settled && polls < MAX_POLLS) {
          polls += 1;
          timer = setTimeout(load, POLL_MS);
        }
      } catch {
        // Offline or signed out: the card simply stays hidden.
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return profile;
}
