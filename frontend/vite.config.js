import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Serve the API from the same origin as the app. Cross-origin JSON POSTs are
    // non-simple requests, so each one paid a CORS preflight round trip before the
    // real request; same-origin needs none.
    //
    // vercel.json carries the production half of this: a rewrite sending /api/* to
    // the euroguru-api project, forwarded server-side so the browser never learns
    // the API is a separate deployment. It targets that project's stable alias
    // rather than a deployment URL, which is regenerated on every deploy. (The
    // reasoning lives here because vercel.json is schema-checked and rejects any
    // key it does not recognise, comments included.)
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
