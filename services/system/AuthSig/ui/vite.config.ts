import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: "psibase",
      config: () => ({
        build: {
          assetsDir: "",
          rollupOptions: {
            external: ["/common/rootdomain.mjs", "/common/common-lib.js"],
            makeAbsoluteExternalsRelative: false,
            output: {
              entryFileNames: "index.js",
              assetFileNames: "[name][extname]",
            },
          },
        },
      }),
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@psibase/common-lib": "/common/common-lib.js",
    },
  },
  build: {
    minify: false,
  },
});
