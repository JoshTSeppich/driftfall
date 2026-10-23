// Paths are relative to this module, so live play and edition copies use the same assets.
// A null manifest entry deliberately uses text until matching hand-drawn art exists.
// Toaster Wars installs an art provider (play/toaster-art.mjs) with setArtProvider(); while one is set, every icon and
// portrait comes from it and the old snake pictures are never used. ?classic=1 never installs one.
import manifest from '../assets/icons/snakenators/manifest.json' with { type: 'json' };
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let art = null;
/** provider: { portrait(kind, owner) -> url | null, icon(id) -> url | null }, or null for the classic art. */
export function setArtProvider(provider) { art = provider ?? null; }
export function iconFor(id) {
  if (art) return art.icon(id) ?? null;
  const file = Object.hasOwn(manifest, id) ? manifest[id] : null;
  return file ? new URL(`../assets/icons/snakenators/${file}`, import.meta.url).href : null;
}
const portraits = Object.freeze({worker:'siphoner',siphoner:'siphoner',grunt:'fang',fang:'fang',lancer:'spitter',spitter:'spitter',brute:'constrictor',constrictor:'constrictor',spiker:'hisser',hisser:'hisser',howler:'boomslang',boomslang:'boomslang'});
export function portraitFor(kind, owner = 0) {
  if (art) return art.portrait(kind, owner) ?? null;
  const name = Object.hasOwn(portraits, kind) ? portraits[kind] : null;
  return name ? new URL(`../assets/portraits/${name}.png`, import.meta.url).href : null;
}
export function iconHtml(id, label = id, size = 30) {
  const url = iconFor(id) ?? portraitFor(id);
  return url ? `<img class="command-icon" src="${esc(url)}" width="${size}" height="${size}" alt="${esc(label)}">`
    : `<span class="glyph icon-fallback">${esc(label)}</span>`;
}
