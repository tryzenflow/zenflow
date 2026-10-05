/** A per-user label that can be attached to many tasks (m2m with Session). */
export interface Tag {
  id: string;
  name: string;
}

/** Response payload for GET /tags — the user's existing tags, name-sorted. */
export interface TagsListResponse {
  tags: Tag[];
}

/** Body of POST /tags/bulk. */
export interface BulkCreateTagsInput {
  /** 1..{@link BULK_TAGS_MAX} names; trimmed, deduped, existing ones skipped. */
  names: string[];
}

export const BULK_TAGS_MAX = 50;
export const TAG_NAME_MAX = 50;

/** Response of POST /tags/bulk — every requested tag (new + pre-existing), name-sorted. */
export interface BulkCreateTagsResponse {
  tags: Tag[];
}
