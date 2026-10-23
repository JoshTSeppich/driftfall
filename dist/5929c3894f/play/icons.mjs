// Paths are relative to this module, so live play and edition copies use the same assets.
// A null manifest entry deliberately uses text until matching hand-drawn art exists.
import manifest from '../assets/icons/snakenators/manifest.json' with { type: 'json' };
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function iconFor(id) {
  const file = Object.hasOwn(manifest, id) ? manifest[id] : null;
  return file ? new URL(`../assets/icons/snakenators/${file}`, import.meta.url).href : null;
}
const portraits = Object.freeze({worker:'siphoner',siphoner:'siphoner',grunt:'fang',fang:'fang',lancer:'spitter',spitter:'spitter',brute:'constrictor',constrictor:'constrictor',spiker:'hisser',hisser:'hisser',howler:'boomslang',boomslang:'boomslang'});
export function portraitFor(kind) {
  const name = Object.hasOwn(portraits, kind) ? portraits[kind] : null;
  return name ? new URL(`../assets/portraits/${name}.png`, import.meta.url).href : null;
}
export function iconHtml(id, label = id, size = 30) {
  const url = iconFor(id) ?? portraitFor(id);
  return url ? `<img class="command-icon" src="${esc(url)}" width="${size}" height="${size}" alt="${esc(label)}">`
    : `<span class="glyph icon-fallback">${esc(label)}</span>`;
}
