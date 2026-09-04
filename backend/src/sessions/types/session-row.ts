import type { Prisma } from "../../../generated/prisma";

/** A `Session` row with its tags and (nullable) parent series — the shape every
 * sessions service method loads and maps to the wire response. */
export type SessionRow = Prisma.SessionGetPayload<{
  include: { tags: true; series: true };
}>;

/** The Prisma `include` that produces a {@link SessionRow}. */
export const WITH_TAGS_AND_SERIES = { tags: true, series: true } as const;
