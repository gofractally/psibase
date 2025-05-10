import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createSharedViteConfig, verifyViteCache, createPsibaseConfig } from '../../../vite.shared'
import path from 'path'

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    createSharedViteConfig({
      projectDir: serviceDir,

    }),
    ...createPsibaseConfig({
      service: "identity",
      serviceDir,
      isServing: process.env.NODE_ENV === 'development'
    })
  ],
})
