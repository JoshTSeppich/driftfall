// Secrets, private-file and file-type scan for a shipped folder (owner: haiku, security gate G4).
//
// scanTree(dir) walks every file under dir and returns a list of findings, empty when the folder is clean.
// It reads .gz and .br copies by decompressing them, so a secret cannot hide in a compressed twin. It never runs
// anything it finds. Use it on dist/ before a public release (tests/security-gate.test.mjs does this on a fresh build).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Files and folders that must never ship, matched against the path relative to the shipped folder.
export const FORBIDDEN_PATH = /(^|\/)(tests|\.sandbox|\.sandbox-qa|\.git|\.github|\.claude|__airpull|scratch-haiku|roles|channel\.jsonl|say\.mjs|read\.mjs)(\/|$)|(^|\/)\.(env|DS_Store)(\.|$)|\.test\.mjs$|\.log$|(^|\/)(TERRITORY|LAUNCH|SECURITY|PLAN|PLAYTEST|TEST-PLAN|MILESTONES|CHANGELOG|STANDUPS|BUGS|PERF|MISSION|UNITS|VISUAL-3D|ART-GUIDE|ENV-SPEC|ENV-SPEC-v3-draft|CLASSIC|PLAN-v3-draft)\.(md|json)$/;

// Text patterns that look like credentials or personal data. Each one names what it found.
export const SECRET_PATTERNS = [
  ['anthropic-key', /sk-ant-[A-Za-z0-9_-]{8,}/],
  ['github-token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/],
  ['aws-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['slack-token', /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  ['private-key', /-----BEGIN (RSA |OPENSSH |EC |DSA |)?PRIVATE KEY-----/],
  ['home-path', /\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\//],
  ['personal-email', /\baetherx\.io\b|\bjosh@/i],
];

// The asset and code types we accept, and the first bytes each binary type must start with.
export const ALLOWED_EXT = new Set(['mjs', 'js', 'json', 'html', 'css', 'png', 'jpg', 'jpeg', 'webp', 'glb', 'ogg', 'wav', 'ttf', 'gz', 'br', 'map', 'txt', '']);
const MAGIC = {
  png: [[0x89, 0x50, 0x4e, 0x47]],
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  webp: [[0x52, 0x49, 0x46, 0x46]],
  glb: [[0x67, 0x6c, 0x54, 0x46]],
  ogg: [[0x4f, 0x67, 0x67, 0x53]],
  wav: [[0x52, 0x49, 0x46, 0x46]],
  ttf: [[0x00, 0x01, 0x00, 0x00], [0x74, 0x72, 0x75, 0x65]],
};
const TEXT_EXT = new Set(['mjs', 'js', 'json', 'html', 'css', 'map', 'txt', 'md', '']);

function walk(dir, rel = '', out = []) {
  for (const name of fs.readdirSync(path.join(dir, rel))) {
    const r = rel ? `${rel}/${name}` : name;
    const st = fs.lstatSync(path.join(dir, r));
    if (st.isSymbolicLink()) out.push({ rel: r, symlink: true });
    else if (st.isDirectory()) walk(dir, r, out);
    else if (st.isFile()) out.push({ rel: r });
  }
  return out;
}

const extOf = (rel) => {
  const base = rel.split('/').pop();
  const m = /\.([A-Za-z0-9]+)$/.exec(base);
  return m ? m[1].toLowerCase() : '';
};

// The bytes a file really holds, with .gz and .br copies opened so their text can be checked too.
function contentOf(buf, ext) {
  if (ext === 'gz') return zlib.gunzipSync(buf);
  if (ext === 'br') return zlib.brotliDecompressSync(buf);
  return buf;
}

export function scanTree(dir) {
  const findings = [];
  for (const { rel, symlink } of walk(dir)) {
    if (symlink) { findings.push({ file: rel, rule: 'symlink', detail: 'links can point outside the folder' }); continue; }
    if (FORBIDDEN_PATH.test(rel)) { findings.push({ file: rel, rule: 'forbidden-file', detail: 'must not ship' }); continue; }
    const ext = extOf(rel);
    if (!ALLOWED_EXT.has(ext)) { findings.push({ file: rel, rule: 'file-type', detail: `.${ext} is not an allowed type` }); continue; }
    let buf;
    try { buf = contentOf(fs.readFileSync(path.join(dir, rel)), ext); } catch (e) {
      findings.push({ file: rel, rule: 'unreadable', detail: e.message }); continue;
    }
    if (MAGIC[ext] && !MAGIC[ext].some((sig) => sig.every((b, i) => buf[i] === b))) {
      findings.push({ file: rel, rule: 'magic-bytes', detail: `content is not a real .${ext}` });
    }
    if (TEXT_EXT.has(ext) || (ext === 'gz' || ext === 'br')) {
      const text = buf.toString('utf8');
      for (const [rule, re] of SECRET_PATTERNS) {
        if (re.test(text)) findings.push({ file: rel, rule, detail: 'matches a credential or personal-data pattern' });
      }
    }
  }
  return findings;
}
