// The flow panel: income, upkeep, net and the bank, with debt in red (TERRITORY.md section 8 and 9). Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flowRows, renderFlow, fmtSigned, WEARY_BELOW } from './flow-panel.mjs';

test('fmtSigned shows a sign on every non-zero number and whole numbers only', () => {
  assert.equal(fmtSigned(120), '+120');
  assert.equal(fmtSigned(-40), '-40');
  assert.equal(fmtSigned(0), '0');
  assert.equal(fmtSigned(12.6), '+13');
  assert.equal(fmtSigned(-0.2), '0');
});

test('rows: Shards net is income minus upkeep, Flux and Alloy as their own rows', () => {
  const rows = flowRows({ income: { shards: 180, flux: 40, alloy: 6 }, upkeep: { shards: 60, flux: 10 }, bank: 300 });
  const shards = rows.find((r) => r.key === 'shards');
  assert.equal(shards.income, 180);
  assert.equal(shards.upkeep, 60);
  assert.equal(shards.net, 120);
  const flux = rows.find((r) => r.key === 'flux');
  assert.equal(flux.net, 30);
  const alloy = rows.find((r) => r.key === 'alloy');
  assert.equal(alloy.income, 6);
  assert.equal(alloy.net, 6);
});

test('a net below zero is flagged negative (red); a bank in debt is flagged debt', () => {
  const rows = flowRows({ income: { shards: 50 }, upkeep: { shards: 90 }, bank: -80 });
  assert.equal(rows.find((r) => r.key === 'shards').net, -40);
  assert.equal(rows.find((r) => r.key === 'shards').negative, true);
  const html = renderFlow({ income: { shards: 50 }, upkeep: { shards: 90 }, bank: -80 });
  assert.match(html, /class="net neg"[^>]*>-40</);
  assert.match(html, /class="bank debt"[^>]*>Debt -80 S</);
  assert.doesNotMatch(html, /weary/);
});

test('a bank in the black is shown plainly, with no debt or weary marks', () => {
  const html = renderFlow({ income: { shards: 200 }, upkeep: { shards: 20 }, bank: 150 });
  assert.match(html, /class="bank"[^>]*>150 S</);
  assert.doesNotMatch(html, /debt|weary|neg/);
});

test('deep debt below -500 S also shows Weary', () => {
  assert.equal(WEARY_BELOW, -500);
  const html = renderFlow({ income: {}, upkeep: {}, bank: -501 });
  assert.match(html, /class="weary"/);
  assert.match(html, /Weary/);
  assert.doesNotMatch(renderFlow({ income: {}, upkeep: {}, bank: -500 }), /weary/);
});

test('missing numbers count as zero and the output is safe HTML', () => {
  const html = renderFlow({});
  assert.match(html, /Shards\/min/);
  assert.match(html, /Flux\/min/);
  assert.match(html, /Alloy\/min/);
  assert.doesNotMatch(html, /NaN|undefined/);
});
