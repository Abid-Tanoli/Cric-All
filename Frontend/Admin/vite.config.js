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
        name: 'CricAll Admin',
        short_name: 'CricAll Admin',
        description: 'CricAll admin console — live scoring and management',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/admin',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Cache ONLY the app shell (static assets) and the login page.
        // Live scoring and admin actions must never run offline: no API
        // requests (GET or POST) and no auth/login data are written here.
        navigateFallback: '/admin/login',
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
