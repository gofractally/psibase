import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import alias from "@rollup/plugin-alias";
// import svgr from "vite-plugin-svgr";

const psibase = (appletContract: string, isServing?: boolean) => {
  const buildAliases = [
    {
      find: "@",
      replacement: path.resolve("./src"),
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
export default defineConfig(({ command }: { command: 'serve' | 'build' }) => ({
  plugins: [
    react(),
    // svgr({ exportAsDefault: true }),
    psibase("psibase", command === "serve"),
  ],
  resolve: {
    alias: {
      "@": path.resolve("./src"),
    },
  },
  build: {
    minify: false,
  },
}));
