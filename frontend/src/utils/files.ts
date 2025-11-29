export function extractFileIdsFromNoteContent(content: string): string[] {
  // find all links, images and videos links that starts with VITE_API_URL/files/<fileId>
  const fileIds: string[] = [];
  const regex = new RegExp(
    `${import.meta.env.VITE_API_URL}/files/([a-zA-Z0-9-_]+)`,
    "g"
  );
  let match;
  while ((match = regex.exec(content)) !== null) {
    fileIds.push(match[1]);
  }
  return fileIds;
}
