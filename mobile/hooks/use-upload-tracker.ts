import { removeFiles } from "@/api/files";
import { droppedUploads } from "@/lib/files-tracker";
import { useCallback, useEffect, useRef } from "react";

/**
 * Files uploaded while a task form is open. They only belong to the task once
 * it is saved, so: on a successful save `settle` deletes the ones the final
 * note dropped (delete, re-add, delete included: only the final note counts),
 * and leaving the form without saving deletes all of them. Files that were
 * already in the note are never tracked here; the API releases those when a
 * save drops them.
 */
export function useUploadTracker() {
  const uploaded = useRef<string[]>([]);
  const saved = useRef(false);

  const track = useCallback((ids: string[]) => {
    uploaded.current = [...new Set([...uploaded.current, ...ids])];
  }, []);

  const settle = useCallback(async (finalNote: string | null | undefined) => {
    saved.current = true;
    const dropped = droppedUploads(uploaded.current, finalNote);
    uploaded.current = [];
    if (dropped.length > 0) await removeFiles(dropped).catch(() => {});
  }, []);

  useEffect(
    () => () => {
      if (saved.current || uploaded.current.length === 0) return;
      void removeFiles(uploaded.current).catch(() => {});
    },
    [],
  );

  return { track, settle };
}
