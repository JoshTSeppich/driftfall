import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildModel, triangles, LOOKS, createLab } from '../play/style-lab/lab.mjs';
for (const look of LOOKS) test(`${look}: real geometry builds with a stub renderer`, () => {
  const renderer = { render() {}, setSize() {}, dispose() {} };
  const lab = createLab({ renderer, width: 900, height: 600, look });
  for (const kind of ['crumb', 'popper', 'four-slice', 'power-strip', 'crystal', 'ground']) {
    const model = buildModel(kind, look, 'cyan');
    assert.ok(model instanceof THREE.Group);
    assert.ok(triangles(model) > 0);
    if (['crumb', 'popper', 'four-slice'].includes(kind)) assert.ok(triangles(model) < 300, `${kind}: ${triangles(model)}`);
    if (kind === 'power-strip') assert.ok(triangles(model) < 800);
  }
  for (const action of lab.actions) { lab.trigger(action, 0); for (let t = 0; t <= 4; t += 0.016) lab.update(t); }
  lab.setTeam('orange'); lab.setLook(look); lab.setStress(true); lab.update(5);
  assert.equal(lab.stressCount, 200);
  assert.ok(lab.scene.children.some(x => x.isLight));
  lab.dispose();
});
test('action curves settle, gathering fills then delivers, death resets on spawn', () => {
  const lab = createLab({ renderer: { render() {}, dispose() {} } });
  lab.trigger('gather', 0); lab.update(.5); assert.ok(lab.fill > 0);
  lab.update(3.9); assert.equal(lab.fill, 0);
  lab.trigger('death', 4); lab.update(4.5); assert.equal(lab.units[0].visible, false);
  lab.trigger('spawn', 5); lab.update(5.5); assert.equal(lab.units[0].visible, true);
  lab.dispose();
});

test('death uses a capped flat-facet pool; stress geometry uses spring hops', () => {
  const lab=createLab({renderer:{render(){}}});
  lab.trigger('death',0);lab.update(.15);
  const shards=lab.scene.getObjectByName('death-facets');
  assert.ok(shards.isInstancedMesh);assert.equal(shards.count,16);
  assert.equal(shards.geometry.attributes.position.count,3);
  assert.ok(shards.visible);lab.update(.6);assert.equal(shards.visible,false);
  lab.setStress(true);assert.equal(lab.scene.getObjectByName('stress-bots').userData.springHops,true);
  lab.dispose();
});
test('browser module imports without a DOM', async () => { await import('../play/style-lab/app.mjs'); });
test('gloss includes translucent plastic and reflective chrome', () => {
  const model=buildModel('crumb',LOOKS[2]);
  assert.ok(model.getObjectByName('body').material.transparent);
  assert.ok(model.getObjectByName('helmet').material.metalness>.8);
});

test('toaster rig has slots, secondary springs and weighted suspension', () => {
  for(const kind of ['crumb','popper','four-slice']) {
    const m=buildModel(kind);
    assert.equal(m.children.filter(p=>p.name.startsWith('toast')).length,kind==='four-slice'?4:2);
    for(const name of ['lever','helmet','visor','dent']) assert.ok(m.getObjectByName(name));
  }
  const lab=createLab();lab.trigger('move',0);
  for(let i=0;i<60;i++)lab.update(i/60);
  assert.ok(lab.units.every(u=>Number.isFinite(u.position.y)));
  assert.ok(lab.units.some(u=>Math.abs(u.scale.y-1)>.001));
  assert.ok(lab.actions.includes('deliver'));lab.dispose();
});
