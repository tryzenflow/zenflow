import { BridgeExtension } from "@10play/tentap-editor";
import { Node, mergeAttributes } from "@tiptap/core";

/**
 * `<video>`/`<audio>` node types for the note editor's WebView schema.
 * `@10play/tentap-editor` ships an `ImageBridge` (wraps `@tiptap/extension-
 * image`) but no audio/video equivalent — without one, the schema has no
 * node type for these tags, so `fileEmbedMarkup`'s `<video>`/`<audio>` HTML
 * (see `description-field.tsx`) silently gets dropped by ProseMirror's HTML
 * parser on `editor.setContent(...)`, the same "nothing renders" failure
 * images had before `ImageBridge` was added.
 *
 * These mirror `frontend/src/components/common/editor/video-block.tsx` /
 * `audio-block.tsx` (same minimal parse/render shape) rather than
 * reinventing one. No bridge messaging is wired up — unlike `LinkBridge`/
 * `ImageBridge`, nothing here is ever inserted via an RN-invoked command,
 * only as raw HTML through `editor.setContent()`, so a bare `tiptapExtension`
 * is enough for the WebView's schema to recognize and render the tag (see
 * `DropCursorBridge` in the library itself for the same minimal shape).
 */
const Video = Node.create({
  name: "video",
  inline: false,
  group: "block",
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      controls: { default: true },
      style: { default: "max-width: 100%;" },
    };
  },
  parseHTML() {
    return [{ tag: "video" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["video", mergeAttributes(HTMLAttributes)];
  },
});

const Audio = Node.create({
  name: "audio",
  inline: false,
  group: "block",
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      controls: { default: true },
      style: { default: "max-width: 100%;" },
    };
  },
  parseHTML() {
    return [{ tag: "audio" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["audio", mergeAttributes(HTMLAttributes)];
  },
});

export const VideoBridge = new BridgeExtension({
  tiptapExtension: Video,
  extendCSS: `video { max-width: 100%; height: auto; border-radius: 8px; }`,
});

export const AudioBridge = new BridgeExtension({
  tiptapExtension: Audio,
  extendCSS: `audio { max-width: 100%; }`,
});
