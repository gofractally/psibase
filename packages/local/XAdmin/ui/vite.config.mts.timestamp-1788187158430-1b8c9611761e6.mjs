// vite.config.mts
import path2 from "path";
import { defineConfig } from "file:///root/psibase/packages/.yarn/__virtual__/vite-virtual-d9ef20ab41/2/.caches/yarn/vite-npm-5.4.21-12a8265f9b-468336a140.zip/node_modules/vite/dist/node/index.js";
import topLevelAwait from "file:///root/psibase/packages/.yarn/__virtual__/vite-plugin-top-level-await-virtual-7e9b4d800b/2/.caches/yarn/vite-plugin-top-level-await-npm-1.6.0-19eec4f223-499054e67f.zip/node_modules/vite-plugin-top-level-await/exports/import.mjs";
import wasm from "file:///root/psibase/packages/.yarn/__virtual__/vite-plugin-wasm-virtual-de3038e95d/2/.caches/yarn/vite-plugin-wasm-npm-3.6.0-bfbbf4d3e9-7b18a7effc.zip/node_modules/vite-plugin-wasm/exports/import.mjs";

// ../../../vite.shared.ts
import tailwindcss from "file:///root/psibase/packages/.yarn/__virtual__/@tailwindcss-vite-virtual-4e976f32e3/2/.caches/yarn/@tailwindcss-vite-npm-4.3.1-bc721836cb-62526d53f7.zip/node_modules/@tailwindcss/vite/dist/index.mjs";
import react from "file:///root/psibase/packages/.yarn/__virtual__/@vitejs-plugin-react-virtual-1461bd7279/2/.caches/yarn/@vitejs-plugin-react-npm-4.7.0-650e714693-692f239609.zip/node_modules/@vitejs/plugin-react/dist/index.js";
import fs from "fs";
import path from "path";
import tsconfigPaths from "file:///root/psibase/packages/.yarn/__virtual__/vite-tsconfig-paths-virtual-16ae8b9238/2/.caches/yarn/vite-tsconfig-paths-npm-4.3.2-96d4ddd73d-f390ac1d1c.zip/node_modules/vite-tsconfig-paths/dist/index.mjs";
var __vite_injected_original_dirname = "/root/psibase/packages";
var outDirParams = {
  outDir: "dist",
  emptyOutDir: true
};
function createSharedViteConfig(options) {
  const {
    uiFramework = "react",
    manualChunks = {
      vendor: ["react", "react-dom"]
    },
    additionalManualChunks = {}
  } = options ?? {};
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
function createPsibaseConfig(config, options) {
  const isDevServer = config.command === "serve";
  const {
    uiFramework = "react",
    appDirectory: appDirectory2,
    bundleCommonLib = false,
    additionalAliases = []
  } = options;
  const commonLibSourcePath = path.resolve(
    `${servicesDir}/user/CommonApi/common/packages/common-lib/src`
  );
  const buildAliases = [
    {
      find: "@",
      replacement: path.resolve(appDirectory2, "./src")
    },
    {
      find: /^@psibase\/common-lib.*$/,
      replacement: isDevServer || bundleCommonLib ? commonLibSourcePath : "/common/common-lib.js"
    },
    ...additionalAliases
  ];
  return {
    name: "psibase",
    config: () => ({
      server: {
        port: 8081
      },
      build: {
        ...uiFramework !== "svelte" ? outDirParams : {},
        assetsDir: "",
        cssCodeSplit: false,
        rollupOptions: {
          external: [
            "/common/rootdomain.mjs",
            ...bundleCommonLib ? [] : ["/common/common-lib.js"]
          ],
          makeAbsoluteExternalsRelative: false
        }
      },
      resolve: {
        alias: buildAliases
      }
    })
  };
}
var getSharedUIPlugins = (uiFramework = "react") => {
  return [
    uiFramework === "react" ? react() : void 0,
    tsconfigPaths(),
    tailwindcss()
  ];
};

// vite.config.mts
var __vite_injected_original_dirname2 = "/root/psibase/packages/local/XAdmin/ui";
var appDirectory = path2.resolve(__vite_injected_original_dirname2);
verifyViteCache(appDirectory);
var vite_config_default = defineConfig((config) => ({
  plugins: [
    createSharedViteConfig({
      manualChunks: {
        vendor: ["react", "react-dom", "react-router-dom"]
      }
    }),
    createPsibaseConfig(config, {
      appDirectory,
      additionalAliases: [
        {
          find: "wasm-transpiled",
          replacement: path2.resolve(
            appDirectory,
            "./wasm-transpiled/x_admin"
          )
        }
      ]
    }),
    ...getSharedUIPlugins(),
    wasm(),
    topLevelAwait()
  ],
  build: {
    minify: true,
    sourcemap: false
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcubXRzIiwgIi4uLy4uLy4uL3ZpdGUuc2hhcmVkLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiL3Jvb3QvcHNpYmFzZS9wYWNrYWdlcy9sb2NhbC9YQWRtaW4vdWlcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9yb290L3BzaWJhc2UvcGFja2FnZXMvbG9jYWwvWEFkbWluL3VpL3ZpdGUuY29uZmlnLm10c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vcm9vdC9wc2liYXNlL3BhY2thZ2VzL2xvY2FsL1hBZG1pbi91aS92aXRlLmNvbmZpZy5tdHNcIjtpbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcbmltcG9ydCB0b3BMZXZlbEF3YWl0IGZyb20gXCJ2aXRlLXBsdWdpbi10b3AtbGV2ZWwtYXdhaXRcIjtcbmltcG9ydCB3YXNtIGZyb20gXCJ2aXRlLXBsdWdpbi13YXNtXCI7XG5cbmltcG9ydCB7XG4gICAgY3JlYXRlUHNpYmFzZUNvbmZpZyxcbiAgICBjcmVhdGVTaGFyZWRWaXRlQ29uZmlnLFxuICAgIGdldFNoYXJlZFVJUGx1Z2lucyxcbiAgICB2ZXJpZnlWaXRlQ2FjaGUsXG59IGZyb20gXCIuLi8uLi8uLi92aXRlLnNoYXJlZFwiO1xuXG5jb25zdCBhcHBEaXJlY3RvcnkgPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lKTtcbnZlcmlmeVZpdGVDYWNoZShhcHBEaXJlY3RvcnkpO1xuXG4vLyBodHRwczovL3ZpdGVqcy5kZXYvY29uZmlnL1xuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKChjb25maWcpID0+ICh7XG4gICAgcGx1Z2luczogW1xuICAgICAgICBjcmVhdGVTaGFyZWRWaXRlQ29uZmlnKHtcbiAgICAgICAgICAgIG1hbnVhbENodW5rczoge1xuICAgICAgICAgICAgICAgIHZlbmRvcjogW1wicmVhY3RcIiwgXCJyZWFjdC1kb21cIiwgXCJyZWFjdC1yb3V0ZXItZG9tXCJdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSksXG4gICAgICAgIGNyZWF0ZVBzaWJhc2VDb25maWcoY29uZmlnLCB7XG4gICAgICAgICAgICBhcHBEaXJlY3RvcnksXG4gICAgICAgICAgICBhZGRpdGlvbmFsQWxpYXNlczogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgZmluZDogXCJ3YXNtLXRyYW5zcGlsZWRcIixcbiAgICAgICAgICAgICAgICAgICAgcmVwbGFjZW1lbnQ6IHBhdGgucmVzb2x2ZShcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwcERpcmVjdG9yeSxcbiAgICAgICAgICAgICAgICAgICAgICAgIFwiLi93YXNtLXRyYW5zcGlsZWQveF9hZG1pblwiLFxuICAgICAgICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICB9KSxcbiAgICAgICAgLi4uZ2V0U2hhcmVkVUlQbHVnaW5zKCksXG4gICAgICAgIHdhc20oKSxcbiAgICAgICAgdG9wTGV2ZWxBd2FpdCgpLFxuICAgIF0sXG4gICAgYnVpbGQ6IHtcbiAgICAgICAgbWluaWZ5OiB0cnVlLFxuICAgICAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICAgIH0sXG59KSk7XG4iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9yb290L3BzaWJhc2UvcGFja2FnZXNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9yb290L3BzaWJhc2UvcGFja2FnZXMvdml0ZS5zaGFyZWQudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3Jvb3QvcHNpYmFzZS9wYWNrYWdlcy92aXRlLnNoYXJlZC50c1wiOy8vLyA8cmVmZXJlbmNlIHR5cGVzPVwibm9kZVwiIC8+XG5pbXBvcnQgdHlwZSB7IEFsaWFzLCBDb25maWdFbnYsIFBsdWdpbiwgVXNlckNvbmZpZyB9IGZyb20gXCJ2aXRlXCI7XG5cbmltcG9ydCB0YWlsd2luZGNzcyBmcm9tIFwiQHRhaWx3aW5kY3NzL3ZpdGVcIjtcbmltcG9ydCByZWFjdCBmcm9tIFwiQHZpdGVqcy9wbHVnaW4tcmVhY3RcIjtcbmltcG9ydCBmcyBmcm9tIFwiZnNcIjtcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgdHNjb25maWdQYXRocyBmcm9tIFwidml0ZS10c2NvbmZpZy1wYXRoc1wiO1xuXG5jb25zdCBvdXREaXJQYXJhbXMgPSB7XG4gICAgb3V0RGlyOiBcImRpc3RcIixcbiAgICBlbXB0eU91dERpcjogdHJ1ZSxcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2hhcmVkVml0ZUNvbmZpZ09wdGlvbnMge1xuICAgIG1hbnVhbENodW5rcz86IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPjtcbiAgICBhZGRpdGlvbmFsTWFudWFsQ2h1bmtzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+O1xuICAgIHVpRnJhbWV3b3JrPzogc3RyaW5nO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU2hhcmVkVml0ZUNvbmZpZyhcbiAgICBvcHRpb25zPzogU2hhcmVkVml0ZUNvbmZpZ09wdGlvbnMsXG4pOiBQbHVnaW4ge1xuICAgIGNvbnN0IHtcbiAgICAgICAgdWlGcmFtZXdvcmsgPSBcInJlYWN0XCIsXG4gICAgICAgIG1hbnVhbENodW5rcyA9IHtcbiAgICAgICAgICAgIHZlbmRvcjogW1wicmVhY3RcIiwgXCJyZWFjdC1kb21cIl0sXG4gICAgICAgIH0sXG4gICAgICAgIGFkZGl0aW9uYWxNYW51YWxDaHVua3MgPSB7fSxcbiAgICB9ID0gb3B0aW9ucyA/PyB7fTtcblxuICAgIGNvbnN0IHJvbGx1cE9wdGlvbnMgPSB7XG4gICAgICAgIGNhY2hlOiB0cnVlLFxuICAgICAgICAuLi4odWlGcmFtZXdvcmsgPT09IFwic3ZlbHRlXCIgPyBvdXREaXJQYXJhbXMgOiB7fSksXG4gICAgICAgIG91dHB1dDoge1xuICAgICAgICAgICAgZW50cnlGaWxlTmFtZXM6IFwiaW5kZXguanNcIixcbiAgICAgICAgICAgIGFzc2V0RmlsZU5hbWVzOiBcIltuYW1lXVtleHRuYW1lXVwiLFxuICAgICAgICAgICAgZGlyOiBcImRpc3RcIixcbiAgICAgICAgICAgIC4uLihPYmplY3Qua2V5cyhtYW51YWxDaHVua3MpLmxlbmd0aCA+IDBcbiAgICAgICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgICAgICAgICBtYW51YWxDaHVua3M6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ29yZSBVSSBsaWJyYXJpZXNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgLi4ubWFudWFsQ2h1bmtzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5hZGRpdGlvbmFsTWFudWFsQ2h1bmtzLFxuICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgOiB7fSksXG4gICAgICAgIH0sXG4gICAgfTtcblxuICAgIGNvbnN0IHVzZXJDb25maWc6IFVzZXJDb25maWcgPSB7XG4gICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgICByb2xsdXBPcHRpb25zLFxuICAgICAgICAgICAgLy8gSW5jcmVhc2UgY2h1bmsgc2l6ZSB3YXJuaW5nIGxpbWl0XG4gICAgICAgICAgICBjaHVua1NpemVXYXJuaW5nTGltaXQ6IDEwMDAsXG4gICAgICAgIH0sXG4gICAgICAgIG9wdGltaXplRGVwczoge1xuICAgICAgICAgICAgLy8gRW5hYmxlIGRlcGVuZGVuY3kgcHJlLWJ1bmRsaW5nXG4gICAgICAgICAgICAvLyBUT0RPOiB0aGlzIGlzbid0IHJpZ2h0OyB3aGF0IGFib3V0IG1hbnVhbENodW5rcyBvdGhlciB0aGFuIHZlbmRvcj9cbiAgICAgICAgICAgIGluY2x1ZGU6IHVpRnJhbWV3b3JrID09PSBcInJlYWN0XCIgPyBtYW51YWxDaHVua3MudmVuZG9yIHx8IFtdIDogW10sXG4gICAgICAgIH0sXG4gICAgfTtcbiAgICByZXR1cm4gdWlGcmFtZXdvcmsgPT09IFwic3ZlbHRlXCJcbiAgICAgICAgPyB7XG4gICAgICAgICAgICAgIG5hbWU6IFwic2hhcmVkLXZpdGUtY29uZmlnXCIsXG4gICAgICAgICAgICAgIC4uLnVzZXJDb25maWcsXG4gICAgICAgICAgfVxuICAgICAgICA6IHtcbiAgICAgICAgICAgICAgbmFtZTogXCJzaGFyZWQtdml0ZS1jb25maWdcIixcbiAgICAgICAgICAgICAgY29uZmlnOiAoKSA9PiAoe1xuICAgICAgICAgICAgICAgICAgLi4udXNlckNvbmZpZyxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZlcmlmeVZpdGVDYWNoZShkaXJuYW1lOiBzdHJpbmcpIHtcbiAgICAvLyBFbnN1cmUgY2FjaGUgZGlyZWN0b3J5IGV4aXN0c1xuICAgIGNvbnN0IGNhY2hlRGlyID0gcGF0aC5yZXNvbHZlKGRpcm5hbWUsIFwiLnZpdGUtY2FjaGVcIik7XG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKGNhY2hlRGlyKSkge1xuICAgICAgICBmcy5ta2RpclN5bmMoY2FjaGVEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBQc2liYXNlQ29uZmlnT3B0aW9ucyB7XG4gICAgdWlGcmFtZXdvcms/OiBzdHJpbmc7XG4gICAgYXBwRGlyZWN0b3J5OiBzdHJpbmc7XG4gICAgYnVuZGxlQ29tbW9uTGliPzogYm9vbGVhbjtcbiAgICBhZGRpdGlvbmFsQWxpYXNlcz86IEFycmF5PHsgZmluZDogc3RyaW5nIHwgUmVnRXhwOyByZXBsYWNlbWVudDogc3RyaW5nIH0+O1xufVxuXG5jb25zdCBzZXJ2aWNlc0RpciA9IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUpO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUHNpYmFzZUNvbmZpZyhcbiAgICBjb25maWc6IENvbmZpZ0VudixcbiAgICBvcHRpb25zOiBQc2liYXNlQ29uZmlnT3B0aW9ucyxcbik6IFBsdWdpbiB7XG4gICAgY29uc3QgaXNEZXZTZXJ2ZXIgPSBjb25maWcuY29tbWFuZCA9PT0gXCJzZXJ2ZVwiO1xuXG4gICAgY29uc3Qge1xuICAgICAgICB1aUZyYW1ld29yayA9IFwicmVhY3RcIixcbiAgICAgICAgYXBwRGlyZWN0b3J5LFxuICAgICAgICBidW5kbGVDb21tb25MaWIgPSBmYWxzZSxcbiAgICAgICAgYWRkaXRpb25hbEFsaWFzZXMgPSBbXSxcbiAgICB9ID0gb3B0aW9ucztcblxuICAgIGNvbnN0IGNvbW1vbkxpYlNvdXJjZVBhdGggPSBwYXRoLnJlc29sdmUoXG4gICAgICAgIGAke3NlcnZpY2VzRGlyfS91c2VyL0NvbW1vbkFwaS9jb21tb24vcGFja2FnZXMvY29tbW9uLWxpYi9zcmNgLFxuICAgICk7XG5cbiAgICBjb25zdCBidWlsZEFsaWFzZXM6IEFsaWFzW10gPSBbXG4gICAgICAgIHtcbiAgICAgICAgICAgIGZpbmQ6IFwiQFwiLFxuICAgICAgICAgICAgcmVwbGFjZW1lbnQ6IHBhdGgucmVzb2x2ZShhcHBEaXJlY3RvcnksIFwiLi9zcmNcIiksXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICAgIGZpbmQ6IC9eQHBzaWJhc2VcXC9jb21tb24tbGliLiokLyxcbiAgICAgICAgICAgIHJlcGxhY2VtZW50OlxuICAgICAgICAgICAgICAgIGlzRGV2U2VydmVyIHx8IGJ1bmRsZUNvbW1vbkxpYlxuICAgICAgICAgICAgICAgICAgICA/IGNvbW1vbkxpYlNvdXJjZVBhdGhcbiAgICAgICAgICAgICAgICAgICAgOiBcIi9jb21tb24vY29tbW9uLWxpYi5qc1wiLFxuICAgICAgICB9LFxuICAgICAgICAuLi5hZGRpdGlvbmFsQWxpYXNlcyxcbiAgICBdO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgbmFtZTogXCJwc2liYXNlXCIsXG4gICAgICAgIGNvbmZpZzogKCkgPT4gKHtcbiAgICAgICAgICAgIHNlcnZlcjoge1xuICAgICAgICAgICAgICAgIHBvcnQ6IDgwODEsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYnVpbGQ6IHtcbiAgICAgICAgICAgICAgICAuLi4odWlGcmFtZXdvcmsgIT09IFwic3ZlbHRlXCIgPyBvdXREaXJQYXJhbXMgOiB7fSksXG4gICAgICAgICAgICAgICAgYXNzZXRzRGlyOiBcIlwiLFxuICAgICAgICAgICAgICAgIGNzc0NvZGVTcGxpdDogZmFsc2UsXG4gICAgICAgICAgICAgICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgICAgICAgICAgICAgICBleHRlcm5hbDogW1xuICAgICAgICAgICAgICAgICAgICAgICAgXCIvY29tbW9uL3Jvb3Rkb21haW4ubWpzXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAuLi4oYnVuZGxlQ29tbW9uTGliID8gW10gOiBbXCIvY29tbW9uL2NvbW1vbi1saWIuanNcIl0pLFxuICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICBtYWtlQWJzb2x1dGVFeHRlcm5hbHNSZWxhdGl2ZTogZmFsc2UsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZXNvbHZlOiB7XG4gICAgICAgICAgICAgICAgYWxpYXM6IGJ1aWxkQWxpYXNlcyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgIH07XG59XG5cbmV4cG9ydCBjb25zdCBnZXRTaGFyZWRVSVBsdWdpbnMgPSAoXG4gICAgdWlGcmFtZXdvcms6IFwicmVhY3RcIiB8IFwic3ZlbHRlXCIgPSBcInJlYWN0XCIsXG4pID0+IHtcbiAgICByZXR1cm4gW1xuICAgICAgICB1aUZyYW1ld29yayA9PT0gXCJyZWFjdFwiID8gcmVhY3QoKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgdHNjb25maWdQYXRocygpLFxuICAgICAgICB0YWlsd2luZGNzcygpLFxuICAgIF07XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFzUyxPQUFPQSxXQUFVO0FBQ3ZULFNBQVMsb0JBQW9CO0FBQzdCLE9BQU8sbUJBQW1CO0FBQzFCLE9BQU8sVUFBVTs7O0FDQWpCLE9BQU8saUJBQWlCO0FBQ3hCLE9BQU8sV0FBVztBQUNsQixPQUFPLFFBQVE7QUFDZixPQUFPLFVBQVU7QUFDakIsT0FBTyxtQkFBbUI7QUFQMUIsSUFBTSxtQ0FBbUM7QUFTekMsSUFBTSxlQUFlO0FBQUEsRUFDakIsUUFBUTtBQUFBLEVBQ1IsYUFBYTtBQUNqQjtBQVFPLFNBQVMsdUJBQ1osU0FDTTtBQUNOLFFBQU07QUFBQSxJQUNGLGNBQWM7QUFBQSxJQUNkLGVBQWU7QUFBQSxNQUNYLFFBQVEsQ0FBQyxTQUFTLFdBQVc7QUFBQSxJQUNqQztBQUFBLElBQ0EseUJBQXlCLENBQUM7QUFBQSxFQUM5QixJQUFJLFdBQVcsQ0FBQztBQUVoQixRQUFNLGdCQUFnQjtBQUFBLElBQ2xCLE9BQU87QUFBQSxJQUNQLEdBQUksZ0JBQWdCLFdBQVcsZUFBZSxDQUFDO0FBQUEsSUFDL0MsUUFBUTtBQUFBLE1BQ0osZ0JBQWdCO0FBQUEsTUFDaEIsZ0JBQWdCO0FBQUEsTUFDaEIsS0FBSztBQUFBLE1BQ0wsR0FBSSxPQUFPLEtBQUssWUFBWSxFQUFFLFNBQVMsSUFDakM7QUFBQSxRQUNJLGNBQWM7QUFBQTtBQUFBLFVBRVYsR0FBRztBQUFBLFVBQ0gsR0FBRztBQUFBLFFBQ1A7QUFBQSxNQUNKLElBQ0EsQ0FBQztBQUFBLElBQ1g7QUFBQSxFQUNKO0FBRUEsUUFBTSxhQUF5QjtBQUFBLElBQzNCLE9BQU87QUFBQSxNQUNIO0FBQUE7QUFBQSxNQUVBLHVCQUF1QjtBQUFBLElBQzNCO0FBQUEsSUFDQSxjQUFjO0FBQUE7QUFBQTtB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
