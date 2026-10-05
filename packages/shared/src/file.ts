/** Metadata of an uploaded file (upload + `GET /files/metadata/:id` responses). */
export interface FileMetadata {
  id: string;
  originalName: string;
  mimetype: string;
  size: number;
  /**
   * Signed, non-expiring, session-less URL for the file content, relative to the
   * API origin: `/api/v1/files/<id>?sig=<hmac>`. Safe to store in a note and use
   * as an `<img src>` in a WebView. Possession of the link grants read access.
   */
  url: string;
}
