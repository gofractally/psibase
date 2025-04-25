import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// NOTE: This bundles common-lib. This is easier for experiemental dev apps like this.
// Normally, an app would reference common-lib as an external resource.
export default defineConfig({
  base: "/common/plugin-tester/",
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@psibase\/common-lib.*$/,
        replacement: path.resolve("../../common-lib/src"),
      },
    ],
  },
  build: {
        // Enable build cache in a project-specific directory
        cacheDir: path.resolve(__dirname, ".vite-cache"),
        // Enable sourcemap for better caching
        sourcemap: true,
    minify: false,
  },
});
