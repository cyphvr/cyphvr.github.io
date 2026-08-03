/**
 * Backend API base URL (Cloudflare Worker).
 *
 * After `npm run deploy`, wrangler prints a URL like:
 *   https://cyphvr-github-io.<your-subdomain>.workers.dev
 * Set API_BASE to that origin (no trailing slash).
 *
 * Custom domain option (Cloudflare dashboard → Workers → Triggers → Custom Domains):
 *   export const API_BASE = 'https://api.cyphvr.xyz';
 */
export const API_BASE = 'https://cyphvr-github-io.jzhu4863.workers.dev';
