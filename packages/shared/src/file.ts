/** Metadata of an uploaded file (upload + `GET /files/metadata/:id` responses). */
export interface FileMetadata {
  id: string;
  originalName: string;
  mimetype: string;
  size: number;
  /**
   * Signed, non-expiring, session-less URL for the file content, relative to the
   * API origin: `/api/v1/files/<id>?sig=<hmac>`. Use it as an `<img src>` in a WebView.
   * Possession of the link grants read access. Do not rely on it being stored: the
   * API strips the `sig` from notes on save and re-adds it on read.
   */
  url: string;
}
