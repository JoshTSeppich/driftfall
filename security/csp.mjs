// Content Security Policy for the hosted play page (owner: haiku, security gate G4).
//
// The policy is built from the final dist/index.html, so the hashes match the bytes the browser sees (the build
// rewrites ../ paths inside the inline module). Scripts: same-origin files plus two inline blocks, pinned by hash
// (the import map and the boot module). No 'unsafe-inline' and no 'unsafe-eval' for scripts. Styles: the page's one
// <style> block is pinned by hash; style="" attributes written by the HUD code cannot be hashed, so style-src-attr
// alone allows them. An inline style attribute cannot run script.
import crypto from 'node:crypto';

// The exact text between <script> and </script> (or <style> and </style>) for every inline block without a src.
export function inlineBlocks(html) {
  const scripts = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\bsrc\s*=/i.test(m[1])) scripts.push(m[2]);
  }
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1]);
  return { scripts, styles };
}

export const sha256Source = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;

// Directives in the order they are written. Anything not listed falls back to 'none'.
export function policyFor(html) {
  const { scripts, styles } = inlineBlocks(html);
  const scriptSrc = ["'self'", ...scripts.map(sha256Source)];
  const styleElem = ["'self'", ...styles.map(sha256Source)];
  const directives = [
    ['default-src', "'none'"],
    ['script-src', scriptSrc.join(' ')],
    ['style-src-elem', styleElem.join(' ')],
    ['style-src-attr', "'unsafe-inline'"],
    ['img-src', "'self' blob: data:"],
    ['media-src', "'self' blob:"],
    ['font-src', "'self'"],
    ['connect-src', "'self'"],
    ['worker-src', "'none'"],
    ['frame-src', "'none'"],
    ['object-src', "'none'"],
    ['base-uri', "'none'"],
    ['form-action', "'none'"],
  ];
  return directives.map(([name, value]) => `${name} ${value}`).join('; ');
}

// For a host that reads response headers (_headers files). frame-ancestors only works as a header, not in a meta tag.
export const headerPolicyFor = (html) => `${policyFor(html)}; frame-ancestors 'none'`;

// For hosts with no header control: a meta tag placed first in <head>. Browsers apply it to the rest of the page.
export function injectMeta(html, policy = policyFor(html)) {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  return html.replace(/<head>/i, (head) => `${head}\n${tag}`);
}

// Other response headers for the same host (the hashed folder is cached forever; the page itself is not).
export const SECURITY_HEADERS = [
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'no-referrer'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
];
