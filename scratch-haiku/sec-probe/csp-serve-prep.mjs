// Build dist into a temp folder, add the CSP meta tag to its index.html, so a browser can check the page under the policy.
import fs from 'node:fs';
import path from 'node:path';
import { build } from '/Users/joshuatseppich/dev/rts/scripts/build.mjs';
import { injectMeta, policyFor } from '/Users/joshuatseppich/dev/rts/security/csp.mjs';

const out = '/tmp/haiku-csp-dist';
fs.rmSync(out, { recursive: true, force: true });
await build({ root: '/Users/joshuatseppich/dev/rts', out, quiet: true });
const file = path.join(out, 'index.html');
const html = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file, injectMeta(html, policyFor(html)));
console.log('prepared', out);
