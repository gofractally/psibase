import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '/root/psibase/contracts/user/TokenSys/ui',
    assetsDir: '',
    cssCodeSplit: false,
    rollupOptions: {
      external: ['/common/rootdomain.mjs'],
      output: {
        entryFileNames: 'index.js'
      }
    }
  }
})
