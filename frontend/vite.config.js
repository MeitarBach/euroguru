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
    //
    // /euroleague is Euroleague's schedule feed, served same-origin for a different
    // reason: that host's CORS header cannot be relied on. Its CDN caches whichever
    // answer it fetched first, and a request without an Origin header - any server,
    // our own fetch scripts included - gets an answer without the header, which is
    // then served to browsers too, for the feed's two-hour lifetime. Proxied, the
    // browser never makes a cross-origin call. vercel.json has the matching rewrite.
    // (The live game feed, on live.euroleague.net, always sends the header and is
    // read directly.)
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/euroleague': {
        target: 'https://api-live.euroleague.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/euroleague/, '/v1'),
      },
    },
  },
})
