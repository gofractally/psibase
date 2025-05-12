import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { createSharedViteConfig, verifyViteCache } from "../../../../../../vite.shared";

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

// NOTE: This bundles common-lib. This is easier for experiemental dev apps like this.
// Normally, an app would reference common-lib as an external resource.
export default defineConfig({
  base: "/common/plugin-tester/",
  plugins: [
    react(),
    createSharedViteConfig({
      projectDir: serviceDir,
      manualChunks: {},
    }),
  ],
  resolve: {
    alias: [
      {
        find: /^@psibase\/common-lib.*$/,
        replacement: path.resolve("../../common-lib/src"),
      },
    ],
  },
  build: {
    sourcemap: true,
    minify: false,
  },
});
