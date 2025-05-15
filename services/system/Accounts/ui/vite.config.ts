import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import type { IncomingMessage } from "http";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: "psibase",
      config: () => ({
        build: {
          assetsDir: "",
          cssCodeSplit: false,
          rollupOptions: {
            external: ["/common/rootdomain.mjs", "/common/common-lib.js"],
            makeAbsoluteExternalsRelative: false,
            output: {
              entryFileNames: "index.js",
              assetFileNames: "[name][extname]",
            },
          },
        },
        server: {
          host: "psibase.127.0.0.1.sslip.io",
          port: 8081,
          proxy: {
            "/": {
              target: "http://psibase.127.0.0.1.sslip.io:8079/",
              bypass: (req: IncomingMessage) => {
                const host = req.headers.host || "";
                const subdomain = host.split(".")[0];
                if (
                  subdomain === "psibase" &&
                  req.method !== "POST" &&
                  req.headers.accept !== "application/json" &&
                  !req.url?.startsWith("/common") &&
                  !req.url?.startsWith("/api")
                ) {
                  return req.url;
                }
              },
            },
          },
        },
        resolve: {
          alias: [
            {
              find: "@",
              replacement: path.resolve(__dirname, "./src"),
            },
          ],
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
