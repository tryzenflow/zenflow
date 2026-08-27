import { type Tag, type Session } from "../../../generated/prisma";
export type SessionWithTags = Session & { tags: Tag[] };
