import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { createSkipUnchangedBuildPlugin, verifyViteCache, createPsibaseConfig, createSharedViteConfig } from "../../../vite.shared";

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    createSharedViteConfig({
      projectDir: serviceDir,
      // framework: 'react',
    }),
    ...createPsibaseConfig({
      service: "auth-sig",
      serviceDir: serviceDir,
      isServing: command === "serve"
    }),
    createSkipUnchangedBuildPlugin(serviceDir)
  ],
}));
