import { defineConfig, type Plugin } from "vite";

/**
 * Content-Security-Policy for the production build. `connect-src 'none'` makes the browser itself refuse
 * any fetch, XHR, WebSocket or beacon, so the claim "your file never leaves the browser" is enforced, not just promised.
 * Not applied in dev: the Vite dev server needs a WebSocket and inline helpers.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // the report is rendered from a string with inline styles
  "img-src 'self' data:",
  "connect-src 'none'",
  "frame-src 'self' about:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

function csp(): Plugin {
  return {
    name: "dq-profiler-csp",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" }],
  };
}

export default defineConfig({
  // Relative asset paths so the build works from any sub-path (e.g. embedded under /narzedzia/).
  base: "./",
  plugins: [csp()],
});
