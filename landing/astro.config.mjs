import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || "https://usezenflow.com",
  integrations: [react()],
  // Vietnamese moved from /vi/ to /.
  redirects: { "/vi": "/" },
  build: { inlineStylesheets: "always" },
  vite: {
    plugins: [tailwindcss()],
    // The hoisted linker puts older copies of these at the repo root; bundle Astro's own.
    environments: {
      prerender: { resolve: { noExternal: ["cookie", "html-escaper", "picomatch"] } },
    },
  },
});
