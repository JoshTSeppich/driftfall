import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { STATS } from '../env/stats.mjs';
import { iconFor, portraitFor, iconHtml } from '../play/icons.mjs';
import { renderCard } from '../play/command-card.mjs';
import { renderSelectionPanel } from '../play/hud.mjs';
const manifestURL = new URL('../assets/icons/snakenators/manifest.json', import.meta.url);
test('manifest covers game IDs and every art file exists', () => {
  const manifest = JSON.parse(readFileSync(manifestURL));
  for (const id of ['amove','stop','hold','move','rally','build','train', ...STATS.upgrades.map(u => u.id), ...Object.keys(STATS.resources)]) assert.ok(Object.hasOwn(manifest,id), id);
  for (const [id,file] of Object.entries(manifest)) {
    if (file !== null) assert.ok(existsSync(new URL(file,manifestURL)),id);
    assert.equal(typeof iconHtml(id), 'string');
  }
});
test('every card command has art or readable fallback, with hotkeys retained', () => {
  const entries = ['amove','stop','hold','move','rally'].map(action => ({action,key:'q',label:action}));
  for (const [action,kinds] of [['build',STATS.structures],['train',STATS.units]]) for (const kind of Object.keys(kinds)) entries.push({action,kind,key:'q',label:kind});
  for (const entry of entries) {
    const html = renderCard([entry]);
    assert.match(html, /<kbd[^>]*>Q<\/kbd>/);
    assert.ok(html.includes('<img') || html.includes('icon-fallback'), JSON.stringify(entry));
  }
  assert.equal(iconFor('missing'), null);
  assert.match(iconHtml('<missing>'), /&lt;missing&gt;/);
});
test('six square portraits resolve both names and game roles', () => {
  for (const name of ['siphoner','fang','spitter','constrictor','hisser','boomslang']) {
    const bytes = readFileSync(new URL(portraitFor(name)));
    assert.equal(bytes.readUInt32BE(16),256);
    assert.equal(bytes.readUInt32BE(20),256);
  }
  assert.equal(portraitFor('worker'),portraitFor('siphoner'));
  assert.equal(portraitFor('grunt'),portraitFor('fang'));
  assert.equal(portraitFor('unknown'),null);
  assert.match(renderSelectionPanel({},[{kind:'worker',owner:0,hp:40}],{side:0}), /siphoner.png/);
});
