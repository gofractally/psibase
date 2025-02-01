import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import alias from "@rollup/plugin-alias";

const psibase = () => {
  return [
    {
      name: "psibase",
      config: () => {
        return {
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
  plugins: [react(), psibase()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    minify: false,
  },
}));
