import Link from "@tiptap/extension-link";

export const CustomLink = Link.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      fileBaseUrl: import.meta.env.VITE_API_URL,
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),

      fetchFileMetadata:
        (href: string) =>
        // @ts-ignore
        async ({ commands }) => {
          // @ts-ignore
          const base = this.options.fileBaseUrl;

          if (!href.startsWith(`${base}/files/`)) return;

          // 1️⃣ Extract ID
          const id = href.split("/files/")[1];

          try {
            // 2️⃣ Fetch metadata
            const res = await fetch(`${base}/files/metadata/${id}`);
            const json = await res.json();
            const data = json.data;

            // 3️⃣ Store result in node attributes
            commands.updateAttributes("customLink", {
              fileName: data.originalName,
              fileSize: data.size,
              isFile: true,
            });
          } catch (err) {
            console.error("Failed to fetch file metadata", err);
          }
        },
    };
  },
});
