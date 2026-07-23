import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";

/**
 * Base64 `data:` URI for the Geist Regular font file, for embedding as a
 * `@font-face` inside `@10play/tentap-editor`'s `RichText` WebView.
 *
 * The editor renders into a real, separate HTML document (bundled with the
 * library, see `description-field.tsx`'s doc comment) that has no access to
 * the `.ttf` files `app/_layout.tsx` registers with `expo-font` for native
 * `<Text>` rendering — those are only visible to RN's own text renderer, not
 * a WebView's CSS engine. Embedding the font bytes directly as a `data:` URI
 * inside the injected stylesheet is the only way to get the WebView's own
 * document to use it, since it can't reach into the app bundle's asset
 * resolver the way the native side can.
 *
 * Only the Regular weight is loaded — the editor's own marks (`strong`,
 * `<b>`, …) can fall back to the WebView's normal CSS `font-weight: bold`
 * faux-bold synthesis, which (unlike RN's native text renderer) a real
 * browser engine handles natively, so a full weight family isn't needed just
 * to make Bold/Italic marks legible.
 */
let geistFontDataUriPromise: Promise<string> | null = null;

export function loadGeistWebviewFontDataUri(): Promise<string> {
  if (!geistFontDataUriPromise) {
    geistFontDataUriPromise = (async () => {
      const asset = Asset.fromModule(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("../assets/fonts/Geist-Regular.ttf"),
      );
      await asset.downloadAsync();
      if (!asset.localUri) {
        throw new Error(
          "Geist-Regular.ttf asset has no localUri after downloadAsync()",
        );
      }
      const base64 = await FileSystem.readAsStringAsync(asset.localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return `data:font/ttf;base64,${base64}`;
    })().catch((err) => {
      // Reset so a later mount can retry instead of caching a rejected
      // promise forever (e.g. a transient asset-download failure).
      geistFontDataUriPromise = null;
      throw err;
    });
  }
  return geistFontDataUriPromise;
}
