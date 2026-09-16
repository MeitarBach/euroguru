import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Serve the API from the same origin as the app. Cross-origin JSON POSTs are
    // non-simple requests, so each one paid a CORS preflight round trip before the
    // real request; same-origin needs none.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
