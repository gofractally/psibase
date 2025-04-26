import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import alias from '@rollup/plugin-alias'
import svgr from 'vite-plugin-svgr'
import { fileURLToPath } from 'url'
import { createSharedViteConfig } from '../../../vite.shared'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const psibase = (appletContract: string, isServing?: boolean) => {
    const buildAliases = [
        {
            find: '@',
            replacement: path.resolve(__dirname, './src'),
        },
    ]

    if (isServing) {
        buildAliases.push({
            find: /^@psibase\/common-lib.*$/,
            replacement: path.resolve(
                '../../CommonApi/common/packages/common-lib/src'
            ),
        })
    }

    return [
        {
            name: 'psibase',
            config: () => {
                return {
                    build: {
                        assetsDir: '',
                        cssCodeSplit: false,
                        rollupOptions: {
                            external: [
                                '/common/rootdomain.mjs',
                                '/common/common-lib.js',
                            ],
                            makeAbsoluteExternalsRelative: false,
                            output: {
                                entryFileNames: 'index.js',
                                assetFileNames: '[name][extname]',
                            },
                        },
                    },
                    server: {
                        host: 'psibase.127.0.0.1.sslip.io',
                        port: 8081,
                        proxy: {
                            '/': {
                                target: 'http://psibase.127.0.0.1.sslip.io:8079/',
                                changeOrigin: true,
                            },
                        },
                    },
                }
            },
        },
        alias({
            entries: buildAliases,
        }),
    ]
}

export default defineConfig({
  ...createSharedViteConfig({
    projectDir: __dirname,
    additionalPlugins: [
      react(),
      svgr(),
      ...psibase('homepage', process.env.NODE_ENV === 'development'),
    ],
    additionalManualChunks: {
      // Radix UI components
      'radix-ui': [
        '@radix-ui/react-alert-dialog',
        '@radix-ui/react-avatar',
        '@radix-ui/react-collapsible',
        '@radix-ui/react-dialog',
        '@radix-ui/react-dropdown-menu',
        '@radix-ui/react-label',
        '@radix-ui/react-scroll-area',
        '@radix-ui/react-select',
        '@radix-ui/react-separator',
        '@radix-ui/react-slot',
        '@radix-ui/react-tabs',
        '@radix-ui/react-tooltip'
      ],
      // Animation libraries
      animation: ['@react-spring/web', 'framer-motion'],
      // Form handling
      forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
      // UI utilities
      'ui-utils': [
        'class-variance-authority',
        'clsx',
        'tailwind-merge',
        'tailwindcss-animate',
        'lucide-react',
        'sonner'
      ],
      // State management
      state: ['jotai', 'usehooks-ts'],
      // Date handling
      date: ['dayjs'],
      // Avatar generation
      avatar: ['@dicebear/core', '@dicebear/collection']
    }
  }),
    resolve: {
        alias: {
      '@': path.resolve(__dirname, 'src'),
      '/common': path.resolve(__dirname, '../../CommonApi/common'),
      '@psibase/common-lib': path.resolve(__dirname, '../../CommonApi/common/packages/common-lib/src'),
      '@psibase/common-lib/*': path.resolve(__dirname, '../../CommonApi/common/packages/common-lib/src/*')
    }
  }
})
