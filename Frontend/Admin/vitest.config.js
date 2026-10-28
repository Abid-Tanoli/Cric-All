import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(currentDir, '../Shared'),
      // Shared/ lives outside this package, so on a clean CI install (no
      // node_modules next to Frontend/Shared) the bare `react` and form
      // libraries imported by Shared components cannot resolve. Point them at
      // this package's copies, exactly like vite.config.js does for the build.
      react: path.resolve(currentDir, 'node_modules/react'),
      'react-dom': path.resolve(currentDir, 'node_modules/react-dom'),
      'react-hook-form': path.resolve(currentDir, 'node_modules/react-hook-form'),
      '@hookform/resolvers': path.resolve(currentDir, 'node_modules/@hookform/resolvers'),
      zod: path.resolve(currentDir, 'node_modules/zod'),
      axios: path.resolve(currentDir, 'node_modules/axios'),
      'socket.io-client': path.resolve(currentDir, 'node_modules/socket.io-client'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
  },
})
