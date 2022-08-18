import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'


const APPLET_CONTRACT = "token-sys"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // outDir: '/root/psibase/contracts/user/TokenSys/ui',
    assetsDir: '',
    cssCodeSplit: false,
    rollupOptions: {
      external: ['/common/rootdomain.mjs', '/common/rpc.mjs', '/common/iframeResizer.js'],
      output: {
        entryFileNames: 'index.js'
      }
    }
  },
  resolve: {
    alias: {
      '/common/rpc.mjs': path.resolve('/root/psibase/contracts/user/CommonSys/common/rpc.mjs'),
    },
  },
  server: {
    host: "localhost",
    port: 8081,
    proxy: {
      '/': {
        target: 'http://psibase.127.0.0.1.sslip.io:8080/',
        bypass: (req, _res, _opt) => {
          const host = req.headers.host || ""
          const subdomain = host.split(".")[0]
          if (subdomain === APPLET_CONTRACT) {
            return req.url;
          }
        }
      },
    }
  }
})


