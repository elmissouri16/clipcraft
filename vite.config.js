import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The page's strict CSP blocks Vite's inline hot-reload client, so it is only applied to builds.
const prodOnlyCsp = {
  name: 'prod-only-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, ''),
};

export default defineConfig({
  plugins: [react(), prodOnlyCsp],
  server: { port: 5173, strictPort: true },
  // Only the app's page: otherwise the dependency scan also crawls build output such as android/build.
  optimizeDeps: { entries: ['index.html'] },
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
});
