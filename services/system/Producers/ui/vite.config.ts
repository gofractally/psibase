import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { verifyViteCache, createPsibaseConfig, createSharedViteConfig } from "../../../vite.shared";

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    react(), 
    createSharedViteConfig({
        projectDir: serviceDir,
    }),
    ...createPsibaseConfig({
      service: "producers",
      serviceDir: serviceDir,
      isServing: command === "serve"
    }),
  ],
}));
