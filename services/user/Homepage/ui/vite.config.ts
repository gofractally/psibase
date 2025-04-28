import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import svgr from 'vite-plugin-svgr'
import { fileURLToPath } from 'url'
import { createSharedViteConfig, verifyViteCache, createPsibaseConfig } from '../../../vite.shared'

const __filename = fileURLToPath(import.meta.url)
// const __dirname = path.dirname(__filename)

const serviceDir = path.resolve(__dirname);

verifyViteCache(serviceDir);

export default defineConfig({
    plugins: [
        createSharedViteConfig({
            projectDir: serviceDir,
            additionalPlugins: [
                react(),
                svgr(),
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
        ...createPsibaseConfig({
            service: "homepage",
            serviceDir,
            isServing: process.env.NODE_ENV === 'development',
        })
    ],
    resolve: {
        alias: {
            '/common': path.resolve(serviceDir, '../../CommonApi/common'),
            '@psibase/common-lib': path.resolve(serviceDir, '../../CommonApi/common/packages/common-lib/src'),
            '@psibase/common-lib/*': path.resolve(serviceDir, '../../CommonApi/common/packages/common-lib/src/*')
        }
    }
})
