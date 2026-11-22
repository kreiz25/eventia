import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Relative asset URLs let the same build work at the root of static hosts and
  // under GitHub Pages project paths such as /eventia/.
  base: './',
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['eventia-icon.svg', 'icon-192.png', 'icon-512.png'],
    manifest: {
      id: './', name: 'Eventia', short_name: 'Eventia', lang: 'gl',
      description: 'A túa colección persoal de experiencias por vivir.',
      theme_color: '#faf8f5', background_color: '#faf8f5', display: 'standalone',
      start_url: './', icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        { src: 'eventia-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ]
    },
    workbox: { navigateFallback: 'index.html', globPatterns: ['**/*.{js,css,html,svg,webmanifest}'] }
  })]
})
