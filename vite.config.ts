import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest = bring-your-own service worker. We need this because
      // the default generateSW doesn't allow adding 'push' / 'notificationclick'
      // event handlers. Our custom SW lives at src/sw.ts.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Badminton Tournament Center',
        short_name: 'Badminton',
        description: 'Live tournament center — registration, scoring, brackets.',
        theme_color: '#00d4ff',
        background_color: '#070F1F',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        // start_url intentionally omitted — iOS will use the URL that was
        // open when the user added the page to home screen. This means
        // installing from /register/<id> opens the form directly; admins
        // installing from / open the admin app. Best UX for both audiences.
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // What gets precached. Workbox writes this list into self.__WB_MANIFEST.
        // `.lottie` removed in the 2026-05-25 perf pass — the previous cat
        // loader was replaced with a hand-rolled SVG/CSS spinner, so there
        // are no `.lottie` files to precache.
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,webp,woff2}'],
        // iOS apple-touch-startup-image PNGs are large (1-2 MB each) and
        // are loaded directly by Safari at standalone-launch via the <link>
        // tag in index.html — the SW never needs to serve them. Excluding
        // saves ~2 MB of first-install precache bandwidth.
        globIgnores: ['**/apple-splash-*.png'],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Isolating heavy/independent third-party libs into named vendor
          // chunks gives long-term cache wins: when our app code changes
          // these chunks stay byte-identical and the browser keeps them.
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/@supabase')) {
            return 'supabase';
          }
          if (id.includes('node_modules/framer-motion')) {
            return 'motion';
          }
          if (id.includes('node_modules/@sentry')) {
            return 'sentry';
          }
          // `lottie` chunk removed 2026-05-25: dotlottie player is no longer
          // a dependency. LottieLoader now uses hand-rolled SVG + CSS keyframes.
          if (id.includes('node_modules/canvas-confetti')) {
            return 'confetti';
          }
        },
      },
    },
  },
})
