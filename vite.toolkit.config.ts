import { defineConfig, loadEnv, type Plugin } from 'vite';

// Toolkit build for the address neoscorm.com/toolkit/.
// Courses open in the sandbox at another address (vite.sandbox.config.ts); their code does not get in here.

/** Sandbox address: the VITE_SANDBOX_ORIGIN variable or the production address by default */
const DEFAULT_SANDBOX_ORIGIN = 'https://sandbox.neoscorm.com';

// Content Security Policy (CSP) for the build.
// connect-src 'none' forbids the page any network requests:
// this is a technical guarantee that the user's files go nowhere.
// frame-src allows embedding only the sandbox — it runs in the browser and also uploads nothing.
// CSP is not added in development mode, so that Vite hot reload works.
function csp(sandboxOrigin: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    // On a broken manifest DOMParser creates <parsererror> with an inline style,
    // so inline style attributes are allowed (style-src-attr).
    // Styles cannot send anything to the network: the rules below forbid it.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'none'",
    "object-src 'none'",
    `frame-src ${sandboxOrigin}`,
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

function cspPlugin(sandboxOrigin: string): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp(sandboxOrigin)}" />`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const sandboxOrigin = env.VITE_SANDBOX_ORIGIN || DEFAULT_SANDBOX_ORIGIN;
  return {
    root: 'toolkit',
    base: '/toolkit/',
    envDir: '..',
    // Its own cache folder — see vite.sandbox.config.ts
    cacheDir: '../node_modules/.vite-toolkit',
    plugins: [cspPlugin(sandboxOrigin)],
    build: {
      outDir: '../dist-toolkit',
      emptyOutDir: true,
      target: 'es2022',
      // The modulepreload polyfill makes fetch requests — with connect-src 'none' it is not needed
      modulePreload: { polyfill: false },
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
  };
});
