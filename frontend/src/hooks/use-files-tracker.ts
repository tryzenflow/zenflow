import { useRef } from "react";
import { extractFileIdsFromNoteContent } from "../utils/files";

export function useFilesTracker() {
  const newUploadsRef = useRef<string[]>([]);
  const removedFileIds = useRef<string[]>([]);

  function updateRemovedFileIds(
    currentContent: string,
    previousContent: string
  ) {
    const initialIds = extractFileIdsFromNoteContent(previousContent);
    const currentIds = extractFileIdsFromNoteContent(currentContent);
    removedFileIds.current = Array.from(
      new Set(
        [...initialIds, ...newUploadsRef.current].filter(
          (id) => !currentIds.includes(id)
        )
      )
    );
  }
  return { newUploadsRef, removedFileIds, updateRemovedFileIds };
}
