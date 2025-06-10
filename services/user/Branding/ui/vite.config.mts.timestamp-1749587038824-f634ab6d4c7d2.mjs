// vite.config.mts
import tailwindcss from "file:///root/psibase/services/.yarn/__virtual__/@tailwindcss-vite-virtual-5694b4a304/2/.caches/yarn/@tailwindcss-vite-npm-4.1.8-954ab0fbf4-334384b196.zip/node_modules/@tailwindcss/vite/dist/index.mjs";
import react from "file:///root/psibase/services/.yarn/__virtual__/@vitejs-plugin-react-virtual-7154c4841c/2/.caches/yarn/@vitejs-plugin-react-npm-4.4.1-461fc91f96-0eda45f202.zip/node_modules/@vitejs/plugin-react/dist/index.mjs";
import path2 from "path";
import { defineConfig } from "file:///root/psibase/services/.yarn/__virtual__/vite-virtual-b4aa46986a/2/.caches/yarn/vite-npm-5.4.19-6d369030b0-c97601234d.zip/node_modules/vite/dist/node/index.js";
import topLevelAwait from "file:///root/psibase/services/.yarn/__virtual__/vite-plugin-top-level-await-virtual-cabe692524/2/.caches/yarn/vite-plugin-top-level-await-npm-1.5.0-8b8b88dc80-e582091e9c.zip/node_modules/vite-plugin-top-level-await/exports/import.mjs";
import wasm from "file:///root/psibase/services/.yarn/__virtual__/vite-plugin-wasm-virtual-520cda6b03/2/.caches/yarn/vite-plugin-wasm-npm-3.4.1-d51897dbd7-274bbe7bb1.zip/node_modules/vite-plugin-wasm/exports/import.mjs";
import tsconfigPaths from "file:///root/psibase/services/.yarn/__virtual__/vite-tsconfig-paths-virtual-16ae8b9238/2/.caches/yarn/vite-tsconfig-paths-npm-4.3.2-96d4ddd73d-f390ac1d1c.zip/node_modules/vite-tsconfig-paths/dist/index.mjs";

// ../../../vite.shared.ts
import path from "path";
import fs from "fs";
var __vite_injected_original_dirname = "/root/psibase/services";
var outDirParams = {
  outDir: "dist",
  emptyOutDir: true
};
function createSharedViteConfig(options) {
  const { uiFramework = "react", manualChunks = {
    vendor: ["react", "react-dom"]
  }, additionalManualChunks = {} } = options;
  const rollupOptions = {
    cache: true,
    ...uiFramework === "svelte" ? outDirParams : {},
    output: {
      entryFileNames: "index.js",
      assetFileNames: "[name][extname]",
      dir: "dist",
      ...Object.keys(manualChunks).length > 0 ? {
        manualChunks: {
          // Core UI libraries
          ...manualChunks,
          ...additionalManualChunks
        }
      } : {}
    }
  };
  const userConfig = {
    build: {
      // Disable sourcemaps in production for better caching
      sourcemap: process.env.NODE_ENV === "development",
      minify: process.env.NODE_ENV !== "development",
      rollupOptions,
      // Increase chunk size warning limit
      chunkSizeWarningLimit: 1e3
    },
    optimizeDeps: {
      // Enable dependency pre-bundling
      // TODO: this isn't right; what about manualChunks other than vendor?
      include: uiFramework === "react" ? manualChunks.vendor || [] : []
    }
  };
  return uiFramework === "svelte" ? {
    name: "shared-vite-config",
    ...userConfig
  } : {
    name: "shared-vite-config",
    config: () => ({
      ...userConfig
    })
  };
}
function verifyViteCache(dirname) {
  const cacheDir = path.resolve(dirname, ".vite-cache");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
}
var servicesDir = path.resolve(__vite_injected_original_dirname);
function createPsibaseConfig(options) {
  const {
    uiFramework = "react",
    service,
    serviceDir: serviceDir2,
    isServing = false,
    useHttps = false,
    proxyPort = 8080,
    additionalAliases = [],
    additionalProxyBypassConditions = [],
    additionalProxies = []
  } = options;
  const buildAliases = [
    {
      find: "@",
      replacement: path.resolve(serviceDir2, "./src")
    },
    {
      find: /^\/common(?!\/(?:fonts))(.*)$/,
      replacement: path.resolve(`${servicesDir}/user/CommonApi/common/resources$1`)
    },
    {
      find: /^@psibase\/common-lib.*$/,
      replacement: "/common/common-lib.js"
    },
    ...additionalAliases
  ];
  if (isServing) {
    buildAliases.push({
      find: /^@psibase\/common-lib.*$/,
      replacement: path.resolve(
        `${servicesDir}/user/CommonApi/common/packages/common-lib/src`
      )
    });
  }
  const baseServerConfig = {
    host: `${service}.psibase.127.0.0.1.sslip.io`,
    port: 8081,
    proxy: {
      ...additionalProxies,
      "/": {
        target: `${useHttps ? "https" : "http"}://psibase.127.0.0.1.sslip.io:${proxyPort}/`,
        changeOrigin: true,
        secure: !useHttps,
        autoRewrite: true,
        timeout: 1e4,
        bypass: (req, _res, _opt) => {
          const host = req.headers.host || "";
          const subdomain = host.split(".")[0];
          const baseConditions = [
            subdomain === service,
            req.method !== "POST",
            req.headers.accept !== "application/json",
            !req.url.startsWith("/common"),
            !req.url.startsWith("/api")
          ];
          return req.url === "/" || [...baseConditions, ...additionalProxyBypassConditions].every(
            (condition) => typeof condition === "function" ? condition(req) : condition
          ) ? req.url : void 0;
        }
      }
    }
  };
  if (useHttps) {
    baseServerConfig.https = {
      key: fs.readFileSync(
        `${process.env.VITE_SECURE_PATH_TO_CERTS}psibase.127.0.0.1.sslip.io+1-key.pem`,
        "utf8"
      ),
      cert: fs.readFileSync(
        `${process.env.VITE_SECURE_PATH_TO_CERTS}psibase.127.0.0.1.sslip.io+1.pem`,
        "utf8"
      )
    };
  }
  return {
    name: "psibase",
    config: () => ({
      build: {
        ...uiFramework !== "svelte" ? outDirParams : {},
        assetsDir: "",
        cssCodeSplit: false,
        rollupOptions: {
          external: [
            "/common/rootdomain.mjs",
            "/common/common-lib.js"
          ],
          makeAbsoluteExternalsRelative: false
        }
      },
      server: baseServerConfig,
      resolve: {
        alias: buildAliases
      }
    })
  };
}

// vite.config.mts
var __vite_injected_original_dirname2 = "/root/psibase/services/user/Branding/ui";
var serviceDir = path2.resolve(__vite_injected_original_dirname2);
verifyViteCache(serviceDir);
var vite_config_default = defineConfig(({ command }) => {
  return {
    plugins: [
      react(),
      createSharedViteConfig({
        projectDir: serviceDir,
        additionalManualChunks: {
          // Radix UI components
          "radix-ui": [
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-avatar",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-label",
            "@radix-ui/react-slot"
          ],
          // Animation libraries
          animation: ["framer-motion"],
          // UI utilities
          "ui-utils": [
            "class-variance-authority",
            "clsx",
            "tailwind-merge",
            "lucide-react"
          ]
        }
      }),
      createPsibaseConfig({
        service: "branding",
        serviceDir,
        isServing: command === "serve",
        useHttps: process.env.VITE_SECURE_LOCAL_DEV === "true"
      }),
      wasm(),
      topLevelAwait(),
      tsconfigPaths(),
      tailwindcss()
    ],
    build: {
      minify: false,
      sourcemap: false
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcubXRzIiwgIi4uLy4uLy4uL3ZpdGUuc2hhcmVkLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiL3Jvb3QvcHNpYmFzZS9zZXJ2aWNlcy91c2VyL0JyYW5kaW5nL3VpXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvcm9vdC9wc2liYXNlL3NlcnZpY2VzL3VzZXIvQnJhbmRpbmcvdWkvdml0ZS5jb25maWcubXRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9yb290L3BzaWJhc2Uvc2VydmljZXMvdXNlci9CcmFuZGluZy91aS92aXRlLmNvbmZpZy5tdHNcIjtpbXBvcnQgdGFpbHdpbmRjc3MgZnJvbSBcIkB0YWlsd2luZGNzcy92aXRlXCI7XG5pbXBvcnQgcmVhY3QgZnJvbSBcIkB2aXRlanMvcGx1Z2luLXJlYWN0XCI7XG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcbmltcG9ydCB0b3BMZXZlbEF3YWl0IGZyb20gXCJ2aXRlLXBsdWdpbi10b3AtbGV2ZWwtYXdhaXRcIjtcbmltcG9ydCB3YXNtIGZyb20gXCJ2aXRlLXBsdWdpbi13YXNtXCI7XG5pbXBvcnQgdHNjb25maWdQYXRocyBmcm9tIFwidml0ZS10c2NvbmZpZy1wYXRoc1wiO1xuXG5pbXBvcnQge1xuICAgIGNyZWF0ZVBzaWJhc2VDb25maWcsXG4gICAgY3JlYXRlU2hhcmVkVml0ZUNvbmZpZyxcbiAgICB2ZXJpZnlWaXRlQ2FjaGUsXG59IGZyb20gXCIuLi8uLi8uLi92aXRlLnNoYXJlZFwiO1xuXG5jb25zdCBzZXJ2aWNlRGlyID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSk7XG5cbnZlcmlmeVZpdGVDYWNoZShzZXJ2aWNlRGlyKTtcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoeyBjb21tYW5kIH0pID0+IHtcbiAgICByZXR1cm4ge1xuICAgICAgICBwbHVnaW5zOiBbXG4gICAgICAgICAgICByZWFjdCgpLFxuICAgICAgICAgICAgY3JlYXRlU2hhcmVkVml0ZUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgcHJvamVjdERpcjogc2VydmljZURpcixcbiAgICAgICAgICAgICAgICBhZGRpdGlvbmFsTWFudWFsQ2h1bmtzOiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFJhZGl4IFVJIGNvbXBvbmVudHNcbiAgICAgICAgICAgICAgICAgICAgXCJyYWRpeC11aVwiOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICBcIkByYWRpeC11aS9yZWFjdC1hbGVydC1kaWFsb2dcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIFwiQHJhZGl4LXVpL3JlYWN0LWF2YXRhclwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgXCJAcmFkaXgtdWkvcmVhY3QtZHJvcGRvd24tbWVudVwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgXCJAcmFkaXgtdWkvcmVhY3QtbGFiZWxcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIFwiQHJhZGl4LXVpL3JlYWN0LXNsb3RcIixcbiAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgLy8gQW5pbWF0aW9uIGxpYnJhcmllc1xuICAgICAgICAgICAgICAgICAgICBhbmltYXRpb246IFtcImZyYW1lci1tb3Rpb25cIl0sXG4gICAgICAgICAgICAgICAgICAgIC8vIFVJIHV0aWxpdGllc1xuICAgICAgICAgICAgICAgICAgICBcInVpLXV0aWxzXCI6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgIFwiY2xhc3MtdmFyaWFuY2UtYXV0aG9yaXR5XCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBcImNsc3hcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIFwidGFpbHdpbmQtbWVyZ2VcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIFwibHVjaWRlLXJlYWN0XCIsXG4gICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgY3JlYXRlUHNpYmFzZUNvbmZpZyh7XG4gICAgICAgICAgICAgICAgc2VydmljZTogXCJicmFuZGluZ1wiLFxuICAgICAgICAgICAgICAgIHNlcnZpY2VEaXIsXG4gICAgICAgICAgICAgICAgaXNTZXJ2aW5nOiBjb21tYW5kID09PSBcInNlcnZlXCIsXG4gICAgICAgICAgICAgICAgdXNlSHR0cHM6IHByb2Nlc3MuZW52LlZJVEVfU0VDVVJFX0xPQ0FMX0RFViA9PT0gXCJ0cnVlXCIsXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIHdhc20oKSxcbiAgICAgICAgICAgIHRvcExldmVsQXdhaXQoKSxcbiAgICAgICAgICAgIHRzY29uZmlnUGF0aHMoKSxcbiAgICAgICAgICAgIHRhaWx3aW5kY3NzKCksXG4gICAgICAgIF0sXG4gICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgICBtaW5pZnk6IGZhbHNlLFxuICAgICAgICAgICAgc291cmNlbWFwOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICB9O1xufSk7XG4iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9yb290L3BzaWJhc2Uvc2VydmljZXNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9yb290L3BzaWJhc2Uvc2VydmljZXMvdml0ZS5zaGFyZWQudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3Jvb3QvcHNpYmFzZS9zZXJ2aWNlcy92aXRlLnNoYXJlZC50c1wiOy8vLyA8cmVmZXJlbmNlIHR5cGVzPVwibm9kZVwiIC8+XG5cbmltcG9ydCB7IFBsdWdpbiwgVXNlckNvbmZpZywgQWxpYXMgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHBhdGggZnJvbSAncGF0aCdcbmltcG9ydCBmcyBmcm9tICdmcydcblxuY29uc3Qgb3V0RGlyUGFyYW1zID0ge1xuICAgIG91dERpcjogJ2Rpc3QnLFxuICAgIGVtcHR5T3V0RGlyOiB0cnVlLFxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFNoYXJlZFZpdGVDb25maWdPcHRpb25zIHtcbiAgcHJvamVjdERpcjogc3RyaW5nXG4gIG1hbnVhbENodW5rcz86IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPlxuICBhZGRpdGlvbmFsTWFudWFsQ2h1bmtzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+XG4gIHVpRnJhbWV3b3JrPzogc3RyaW5nXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTaGFyZWRWaXRlQ29uZmlnKG9wdGlvbnM6IFNoYXJlZFZpdGVDb25maWdPcHRpb25zKTogUGx1Z2luIHtcbiAgY29uc3QgeyB1aUZyYW1ld29yayA9IFwicmVhY3RcIiwgbWFudWFsQ2h1bmtzID0ge1xuICAgIHZlbmRvcjogWydyZWFjdCcsICdyZWFjdC1kb20nXSxcbiAgfSwgYWRkaXRpb25hbE1hbnVhbENodW5rcyA9IHt9IH0gPSBvcHRpb25zXG5cbiAgY29uc3Qgcm9sbHVwT3B0aW9ucyA9IHtcbiAgICAgICAgY2FjaGU6IHRydWUsXG4gICAgICAgIC4uLih1aUZyYW1ld29yayA9PT0gXCJzdmVsdGVcIiA/IG91dERpclBhcmFtcyA6IHt9KSxcbiAgICAgICAgb3V0cHV0OiB7XG4gICAgICAgICAgICBlbnRyeUZpbGVOYW1lczogJ2luZGV4LmpzJyxcbiAgICAgICAgICAgIGFzc2V0RmlsZU5hbWVzOiAnW25hbWVdW2V4dG5hbWVdJyxcbiAgICAgICAgICAgIGRpcjogXCJkaXN0XCIsXG4gICAgICAgICAgICAuLi4oT2JqZWN0LmtleXMobWFudWFsQ2h1bmtzKS5sZW5ndGggPiAwID8ge1xuICAgICAgICAgICAgICAgIG1hbnVhbENodW5rczoge1xuICAgICAgICAgICAgICAgICAgLy8gQ29yZSBVSSBsaWJyYXJpZXNcbiAgICAgICAgICAgICAgICAgIC4uLm1hbnVhbENodW5rcyxcbiAgICAgICAgICAgICAgICAgIC4uLmFkZGl0aW9uYWxNYW51YWxDaHVua3NcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0gOiB7fSlcbiAgICAgICAgfVxuICAgICAgfTtcblxuICBjb25zdCB1c2VyQ29uZmlnOiBVc2VyQ29uZmlnID0ge1xuICAgIGJ1aWxkOiB7XG4gICAgICAvLyBEaXNhYmxlIHNvdXJjZW1hcHMgaW4gcHJvZHVjdGlvbiBmb3IgYmV0dGVyIGNhY2hpbmdcbiAgICAgIHNvdXJjZW1hcDogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdkZXZlbG9wbWVudCcsXG4gICAgICBtaW5pZnk6IHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSAnZGV2ZWxvcG1lbnQnLFxuICAgICAgcm9sbHVwT3B0aW9ucyxcbiAgICAgIC8vIEluY3JlYXNlIGNodW5rIHNpemUgd2FybmluZyBsaW1pdFxuICAgICAgY2h1bmtTaXplV2FybmluZ0xpbWl0OiAxMDAwXG4gICAgfSxcbiAgICBvcHRpbWl6ZURlcHM6IHtcbiAgICAgIC8vIEVuYWJsZSBkZXBlbmRlbmN5IHByZS1idW5kbGluZ1xuICAgICAgLy8gVE9ETzogdGhpcyBpc24ndCByaWdodDsgd2hhdCBhYm91dCBtYW51YWxDaHVua3Mgb3RoZXIgdGhhbiB2ZW5kb3I/XG4gICAgICBpbmNsdWRlOiB1aUZyYW1ld29yayA9PT0gXCJyZWFjdFwiID8gKG1hbnVhbENodW5rcy52ZW5kb3IgfHwgW10pIDogW10sXG4gICAgfSxcbiAgfVxuICByZXR1cm4gKHVpRnJhbWV3b3JrID09PSBcInN2ZWx0ZVwiKSA/IHtcbiAgICAgICAgbmFtZTogJ3NoYXJlZC12aXRlLWNvbmZpZycsXG4gICAgICAgIC4uLnVzZXJDb25maWdcbiAgICB9IDoge1xuICAgICAgICBuYW1lOiAnc2hhcmVkLXZpdGUtY29uZmlnJyxcbiAgICAgICAgY29uZmlnOiAoKSA9PiAoe1xuICAgICAgICAgICAgLi4udXNlckNvbmZpZ1xuICAgICAgICB9KVxuICAgIH1cbn0gXG5cbmV4cG9ydCBmdW5jdGlvbiB2ZXJpZnlWaXRlQ2FjaGUoZGlybmFtZTogYW55KSB7XG4gICAgLy8gRW5zdXJlIGNhY2hlIGRpcmVjdG9yeSBleGlzdHNcbiAgICBjb25zdCBjYWNoZURpciA9IHBhdGgucmVzb2x2ZShkaXJuYW1lLCBcIi52aXRlLWNhY2hlXCIpO1xuICAgIGlmICghZnMuZXhpc3RzU3luYyhjYWNoZURpcikpIHtcbiAgICAgICAgZnMubWtkaXJTeW5jKGNhY2hlRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUHNpYmFzZUNvbmZpZ09wdGlvbnMge1xuICAgIHVpRnJhbWV3b3JrPzogc3RyaW5nO1xuICAgIHNlcnZpY2U6IHN0cmluZztcbiAgICBzZXJ2aWNlRGlyOiBzdHJpbmc7XG4gICAgaXNTZXJ2aW5nPzogYm9vbGVhbjtcbiAgICB1c2VIdHRwcz86IGJvb2xlYW47XG4gICAgcHJveHlQb3J0PzogbnVtYmVyO1xuICAgIGFkZGl0aW9uYWxBbGlhc2VzPzogQXJyYXk8eyBmaW5kOiBzdHJpbmcgfCBSZWdFeHA7IHJlcGxhY2VtZW50OiBzdHJpbmcgfT47XG4gICAgYWRkaXRpb25hbFByb3h5QnlwYXNzQ29uZGl0aW9ucz86IEFycmF5PChyZXE6IGFueSkgPT4gYm9vbGVhbj47XG4gICAgYWRkaXRpb25hbFByb3hpZXM/OiBSZWNvcmQ8c3RyaW5nLCB7IHRhcmdldDogc3RyaW5nOyB3cz86IGJvb2xlYW47IHRpbWVvdXQ/OiBudW1iZXI7IHJld3JpdGU/OiAocGF0aDogc3RyaW5nKSA9PiBzdHJpbmcgfT47XG59XG5cbmludGVyZmFjZSBTZXJ2ZXJDb25maWcge1xuICAgIGhvc3Q6IHN0cmluZztcbiAgICBwb3J0OiBudW1iZXI7XG4gICAgcHJveHk6IHtcbiAgICAgICAgXCIvXCI6IHtcbiAgICAgICAgICAgIHRhcmdldDogc3RyaW5nO1xuICAgICAgICAgICAgY2hhbmdlT3JpZ2luOiBib29sZWFuO1xuICAgICAgICAgICAgc2VjdXJlOiBib29sZWFuO1xuICAgICAgICAgICAgYXV0b1Jld3JpdGU6IGJvb2xlYW47XG4gICAgICAgICAgICB0aW1lb3V0PzogbnVtYmVyO1xuICAgICAgICAgICAgYnlwYXNzOiAocmVxOiBhbnksIF9yZXM6IGFueSwgX29wdDogYW55KSA9PiBhbnk7XG4gICAgICAgIH07XG4gICAgfTtcbiAgICBodHRwcz86IHtcbiAgICAgICAga2V5OiBzdHJpbmc7XG4gICAgICAgIGNlcnQ6IHN0cmluZztcbiAgICB9O1xufVxuXG5jb25zdCBzZXJ2aWNlc0RpciA9IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUpO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUHNpYmFzZUNvbmZpZyhvcHRpb25zOiBQc2liYXNlQ29uZmlnT3B0aW9ucyk6IFBsdWdpbiB7XG4gICAgY29uc3Qge1xuICAgICAgICB1aUZyYW1ld29yayA9IFwicmVhY3RcIixcbiAgICAgICAgc2VydmljZSxcbiAgICAgICAgc2VydmljZURpcixcbiAgICAgICAgaXNTZXJ2aW5nID0gZmFsc2UsXG4gICAgICAgIHVzZUh0dHBzID0gZmFsc2UsXG4gICAgICAgIHByb3h5UG9ydCA9IDgwODAsXG4gICAgICAgIGFkZGl0aW9uYWxBbGlhc2VzID0gW10sXG4gICAgICAgIGFkZGl0aW9uYWxQcm94eUJ5cGFzc0NvbmRpdGlvbnMgPSBbXSxcbiAgICAgICAgYWRkaXRpb25hbFByb3hpZXMgPSBbXSxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGNvbnN0IGJ1aWxkQWxpYXNlczogQWxpYXNbXSA9IFtcbiAgICAgICAge1xuICAgICAgICAgICAgZmluZDogXCJAXCIsXG4gICAgICAgICAgICByZXBsYWNlbWVudDogcGF0aC5yZXNvbHZlKHNlcnZpY2VEaXIsIFwiLi9zcmNcIiksXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICAgIGZpbmQ6IC9eXFwvY29tbW9uKD8hXFwvKD86Zm9udHMpKSguKikkLyxcbiAgICAgICAgICAgIHJlcGxhY2VtZW50OiBwYXRoLnJlc29sdmUoYCR7c2VydmljZXNEaXJ9L3VzZXIvQ29tbW9uQXBpL2NvbW1vbi9yZXNvdXJjZXMkMWApLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgICBmaW5kOiAvXkBwc2liYXNlXFwvY29tbW9uLWxpYi4qJC8sXG4gICAgICAgICAgICByZXBsYWNlbWVudDogXCIvY29tbW9uL2NvbW1vbi1saWIuanNcIixcbiAgICAgICAgfSxcbiAgICAgICAgLi4uYWRkaXRpb25hbEFsaWFzZXMsXG4gICAgXTtcblxuICAgIGlmIChpc1NlcnZpbmcpIHtcbiAgICAgICAgLy8gVE9ETzogdGhpcyBpcyBjb250cmFkaWN0b3J5IHRvIHRoZSBhYm92ZSBMMTMxXG4gICAgICAgIGJ1aWxkQWxpYXNlcy5wdXNoKHtcbiAgICAgICAgICAgIGZpbmQ6IC9eQHBzaWJhc2VcXC9jb21tb24tbGliLiokLyxcbiAgICAgICAgICAgIHJlcGxhY2VtZW50OiBwYXRoLnJlc29sdmUoXG4gICAgICAgICAgICAgICAgYCR7c2VydmljZXNEaXJ9L3VzZXIvQ29tbW9uQXBpL2NvbW1vbi9wYWNrYWdlcy9jb21tb24tbGliL3NyY2BcbiAgICAgICAgICAgICksXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGJhc2VTZXJ2ZXJDb25maWc6IFNlcnZlckNvbmZpZyA9IHtcbiAgICAgICAgaG9zdDogYCR7c2VydmljZX0ucHNpYmFzZS4xMjcuMC4wLjEuc3NsaXAuaW9gLFxuICAgICAgICBwb3J0OiA4MDgxLFxuICAgICAgICBwcm94eToge1xuICAgICAgICAgICAgLi4uYWRkaXRpb25hbFByb3hpZXMsXG4gICAgICAgICAgICBcIi9cIjoge1xuICAgICAgICAgICAgICAgIHRhcmdldDogYCR7dXNlSHR0cHMgPyAnaHR0cHMnIDogJ2h0dHAnfTovL3BzaWJhc2UuMTI3LjAuMC4xLnNzbGlwLmlvOiR7cHJveHlQb3J0fS9gLFxuICAgICAgICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgICAgICAgICAgICBzZWN1cmU6ICF1c2VIdHRwcyxcbiAgICAgICAgICAgICAgICBhdXRvUmV3cml0ZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICB0aW1lb3V0OiAxMDAwMCxcbiAgICAgICAgICAgICAgICBieXBhc3M6IChyZXE6IGFueSwgX3JlczogYW55LCBfb3B0OiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaG9zdCA9IHJlcS5oZWFkZXJzLmhvc3QgfHwgXCJcIjtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3ViZG9tYWluID0gaG9zdC5zcGxpdChcIi5cIilbMF07XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJhc2VDb25kaXRpb25zID0gW1xuICAgICAgICAgICAgICAgICAgICAgICAgc3ViZG9tYWluID09PSBzZXJ2aWNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVxLm1ldGhvZCAhPT0gXCJQT1NUXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICByZXEuaGVhZGVycy5hY2NlcHQgIT09IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgIXJlcS51cmwuc3RhcnRzV2l0aChcIi9jb21tb25cIiksXG4gICAgICAgICAgICAgICAgICAgICAgICAhcmVxLnVybC5zdGFydHNXaXRoKFwiL2FwaVwiKSxcbiAgICAgICAgICAgICAgICAgICAgXTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlcS51cmwgPT09IFwiL1wiIHx8IFsuLi5iYXNlQ29uZGl0aW9ucywgLi4uYWRkaXRpb25hbFByb3h5QnlwYXNzQ29uZGl0aW9uc10uZXZlcnkoY29uZGl0aW9uID0+IFxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZW9mIGNvbmRpdGlvbiA9PT0gJ2Z1bmN0aW9uJyA/IGNvbmRpdGlvbihyZXEpIDogY29uZGl0aW9uXG4gICAgICAgICAgICAgICAgICAgICkgPyByZXEudXJsIDogdW5kZWZpbmVkO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgIH07XG5cbiAgICBpZiAodXNlSHR0cHMpIHtcbiAgICAgICAgYmFzZVNlcnZlckNvbmZpZy5odHRwcyA9IHtcbiAgICAgICAgICAgIGtleTogZnMucmVhZEZpbGVTeW5jKFxuICAgICAgICAgICAgICAgIGAke3Byb2Nlc3MuZW52LlZJVEVfU0VDVVJFX1BBVEhfVE9fQ0VSVFN9cHNpYmFzZS4xMjcuMC4wLjEuc3NsaXAuaW8rMS1rZXkucGVtYCxcbiAgICAgICAgICAgICAgICBcInV0ZjhcIixcbiAgICAgICAgICAgICksXG4gICAgICAgICAgICBjZXJ0OiBmcy5yZWFkRmlsZVN5bmMoXG4gICAgICAgICAgICAgICAgYCR7cHJvY2Vzcy5lbnYuVklURV9TRUNVUkVfUEFUSF9UT19DRVJUU31wc2liYXNlLjEyNy4wLjAuMS5zc2xpcC5pbysxLnBlbWAsXG4gICAgICAgICAgICAgICAgXCJ1dGY4XCIsXG4gICAgICAgICAgICApLFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIG5hbWU6IFwicHNpYmFzZVwiLFxuICAgICAgICBjb25maWc6ICgpID0+ICh7XG4gICAgICAgICAgICBidWlsZDoge1xuICAgICAgICAgICAgICAgIC4uLih1aUZyYW1ld29yayAhPT0gXCJzdmVsdGVcIiA/IG91dERpclBhcmFtcyA6IHt9KSxcbiAgICAgICAgICAgICAgICBhc3NldHNEaXI6IFwiXCIsXG4gICAgICAgICAgICAgICAgY3NzQ29kZVNwbGl0OiBmYWxzZSxcbiAgICAgICAgICAgICAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgICAgIGV4dGVybmFsOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICBcIi9jb21tb24vcm9vdGRvbWFpbi5tanNcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIFwiL2NvbW1vbi9jb21tb24tbGliLmpzXCIsXG4gICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgIG1ha2VBYnNvbHV0ZUV4dGVybmFsc1JlbGF0aXZlOiBmYWxzZSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNlcnZlcjogYmFzZVNlcnZlckNvbmZpZyxcbiAgICAgICAgICAgIHJlc29sdmU6IHtcbiAgICAgICAgICAgICAgICBhbGlhczogYnVpbGRBbGlhc2VzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSksXG4gICAgfTtcbn0iXSwKICAibWFwcGluZ3MiOiAiO0FBQXlTLE9BQU8saUJBQWlCO0FBQ2pVLE9BQU8sV0FBVztBQUNsQixPQUFPQSxXQUFVO0FBQ2pCLFNBQVMsb0JBQW9CO0FBQzdCLE9BQU8sbUJBQW1CO0FBQzFCLE9BQU8sVUFBVTtBQUNqQixPQUFPLG1CQUFtQjs7O0FDSDFCLE9BQU8sVUFBVTtBQUNqQixPQUFPLFFBQVE7QUFKZixJQUFNLG1DQUFtQztBQU16QyxJQUFNLGVBQWU7QUFBQSxFQUNqQixRQUFRO0FBQUEsRUFDUixhQUFhO0FBQ2pCO0FBU08sU0FBUyx1QkFBdUIsU0FBMEM7QUFDL0UsUUFBTSxFQUFFLGNBQWMsU0FBUyxlQUFlO0FBQUEsSUFDNUMsUUFBUSxDQUFDLFNBQVMsV0FBVztBQUFBLEVBQy9CLEdBQUcseUJBQXlCLENBQUMsRUFBRSxJQUFJO0FBRW5DLFFBQU0sZ0JBQWdCO0FBQUEsSUFDaEIsT0FBTztBQUFBLElBQ1AsR0FBSSxnQkFBZ0IsV0FBVyxlQUFlLENBQUM7QUFBQSxJQUMvQyxRQUFRO0FBQUEsTUFDSixnQkFBZ0I7QUFBQSxNQUNoQixnQkFBZ0I7QUFBQSxNQUNoQixLQUFLO0FBQUEsTUFDTCxHQUFJLE9BQU8s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LFlBQ0E7QUFBQSxVQUNKO0FBQUE7QUFBQSxVQUVBLFdBQVcsQ0FBQyxlQUFlO0FBQUE7QUFBQSxVQUUzQixZQUFZO0FBQUEsWUFDUjtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsWUFDQTtBQUFBLFVBQ0o7QUFBQSxRQUNKO0FBQUEsTUFDSixDQUFDO0FBQUEsTUFDRCxvQkFBb0I7QUFBQSxRQUNoQixTQUFTO0FBQUEsUUFDVDtBQUFBLFFBQ0EsV0FBVyxZQUFZO0FBQUEsUUFDdkIsVUFBVSxRQUFRLElBQUksMEJBQTBCO0FBQUEsTUFDcEQsQ0FBQztBQUFBLE1BQ0QsS0FBSztBQUFBLE1BQ0wsY0FBYztBQUFBLE1BQ2QsY0FBYztBQUFBLE1BQ2QsWUFBWTtBQUFBLElBQ2hCO0FBQUEsSUFDQSxPQUFPO0FBQUEsTUFDSCxRQUFRO0FBQUEsTUFDUixXQUFXO0FBQUEsSUFDZjtBQUFBLEVBQ0o7QUFDSixDQUFDOyIsCiAgIm5hbWVzIjogWyJwYXRoIiwgInNlcnZpY2VEaXIiLCAiX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUiLCAicGF0aCIsICJfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSJdCn0K
