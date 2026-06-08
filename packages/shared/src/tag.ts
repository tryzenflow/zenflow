/** A per-user label that can be attached to many tasks (m2m with Task). */
export interface Tag {
  id: string;
  name: string;
}

/** Response payload for GET /tags — the user's existing tags, name-sorted. */
export interface TagsListResponse {
  tags: Tag[];
}
