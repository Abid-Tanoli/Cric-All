import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Same pattern as the User app, but this is a separate install with its
      // own origin, manifest and custom worker (src/sw.js).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      // A new deploy waits until the user confirms the "Update" toast.
      registerType: 'prompt',
      // Registration lives in src/pwa/registerPwa.js so React can react to it.
      injectRegister: false,
      manifest: {
        id: '/',
        name: 'CricAll Admin',
        short_name: 'CricAll Admin',
        description: 'CricAll admin console — live scoring and management',
        lang: 'en',
        dir: 'auto',
        // Admin is its own origin/app; the installed app opens at the root.
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        // Deep admin blue: deliberately different from the User app's #0a0e14.
        theme_color: '#101c30',
        background_color: '#101c30',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // index.html is NOT precached: the shell always comes from the network,
        // and a failed navigation shows offline.html instead of a stale admin UI.
        globPatterns: ['**/*.{js,css,svg,png,ico,webmanifest}', 'offline.html'],
        globIgnores: ['**/*.map'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(currentDir, '../Shared'),
      react: path.resolve(currentDir, 'node_modules/react'),
      'react-dom': path.resolve(currentDir, 'node_modules/react-dom'),
      'react-hook-form': path.resolve(currentDir, 'node_modules/react-hook-form'),
      '@hookform/resolvers': path.resolve(currentDir, 'node_modules/@hookform/resolvers'),
      zod: path.resolve(currentDir, 'node_modules/zod'),
      axios: path.resolve(currentDir, 'node_modules/axios'),
      'socket.io-client': path.resolve(currentDir, 'node_modules/socket.io-client'),
    },
  },
  server: {
    host: 'localhost',
    port: 5174,
    strictPort: true,
    allowedHosts: ['localhost'],
    hmr: {
      host: 'localhost',
      protocol: 'ws',
    },
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
