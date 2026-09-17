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
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'CricAll',
        short_name: 'CricAll',
        description: 'CricAll — live cricket scores, series and rankings',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Cache GET API responses with a NetworkFirst strategy so the last
            // successful response is shown when offline. Auth/login endpoints
            // are excluded — login data must never be written to the cache.
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith('/api') &&
              !url.pathname.startsWith('/api/auth') &&
              !url.pathname.endsWith('/login') &&
              request.method === 'GET',
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'cricall-api-get',
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
        ],
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
