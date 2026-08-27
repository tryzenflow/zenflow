import { getData, postData } from "@/api";
import type { Session } from "@/types/tasks";
import { extractFileIdsFromNoteContent } from "./files";
import { removeSession } from "@/api/tasks";
import type { RemoveSessionResponse } from "@zenflow/shared";

// The session validation schema (`sessionSchema`/`SessionFormValues`/
// `EditSessionFormValues`/`MAX_TITLE_LENGTH`) and `placementQualifier` now
// live in `@zenflow/core`'s `tasks.ts` — hoisted there for the RN migration
// (issue #20) so `frontend/` and `mobile/` share one source of truth (CLAUDE.md
// §1: the shared package is the contract). Import them from `@zenflow/core`
// directly; this module only keeps the one thing that's genuinely
// frontend-specific: cleaning up a deleted task's note attachments.
export {
  MAX_TITLE_LENGTH,
  placementQualifier,
  sessionSchema,
  type EditSessionFormValues,
  type PlacementQualifier,
  type SessionFormValues,
} from "@zenflow/core";

/** Delete a task, cleaning up any note attachments it referenced. */
export async function deleteSession(
  taskId: string,
): Promise<RemoveSessionResponse> {
  const { data } = await getData<{ data: Session }>(`/sessions/${taskId}`);
  const previousIds = extractFileIdsFromNoteContent(data.note || "");
  if (previousIds.length > 0) {
    await postData("/files/remove", { ids: previousIds });
  }
  return removeSession(taskId);
}
