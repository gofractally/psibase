import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import alias from "@rollup/plugin-alias";
// import svgr from "vite-plugin-svgr";

// ../../../user/CommonApi/common/packages/common-lib

const psibase = (appletContract: string, isServing?: boolean) => {
  const buildAliases = [
    {
      find: "@",
      replacement: path.resolve(__dirname, "./src"),
    },
  ];

  if (isServing) {
    buildAliases.push({
      // @ts-expect-error fjweiojfiew
      find: /^@psibase\/common-lib.*$/,
      replacement: path.resolve(
        "../../../user/CommonApi/common/packages/common-lib/src"
      ),
    });
  }

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
                target: "http://psibase.127.0.0.1.sslip.io:8080/",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                bypass: (req: any) => {
                  const host = req.headers.host || "";
                  const subdomain = host.split(".")[0];
                  if (
                    subdomain === appletContract &&
                    req.method !== "POST" &&
                    req.headers.accept !== "application/json" &&
                    !req.url.startsWith("/common") &&
                    !req.url.startsWith("/api")
                  ) {
                    return req.url;
                  }
                },
              },
            },
          },
          resolve: {
            alias: buildAliases,
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
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    // svgr({ exportAsDefault: true }),
    psibase("auth-sig", command === "serve"),
  ],
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
