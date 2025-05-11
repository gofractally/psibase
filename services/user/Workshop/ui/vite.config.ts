/// <reference types="vite/client" />

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { verifyViteCache, createPsibaseConfig, createSharedViteConfig } from '../../../vite.shared'

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

// https://vitejs.dev/config/
export default defineConfig(() => ({
  plugins: [
    react(), 
    createSharedViteConfig({
        projectDir: serviceDir,
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom']
      },
    }),
    ...createPsibaseConfig({
      service: "workshop",
      serviceDir,
      isServing: process.env.NODE_ENV === 'development'
    }),
  ],
}));
