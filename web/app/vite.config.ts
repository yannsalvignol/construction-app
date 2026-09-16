import { renameSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// The app is served from the same origin as the landing page (casprod.app),
// whose index.html owns "/". The app's HTML shell is therefore emitted as
// app.html and Cloudflare Pages rewrites the app routes (/login, /dashboard…)
// to it — see web/build.mjs for the rewrite list.
const shellAsAppHtml: Plugin = {
  name: 'casprod-app-html',
  apply: 'build',
  closeBundle() { renameSync('dist/index.html', 'dist/app.html'); },
};

export default defineConfig({
  plugins: [react(), shellAsAppHtml],
  build: { target: 'es2022', sourcemap: false },
});
