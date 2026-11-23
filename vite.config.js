import {fileURLToPath} from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fontFormats from './build/font-formats.cjs';

// The page's strict CSP blocks Vite's inline hot-reload client, so it is only applied to builds.
const prodOnlyCsp = {
  name: 'prod-only-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, ''),
};

export default defineConfig({
  plugins: [react(), prodOnlyCsp],
  resolve: { alias: { 'clipcraft/internal/export-formats': fileURLToPath(new URL('./shared/exportFormats.cjs', import.meta.url)), 'clipcraft/internal/service-contract': fileURLToPath(new URL('./shared/extensionServices.cjs', import.meta.url)), 'clipcraft/internal/shortcut-contract': fileURLToPath(new URL('./shared/pluginShortcuts.cjs', import.meta.url)) } },
  css: { postcss: { plugins: [fontFormats] } },
  server: { port: 5173, strictPort: true },
  // Only the app's page: otherwise the dependency scan also crawls build output such as android/build.
  optimizeDeps: { entries: ['index.html'], include: ['clipcraft/internal/export-formats','clipcraft/internal/shortcut-contract','clipcraft/internal/service-contract'] },
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
});
