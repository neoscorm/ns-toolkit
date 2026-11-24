import { defineConfig, type Plugin } from 'vite';

// Sandbox build for the separate address sandbox.neoscorm.com.
// Courses are third-party code, so the sandbox lives on a different origin than the toolkit:
// this way course code cannot reach toolkit data.

// Security policy for the sandbox shell. It does not apply to the courses themselves:
// their pages are served by the Service Worker without restrictions, as an LMS does.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "frame-src 'self'",
  "worker-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'inject-sandbox-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  root: 'sandbox',
  base: '/',
  envDir: '..',
  // Its own cache folder: otherwise the two dev servers (5173 and 5174) overwrite each other's bundled
  // libraries and the browser gets a 504 Outdated Optimize Dep error
  cacheDir: '../node_modules/.vite-sandbox',
  plugins: [cspPlugin()],
  build: {
    outDir: '../dist-sandbox',
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: { polyfill: false },
  },
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
});
