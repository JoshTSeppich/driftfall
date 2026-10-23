// Toaster art for the HUD (owner: sonnet): portraits drawn from play/toaster-models.mjs and blocky building icons,
// as cached SVG data URLs, so the selection panel and the command card stop showing the old snake pictures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toasterPortraitSvg, structureIconSvg, actionIconSvg, toasterArt, UNIT_ART_KINDS, STRUCTURE_ART_KINDS } from '../play/toaster-art.mjs';
import { portraitFor, iconFor, iconHtml, setArtProvider } from '../play/icons.mjs';
import { portraitSvg } from '../play/hud.mjs';
import { TOASTER_KINDS } from '../play/toaster-models.mjs';
import { renderCard } from '../play/command-card.mjs';

const dec = (url) => decodeURIComponent(url.replace(/^data:image\/svg\+xml;utf8,/, ''));

test('every toaster kind has a portrait: ink outlines, the face, cyan eyes, and the team colour per owner', () => {
  for (const k of TOASTER_KINDS) {
    const a = toasterPortraitSvg(k, 0), b = toasterPortraitSvg(k, 1);
    assert.match(a, /^<svg /); assert.match(a, /<\/svg>$/);
    assert.match(a, /stroke="#1d1a14"/, `${k} has ink outlines`);
    assert.match(a, /#12E4FF/i, `${k} has glowing eyes`);
    assert.notEqual(a, b, `${k}: the two teams differ`);
  }
  assert.match(toasterPortraitSvg('crumb', 0), /#12D8F0/i);
  assert.match(toasterPortraitSvg('crumb', 1), /#FF7A2E/i);
});

test('sim kinds map to toaster portraits (worker -> Crumb) and the art is cached', () => {
  assert.equal(toasterArt.portrait('worker', 0), toasterArt.portrait('crumb', 0));
  assert.equal(toasterArt.portrait('grunt', 0), toasterArt.portrait('grunt', 0), 'cached');
  assert.match(toasterArt.portrait('howler', 1), /^data:image\/svg\+xml;utf8,/);
});

test('every building the page can show has an icon, and they differ', () => {
  const seen = new Set();
  for (const k of STRUCTURE_ART_KINDS) {
    const s = structureIconSvg(k, 0);
    assert.match(s, /^<svg /); seen.add(s);
  }
  assert.deepEqual([...STRUCTURE_ART_KINDS].sort(), ['core', 'forge', 'mill', 'turret', 'toaster', 'well'].sort());
  assert.equal(seen.size, STRUCTURE_ART_KINDS.length);
  for (const a of ['amove', 'stop', 'hold', 'move', 'rally']) assert.match(actionIconSvg(a), /^<svg /);
});

test('the art provider replaces the snake icons and portraits on the HUD', () => {
  assert.match(portraitFor('grunt') ?? '', /fang\.png/, 'classic keeps the old art');
  setArtProvider(toasterArt);
  try {
    assert.match(portraitFor('grunt', 0), /^data:image\/svg\+xml/);
    assert.match(iconFor('mill'), /^data:image\/svg\+xml/);
    assert.match(iconFor('amove'), /^data:image\/svg\+xml/);
    assert.doesNotMatch(portraitSvg('worker', 0), /snakenators|siphoner/);
    assert.match(iconHtml('well', 'Well'), /<img /);
    assert.match(dec(portraitFor('core', 1)), /<svg/);
  } finally { setArtProvider(null); }
  assert.match(portraitFor('grunt') ?? '', /fang\.png/);
});

test('the command card shows each name once with its cost and hotkey (no "well well")', () => {
  setArtProvider(toasterArt);
  try {
    const card = [
      { key: 'l', label: 'Mill', kind: 'mill', action: 'build', cost: 75 },
      { key: 'w', label: 'Well', kind: 'well', action: 'build', cost: 50 },
      { key: 't', label: 'Toaster', kind: 'toaster', action: 'build', cost: 100 },
    ];
    const html = renderCard(card, { shards: 500 });
    for (const n of ['Mill', 'Well', 'Toaster']) assert.equal((html.match(new RegExp(`>${n}<`, 'g')) ?? []).length, 1, `${n} appears once`);
    assert.match(html, /<kbd[^>]*>L<\/kbd>/);
    assert.match(html, /<small>75<\/small>/);
    assert.equal((html.match(/<img /g) ?? []).length, 3);
  } finally { setArtProvider(null); }
});

test('unit art kinds cover the whole roster', () => {
  for (const k of ['worker', 'grunt', 'lancer', 'brute', 'howler', 'spiker', 'dart']) assert.ok(UNIT_ART_KINDS.includes(k), k);
});

test('Toaster Wars card: proper names, costs and clean hotkeys; the old "forge" word is gone', async () => {
  const { createInput } = await import('../play/input.mjs');
  const { TOASTER_HOTKEYS, toasterInputOptions } = await import('../play/toaster-play.mjs');
  const { STATS } = await import('../env/stats.mjs');
  const { createToasterState } = await import('../play/toaster-play.mjs');
  const { kindName } = await import('../play/hud.mjs');
  const s = createToasterState(7);
  const input = createInput({ side: 0, stats: STATS, ...toasterInputOptions() });
  const crumb = s.units.find((u) => u.owner === 0 && u.kind === 'worker');
  input.ui.selection = [crumb.id];
  const card = input.commandCard(s);
  const builds = card.filter((c) => c.action === 'build');
  assert.deepEqual(builds.map((c) => kindName(c.kind)).sort(), ['Assembly Line', 'Heat Lamp', 'Mill', 'Toaster', 'Well']);
  assert.equal(new Set(card.map((c) => c.key)).size, card.length, 'no two buttons share a key');
  for (const b of builds) { assert.ok(b.cost > 0); assert.equal(b.key, TOASTER_HOTKEYS[b.kind]); }
  const html = renderCard(card, { shards: 999 });
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');   // what the player reads (alt text and titles aside)
  assert.doesNotMatch(text, /forge|turret/i);
  assert.doesNotMatch(text, /well well|mill mill|toaster toaster/i);
  assert.doesNotMatch(html, /title="[^"]*(forge|turret)/i);
});
