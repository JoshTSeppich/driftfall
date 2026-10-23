import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildModel, triangles, LOOKS, createLab } from '../play/style-lab/lab.mjs';
for (const look of LOOKS) test(`${look}: real geometry builds with a stub renderer`, () => {
  const renderer = { render() {}, setSize() {}, dispose() {} };
  const lab = createLab({ renderer, width: 900, height: 600, look });
  for (const kind of ['crumb', 'popper', 'four-slice', 'zapper', 'flak-popper', 'mill', 'pump', 'churn', 'generator', 'ground-patches', 'power-strip', 'crystal', 'ground']) {
    const model = buildModel(kind, look, 'cyan');
    assert.ok(model instanceof THREE.Group);
    assert.ok(triangles(model) > 0);
    if (['crumb', 'popper', 'four-slice', 'zapper', 'flak-popper'].includes(kind)) assert.ok(triangles(model) < 300, `${kind}: ${triangles(model)}`);
    if (['mill','pump','churn','generator','ground-patches','power-strip'].includes(kind)) assert.ok(triangles(model) < 800);
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
  assert.equal(shards.geometry.userData.facets,5);
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

test('Zapper picker preserves the roster and heats coils before slot bolts fire', () => {
  const lab=createLab();
  lab.setShape('zapper');
  const z=lab.units.find(u=>u.name==='zapper');
  assert.ok(z);
  assert.ok(triangles(z)<300);
  const coil=z.getObjectByName('coil0'), bolt=z.getObjectByName('bolt0');
  lab.trigger('attack',0);lab.update(.12);
  assert.equal(bolt.visible,false);
  assert.equal(coil.material.emissive.getHex(),0xff7722);
  assert.ok(coil.material.emissiveIntensity>0.5);
  const heat=coil.material.emissiveIntensity;
  lab.update(.24);
  assert.equal(bolt.visible,true);
  assert.ok(bolt.position.y>bolt.userData.home.y);
  assert.ok(coil.material.emissiveIntensity<heat);
  lab.update(.7);assert.equal(bolt.visible,false);
  lab.trigger('idle',1);lab.update(1.1);lab.update(1.2);
  assert.ok(Math.abs(z.getObjectByName('lever').position.y-z.getObjectByName('lever').userData.home.y)>0);
  for(const look of LOOKS){lab.setLook(look);assert.ok(lab.units.some(u=>u.name==='zapper'));}
  lab.setShape('all');assert.equal(lab.units.length,10);
  lab.dispose();
});

test('Flak Popper aims its whole body back and launches vertical toast with spring recovery', () => {
  const lab=createLab();lab.setShape('flak-popper');
  const u=lab.units[0], flak=u.getObjectByName('flak0');
  assert.ok(triangles(u)<300);
  lab.trigger('idle',0);for(let i=0;i<30;i++)lab.update(i/60);
  assert.ok(u.position.y>0);
  assert.ok(Math.abs(u.getObjectByName('lever').position.y-u.getObjectByName('lever').userData.home.y)>0);
  lab.trigger('attack',1);for(let i=60;i<=76;i++)lab.update(i/60);
  assert.ok(u.rotation.x<-.1);assert.equal(flak.visible,true);
  const a=flak.getWorldPosition(new THREE.Vector3());
  lab.update(1.3);const b=flak.getWorldPosition(new THREE.Vector3());
  assert.ok(b.y>a.y);assert.ok(Math.abs(b.x-a.x)<1e-6);assert.ok(Math.abs(b.z-a.z)<1e-6);
  lab.update(1.8);assert.equal(flak.visible,false);
  lab.trigger('idle',2);for(let i=120;i<180;i++)lab.update(i/60);
  assert.ok(Math.abs(u.rotation.x)<.01);
  lab.trigger('move',3);const poses=[];for(let i=180;i<240;i++){lab.update(i/60);poses.push([u.position.x,u.position.y,u.scale.y]);}
  assert.ok(poses.some(p=>p[1]>.05));assert.ok(poses.some(p=>Math.abs(p[2]-1)>.02));
  assert.equal(poses[20][0],poses[23][0]);
  for(const look of LOOKS){lab.setLook(look);assert.equal(lab.units[0].name,'flak-popper');}
  lab.dispose();
});

 test('Five-Facet rule covers models, selection rings, sky and death effects within budgets', () => {
  for(const kind of ['crumb','popper','four-slice','zapper','flak-popper','mill','pump','churn','generator','ground-patches','power-strip','crystal','ground']) {
    const m=buildModel(kind);
    m.traverse(o=>{
      if(!o.isMesh)return;
      const geo=o.geometry, p=geo.parameters;
      if(p?.radialSegments!==undefined)assert.equal(p.radialSegments,5,kind);
      assert.notEqual(geo.type,'OctahedronGeometry',kind);
      if(geo.type==='ShapeGeometry')assert.equal(geo.userData.facets,5,kind);
    });
    assert.ok(triangles(m)<(['mill','pump','churn','generator','ground-patches','power-strip'].includes(kind)?800:kind==='ground'?800:300));
  }
  const lab=createLab();
  const rings=lab.scene.getObjectByName('selection-rings');assert.ok(rings);
  rings.traverse(o=>{if(o.isMesh)assert.equal(o.geometry.parameters.thetaSegments,5);});
  assert.equal(lab.scene.getObjectByName('death-facets').geometry.userData.facets,5);
  lab.dispose();
});

test('Mill has five pivoted parts, a turning five-facet stone and wheat-to-Flour grinding', () => {
  const lab=createLab();lab.setShape('mill');
  const m=lab.units[0];assert.equal(m.children.length,5);assert.ok(triangles(m)<800);
  const stone=m.getObjectByName('millstone'), wheat=m.getObjectByName('wheat'), flour=m.getObjectByName('flour');
  assert.equal(stone.geometry.parameters.radialSegments,5);
  lab.trigger('idle',0);for(let i=0;i<60;i++)lab.update(i/60);
  assert.ok(m.position.y>0);const idleAngle=stone.rotation.y;
  lab.trigger('grind',1);for(let i=60;i<=90;i++)lab.update(i/60);
  assert.ok(stone.rotation.y>idleAngle+.3);assert.ok(wheat.scale.y<wheat.userData.scale.y);
  assert.ok(flour.scale.y>0);assert.ok(flour.visible);
  lab.trigger('move',2);const poses=[];for(let i=120;i<180;i++){lab.update(i/60);poses.push([m.position.x,m.position.y,m.scale.y]);}
  assert.ok(poses.some(p=>p[1]>.05));assert.ok(poses.some(p=>Math.abs(p[2]-1)>.02));
  assert.equal(poses[34][0],poses[37][0]);
  for(const look of LOOKS){lab.setLook(look);lab.trigger('grind',3);lab.update(3.5);assert.equal(lab.units[0].name,'mill');}
  lab.dispose();
});

 test('Pump sits on river water with five rigid parts, spring piston and outlet flow', () => {
  const lab=createLab();lab.setShape('pump');
  const p=lab.units[0];assert.equal(p.children.length,5);assert.ok(triangles(p)<800);
  const piston=p.getObjectByName('piston'),pipe=p.getObjectByName('pipe'),flow=p.getObjectByName('outflow');
  assert.equal(pipe.geometry.parameters.radialSegments,5);
  const river=lab.scene.getObjectByName('river-tile');assert.ok(river);assert.ok(river.visible);
  lab.trigger('idle',0);for(let i=0;i<60;i++)lab.update(i/60);
  const idle=piston.position.y;assert.notEqual(idle,piston.userData.home.y);
  lab.trigger('pump',1);const strokes=[];
  for(let i=60;i<120;i++){lab.update(i/60);strokes.push(piston.position.y);}
  assert.ok(Math.max(...strokes)-Math.min(...strokes)>.15);assert.ok(flow.visible);
  lab.trigger('move',2);const poses=[];
  for(let i=120;i<180;i++){lab.update(i/60);poses.push([p.position.x,p.position.y,p.scale.y]);}
  assert.ok(poses.some(v=>v[1]>.05));assert.ok(poses.some(v=>Math.abs(v[2]-1)>.02));
  assert.equal(poses[34][0],poses[37][0]);
  assert.equal(river.position.x,p.position.x);assert.equal(river.position.z,p.position.z);
  for(const look of LOOKS){lab.setLook(look);assert.equal(lab.units[0].name,'pump');}
  lab.setTeam('orange');assert.equal(lab.units[0].getObjectByName('body').material.color.getHex(),0xff8a2a);
  lab.dispose();
});


test('Churn pumps a rigid plunger and handle, springs at idle and hops with planted pauses', () => {
  const lab=createLab();lab.setShape('churn');
  const u=lab.units[0];assert.equal(u.children.length,5);assert.ok(triangles(u)<800);
  const plunger=u.getObjectByName('plunger'), handle=u.getObjectByName('handle');
  assert.equal(u.getObjectByName('body').geometry.parameters.radialSegments,5);
  lab.trigger('idle',0);for(let i=0;i<60;i++)lab.update(i/60);
  assert.notEqual(plunger.position.y,plunger.userData.home.y);
  lab.trigger('churn',1);const strokes=[];
  for(let i=60;i<120;i++){
    lab.update(i/60);strokes.push(plunger.position.y);
    assert.ok(Math.abs((handle.position.y-handle.userData.home.y)-(plunger.position.y-plunger.userData.home.y))<1e-9);
  }
  assert.ok(Math.max(...strokes)-Math.min(...strokes)>.25);
  assert.ok(u.getObjectByName('butter').visible);
  lab.trigger('move',2);const poses=[];
  for(let i=120;i<180;i++){lab.update(i/60);poses.push([u.position.x,u.position.y,u.scale.y]);}
  assert.ok(poses.some(v=>v[1]>.05));assert.ok(poses.some(v=>Math.abs(v[2]-1)>.02));
  assert.equal(poses[34][0],poses[37][0]);
  for(const look of LOOKS){lab.setLook(look);lab.trigger('churn',3);lab.update(3.5);assert.equal(lab.units[0].name,'churn');}
  lab.setTeam('orange');assert.equal(lab.units[0].getObjectByName('body').material.color.getHex(),0xff8a2a);
  lab.dispose();
});

 test('Generator spins a five-facet wheel, springs, hops and glows as a dam in every look', () => {
  const lab=createLab();lab.setShape('generator');
  const u=lab.units[0], wheel=u.getObjectByName('wheel');
  assert.equal(u.children.length,5);assert.ok(triangles(u)<800);
  assert.equal(wheel.geometry.parameters.radialSegments,5);
  lab.trigger('idle',0);for(let i=0;i<60;i++)lab.update(i/60);
  const angle=wheel.rotation.z;assert.ok(angle>0);assert.ok(u.position.y>0);
  lab.trigger('generate',1);for(let i=60;i<120;i++)lab.update(i/60);
  assert.ok(wheel.rotation.z>angle+2);
  lab.trigger('move',2);const poses=[];
  for(let i=120;i<180;i++){lab.update(i/60);poses.push([u.position.x,u.position.y,u.scale.y]);}
  assert.ok(poses.some(v=>v[1]>.05));assert.ok(poses.some(v=>Math.abs(v[2]-1)>.02));
  assert.equal(poses[34][0],poses[37][0]);
  lab.setDam(true);
  for(const look of LOOKS){
    lab.setLook(look);lab.trigger('idle',3);lab.update(3.5);
    const rotor=lab.units[0].getObjectByName('wheel');
    assert.ok(rotor.material.emissiveIntensity>.5);
    assert.equal(rotor.material.emissive.getHex(),0x38e0ff);
    assert.ok(lab.scene.getObjectByName('river-tile').visible);
  }
  lab.setDam(false);lab.update(3.6);
  assert.equal(lab.scene.getObjectByName('river-tile').visible,false);
  assert.equal(lab.units[0].getObjectByName('wheel').material.emissiveIntensity,0);
  lab.setDam(true);lab.setTeam('orange');lab.update(3.7);
  assert.equal(lab.units[0].getObjectByName('wheel').material.emissive.getHex(),0xff8a2a);
  lab.dispose();
});

 test('Ground patches pair flat wheat and dairy with six rigid pivots and spring harvesting', () => {
  const lab=createLab();lab.setShape('ground-patches');
  const u=lab.units[0];assert.equal(u.children.length,6);assert.ok(triangles(u)<300);
  const wheat=u.getObjectByName('wheat-row0'), butter=u.getObjectByName('dairy-block0');
  const bounds=new THREE.Box3().setFromObject(u);
  assert.ok(bounds.max.y<.5);assert.ok(bounds.max.x-bounds.min.x>3);
  lab.trigger('idle',0);for(let i=0;i<60;i++)lab.update(i/60);
  assert.ok(Math.abs(wheat.rotation.z)>.001);
  lab.trigger('harvest',1);const angles=[];
  for(let i=60;i<120;i++){lab.update(i/60);angles.push(wheat.rotation.z);}
  assert.ok(Math.max(...angles)-Math.min(...angles)>.1);
  assert.notEqual(butter.position.y,butter.userData.home.y);
  lab.trigger('move',2);const poses=[];
  for(let i=120;i<180;i++){lab.update(i/60);poses.push([u.position.x,u.position.y,u.scale.y]);}
  assert.ok(poses.some(p=>p[1]>.05));assert.ok(poses.some(p=>Math.abs(p[2]-1)>.02));
  assert.equal(poses[34][0],poses[37][0]);
  for(const look of LOOKS){lab.setLook(look);assert.equal(lab.units[0].name,'ground-patches');}
  lab.setShape('all');assert.equal(lab.units.length,10);lab.dispose();
});
