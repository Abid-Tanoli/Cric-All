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
      // Custom service worker (src/sw.js): navigations are NetworkFirst and
      // nothing under /api or /socket.io is ever cached, which is what fixes
      // the "users kept seeing the previous deploy" problem.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      // A new deploy installs a waiting worker; the app shows
      // "New version available. Reload" and activates it on demand.
      registerType: 'prompt',
      // Registration lives in src/pwa/registerPwa.js so the UI can react to it
      // (update toast, update() on focus) instead of the injected script.
      injectRegister: false,
      manifest: {
        id: '/',
        name: 'CricAll',
        short_name: 'CricAll',
        description:
          'CricAll — live cricket scores, scorecards, series, teams and rankings.',
        lang: 'en',
        dir: 'auto',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        // Dark navy with the orange CricAll accent (Frontend/Shared/styles/theme.css).
        theme_color: '#0a0e14',
        background_color: '#0a0e14',
        categories: ['sports', 'news'],
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
        shortcuts: [
          {
            name: 'Live Scores',
            short_name: 'Live',
            url: '/live',
            icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Matches',
            short_name: 'Matches',
            url: '/',
            icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      injectManifest: {
        // index.html is deliberately NOT precached: the page shell always comes
        // from the network first, so a deploy is visible immediately.
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
    port: 5173,
    strictPort: true,
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
