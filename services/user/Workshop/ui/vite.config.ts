import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import alias from "@rollup/plugin-alias";
import { createSkipUnchangedBuildPlugin } from '../../../vite.shared'

const psibase = () => {
  return [
    {
      name: "psibase",
      config: () => {
        return {
          build: {
        // Enable build cache in a project-specific directory
        cacheDir: path.resolve(__dirname, ".vite-cache"),
        // Enable sourcemap for better caching
        sourcemap: true,
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
        };
      },
    },
    alias({
      entries: [
        {
          find: /^@psibase\/common-lib.*$/,
          replacement: "/common/common-lib.js",
        },
      ],
    }),
  ];
};

// https://vitejs.dev/config/
export default defineConfig(() => ({
  plugins: [react(), psibase(),, createSkipUnchangedBuildPlugin(__dirname)],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
        // Enable build cache in a project-specific directory
        cacheDir: path.resolve(__dirname, ".vite-cache"),
        // Enable sourcemap for better caching
        sourcemap: true,
    minify: false,
  },
}));
