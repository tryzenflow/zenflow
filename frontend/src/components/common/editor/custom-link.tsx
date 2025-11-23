import Link from "@tiptap/extension-link";
export const CustomLink = Link.extend({
  name: "customLink",

  addAttributes() {
    return {
      ...this.parent?.(),
      href: {
        default: null,
      },
      fileName: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-filename"),
        renderHTML: (attributes) => {
          if (attributes.fileName) {
            return { "data-filename": attributes.fileName };
          }
          return {};
        },
      },
      fileSize: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-filesize"),
        renderHTML: (attributes) => {
          if (attributes.fileSize) {
            return { "data-filesize": attributes.fileSize };
          }
          return {};
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[href]",
        getAttrs: (dom) => {
          const href = (dom as HTMLElement).getAttribute("href");
          if (href?.startsWith(`${import.meta.env.VITE_API_URL}/files/`)) {
            return { href };
          }
          return false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const href = HTMLAttributes.href || "";
    console.log({ href });

    if (href.startsWith(`${import.meta.env.VITE_API_URL}/files/`)) {
      return [
        "a",
        HTMLAttributes,
        [
          "div",
          {
            class:
              "border rounded-lg p-4 shadow-sm bg-card text-card-foreground my-2",
          },
          [
            "div",
            { class: "flex items-center gap-3" },
            [
              "div",
              { class: "flex-1" },
              [
                "p",
                { class: "font-medium" },
                HTMLAttributes.fileName || "File",
              ],
              HTMLAttributes.fileSize
                ? [
                    "p",
                    { class: "text-sm text-muted-foreground" },
                    HTMLAttributes.fileSize,
                  ]
                : "",
            ],
          ],
        ],
      ];
    }

    return ["a", HTMLAttributes, 0];
  },
});
