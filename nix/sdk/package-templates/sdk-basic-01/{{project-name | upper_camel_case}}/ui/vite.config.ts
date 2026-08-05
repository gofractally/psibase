import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Standalone UI for out-of-tree SDK apps. At runtime on a booted chain,
// @psibase/common-lib is served from /common/common-lib.js (Sites/CommonApi).
export default defineConfig({
  plugins: [react()],
  build: {
    minify: true,
    sourcemap: false,
    rollupOptions: {
      external: ["@psibase/common-lib"],
      output: {
        paths: {
          "@psibase/common-lib": "/common/common-lib.js",
        },
      },
    },
  },
});
