import { Node } from "@tiptap/core";

export const Audio = Node.create({
  name: "audio",
  inline: false,
  group: "block",
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      controls: {
        default: true,
      },
      style: {
        default: "max-width: 100%;",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "audio",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["audio", HTMLAttributes];
  },
});
