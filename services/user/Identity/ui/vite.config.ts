import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createSharedViteConfig } from '../../../vite.shared'

// https://vitejs.dev/config/
export default defineConfig({
  ...createSharedViteConfig({
    projectDir: __dirname,
    framework: 'react',
    additionalPlugins: [react()]
  }),
  server: {
    // NOTE: this or 127.0.0.1 will work; localhost won't because localhost is resolved to the IPv6 address of ::1
    host: "psibase.127.0.0.1.sslip.io",
    port: 8081,
  }
})
