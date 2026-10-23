// Toaster Wars on the play page (owner: sonnet): the default page is the territory match with power, ammo, bakery,
// fences and wrap on; the top bar is Wheat/Flour/Water/Toast/Power; no goods panel; toaster names in the teach text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toasterMode, toasterOptions, toasterTopBar, toasterPanel, PAGE_TITLE, missingIngredients } from '../play/toaster-play.mjs';
import { describe } from '../play/teach.mjs';
import { territoryPanel } from '../play/territory-wire.mjs';

const q = (s = '') => new URLSearchParams(s);

test('Toaster Wars is the default; ?classic=1 keeps the old page', () => {
  assert.equal(toasterMode(q('')), true);
  assert.equal(toasterMode(q('classic=1')), false);
  assert.equal(toasterOptions(q('classic=1')).createState, undefined);
  assert.equal(PAGE_TITLE, 'TOASTER WARS');
});

test('the match: Wheatfield Valley with power, ammo, bakery, fences and wrap on', () => {
  const s = toasterOptions(q('')).createState(7);
  assert.ok(s.territory && s.power && s.ammo && s.bakery && s.toast);
  assert.equal(s.power.fences, true);
  assert.equal(s.power.wrap, true);
  assert.ok(s.structures.some((x) => x.kind === 'core'));
});

test('top bar: Wheat Flour Water Toast Power, Supply, clock; no Shards/Flux/Alloy', () => {
  const s = toasterOptions(q('')).createState(7);
  const html = toasterTopBar(s, { side: 0 });
  for (const w of ['Wheat', 'Flour', 'Water', 'Toast', 'Power', 'Supply', '0:00']) assert.match(html, new RegExp(w));
  assert.doesNotMatch(html, /Shards|Flux|Alloy/);
});

test('a missing ingredient blinks; a stocked one does not', () => {
  const s = toasterOptions(q('')).createState(7);
  s.toast.pantry[0].flour = 0; s.toast.pantry[0].water = 3;
  assert.deepEqual(missingIngredients(s, 0), ['flour']);
  const html = toasterTopBar(s, { side: 0 });
  assert.match(html, /class="res blink"[^>]*title="[^"]*[Ff]lour/);
  assert.doesNotMatch(html, /class="res blink"[^>]*>Water/);
  s.toast.pantry[0].flour = 2;
  assert.deepEqual(missingIngredients(s, 0), []);
});

test('side panel has no Trading House goods and no Flux/Alloy rows', () => {
  const s = toasterOptions(q('')).createState(7);
  const html = toasterPanel(s, 0);
  assert.doesNotMatch(html, /Trading House|glowmoss|stormglass|quakestone|ironroot|amberlight|Flux|Alloy|Shards/);
  assert.match(html, /Tier/);
  assert.match(territoryPanel(s, 0), /Flux/); // the classic panel is untouched
});

test('teach text uses toaster names and Wheat', () => {
  const crumb = describe({ kind: 'worker', label: 'Crumb', action: 'train', cost: 50 });
  assert.match(crumb.sentence, /wheat/i);
  assert.doesNotMatch(crumb.title, /Shards/);
  const strip = describe({ kind: 'core', label: 'Power Strip', action: 'train' }).sentence;
  assert.match(strip, /Power Strip/);
  assert.doesNotMatch(strip, /Core/);
  assert.match(describe({ kind: 'mill', label: 'Mill', action: 'build' }).sentence, /flour/i);
  assert.match(describe({ kind: 'toaster', label: 'Toaster', action: 'build' }).sentence, /toast/i);
});
