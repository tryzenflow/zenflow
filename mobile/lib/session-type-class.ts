import { SESSION_TYPE_META } from "@zenflow/core";
import type { SessionType } from "@zenflow/shared";

/**
 * Text/icon colour class for a session type. Same as the shared meta, except a
 * TASK uses the accessible orange (`text-primary-text`): the plain brand orange
 * is 2.2:1 on light surfaces.
 */
export function sessionTypeTextClass(type: SessionType): string {
  return type === "TASK" ? "text-primary-text" : SESSION_TYPE_META[type].textClass;
}
