import { type Tag, type Task } from "../../../generated/prisma";
export type TaskWithTags = Task & { tags: Tag[] };
