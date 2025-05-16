import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { verifyViteCache, createPsibaseConfig, createSharedViteConfig } from "../../../vite.shared";

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

// https://vitejs.dev/config/
export default defineConfig(({ command }: { command: 'serve' | 'build' }) => ({
  plugins: [
    react(),
    createSharedViteConfig({
        projectDir: serviceDir,
        manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom']
        }
    }),
    createPsibaseConfig({
      service: "psibase",
      serviceDir,
      isServing: command === "serve",
      proxyPort: 8079,
      additionalProxyBypassConditions: [
        (req) => {
          const host = req.headers.host || "";
          const subdomain = host.split(".")[0];
          return subdomain === "psibase";
        },
        (req) => req.method !== "POST",
        (req) => req.headers.accept !== "application/json",
        (req) => !req.url.startsWith("/common"),
        (req) => !req.url.startsWith("/api")
      ]
    }),
  ],
}));
