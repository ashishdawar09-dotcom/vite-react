import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
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
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell (Workbox auto-detects build output)
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,webp,woff2,lottie}'],
        // Supabase URLs must never get an HTML fallback — would break JSON parsing.
        navigateFallbackDenylist: [/^\/api/, /supabase\.co/],
        runtimeCaching: [
          {
            // Supabase REST + Auth + Storage + Realtime → always go to network
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            // Lottie animations + image assets → cache-first, 30-day expiry
            urlPattern: /\.(?:png|jpg|jpeg|svg|webp|lottie)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/@supabase')) {
            return 'supabase';
          }
        },
      },
    },
  },
})
