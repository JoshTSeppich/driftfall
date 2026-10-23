import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildModel, triangles, LOOKS, SHAPES, createLab } from '../play/style-lab/lab.mjs';
for (const look of LOOKS) test(`${look}: real geometry builds with a stub renderer`, () => {
  const renderer = { render() {}, setSize() {}, dispose() {} };
  const lab = createLab({ renderer, width: 900, height: 600, look });
  for (const kind of ['attack-specialists', 'attack-four-slice', 'attack-zapper', 'attack-popper', 'toppings', 'thought-moods', 'toast-stacks', 'grudge-kettle', 'crumb', 'popper', 'four-slice', 'zapper', 'flak-popper', 'turret', 'trading-house', 'press', 'track', 'drill', 'toaster-oven', 'outlet', 'smoke-alarm', 'breadbox', 'flying-toast', 'timer', 'cold-toast', 'defroster', 'bagel', 'broiler', 'mill', 'pump', 'churn', 'generator', 'ground-patches', 'power-strip', 'cords-power', 'crystal', 'ground']) {
    const model = buildModel(kind, look, 'cyan');
    assert.ok(model instanceof THREE.Group);
    assert.ok(triangles(model) > 0);
    if (['attack-specialists', 'attack-four-slice', 'attack-zapper', 'attack-popper', 'grudge-kettle', 'crumb', 'popper', 'four-slice', 'zapper', 'flak-popper','smoke-alarm','breadbox', 'breadbox','flying-toast','timer', 'timer','cold-toast','defroster','bagel','broiler'].includes(kind)) assert.ok(triangles(model) <= 60, `${kind}: ${triangles(model)}`);
    if (['toast-stacks', 'turret', 'trading-house', 'press', 'track', 'drill', 'toaster-oven', 'outlet','mill','pump','churn','generator','ground-patches','power-strip','cords-power'].includes(kind)) assert.ok(triangles(model) < 800);
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
test('Bible rigs have exact pivots, cream chassis and shoulder-only team paint', () => {
  for(const [kind,count] of [['crumb',4],['popper',5],['zapper',6],['four-slice',6],['power-strip',4]]) for(const look of LOOKS){
    const u=buildModel(kind,look,'orange');
    assert.equal(u.children.length,count,kind);
    assert.equal(u.getObjectByName('body').material.color.getHex(),0xf2d7a6);
    assert.equal(u.getObjectByName('shoulder').material.color.getHex(),0xff8540);
    for(const name of ['faceplate','eye-left','eye-right','brow','slot0'])assert.ok(u.getObjectByName(name),kind+name);
    assert.ok(triangles(u)<(kind==='power-strip'?800:300));
  }
});
test('Bible motion is rigid, feet snap up, landing pops toast and expressions change',()=>{
  const lab=createLab();lab.setShape('popper');const u=lab.units[0];
  lab.trigger('move',0);lab.update(.1);
  assert.equal(u.scale.y,1);assert.ok(u.rotation.x<0);
  assert.ok(u.getObjectByName('foot-left').position.y>.1);
  lab.update(.34);assert.ok(u.getObjectByName('toast0').position.y>u.getObjectByName('toast0').userData.home.y);
  lab.setExpression('alarmed');lab.update(.4);assert.equal(u.userData.expression,'alarmed');
  lab.setShape('power-strip');assert.equal(lab.units[0].name,'power-strip');
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
  for(const kind of ['toppings', 'thought-moods', 'toast-stacks', 'grudge-kettle','crumb','popper','four-slice','zapper','flak-popper', 'turret', 'trading-house', 'press', 'track', 'drill', 'toaster-oven', 'outlet', 'smoke-alarm', 'breadbox', 'flying-toast', 'timer', 'cold-toast', 'defroster', 'bagel', 'broiler','mill','pump','churn','generator','ground-patches','power-strip','crystal','ground']) {
    const m=buildModel(kind);
    m.traverse(o=>{
      if(!o.isMesh)return;
      const geo=o.geometry, p=geo.parameters;
      if(p?.radialSegments!==undefined)assert.equal(p.radialSegments,5,kind);
      assert.notEqual(geo.type,'OctahedronGeometry',kind);
      if(geo.type==='ShapeGeometry'&&!geo.userData.flatPanel)assert.equal(geo.userData.facets,5,kind);
    });
    assert.ok(triangles(m)<(['toast-stacks', 'turret', 'trading-house', 'press', 'track', 'drill', 'toaster-oven', 'outlet','mill','pump','churn','generator','ground-patches','power-strip','cords-power'].includes(kind)?800:kind==='ground'?800:300));
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
  assert.equal(stone.geometry.type,'BoxGeometry');
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
  assert.equal(pipe.geometry.type,'BoxGeometry');
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
  lab.setTeam('orange');assert.equal(lab.units[0].getObjectByName('body').material.color.getHex(),0xf2d7a6);
  lab.dispose();
});


test('Churn pumps a rigid plunger and handle, springs at idle and hops with planted pauses', () => {
  const lab=createLab();lab.setShape('churn');
  const u=lab.units[0];assert.equal(u.children.length,5);assert.ok(triangles(u)<800);
  const plunger=u.getObjectByName('plunger'), handle=u.getObjectByName('handle');
  assert.equal(u.getObjectByName('body').geometry.type,'BoxGeometry');
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
  lab.setTeam('orange');assert.equal(lab.units[0].getObjectByName('body').material.color.getHex(),0xf2d7a6);
  lab.dispose();
});

 test('Generator spins a five-facet wheel, springs, hops and glows as a dam in every look', () => {
  const lab=createLab();lab.setShape('generator');
  const u=lab.units[0], wheel=u.getObjectByName('wheel');
  assert.equal(u.children.length,5);assert.ok(triangles(u)<800);
  assert.equal(wheel.geometry.type,'BoxGeometry');
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
  lab.setShape('all');assert.equal(lab.units.length,SHAPES.length);lab.dispose();
});

 test('Broiler deploys a spring hinge and lobs burning toast from planted siege legs', () => {
  const lab=createLab();lab.setShape('broiler');const u=lab.units[0];
  assert.equal(u.children.length,6);assert.ok(triangles(u)<300);
  const door=u.getObjectByName('door'), toast=u.getObjectByName('siege-toast'), flame=u.getObjectByName('flame');
  lab.trigger('idle',0);for(let i=0;i<60;i++)lab.update(i/60);
  assert.ok(u.position.y>0);assert.equal(toast.visible,false);
  lab.trigger('siege',1);for(let i=60;i<=82;i++)lab.update(i/60);
  assert.ok(door.rotation.x>1);assert.equal(toast.visible,true);assert.equal(flame.visible,true);
  const a=toast.getWorldPosition(new THREE.Vector3());lab.update(1.48);const b=toast.getWorldPosition(new THREE.Vector3());
  assert.ok(b.y>a.y);assert.ok(b.z>a.z);lab.update(1.8);const c=toast.getWorldPosition(new THREE.Vector3());assert.ok(c.y<b.y);
  lab.update(2.05);assert.equal(toast.visible,false);
  lab.trigger('idle',3);for(let i=180;i<240;i++)lab.update(i/60);assert.ok(Math.abs(door.rotation.x)<.01);
  lab.trigger('move',4);const poses=[];for(let i=240;i<300;i++){lab.update(i/60);poses.push([u.position.x,u.position.y,u.scale.y]);}
  assert.ok(poses.some(p=>p[1]>.05));assert.ok(poses.some(p=>Math.abs(p[2]-1)>.02));assert.equal(poses[34][0],poses[37][0]);
  for(const look of LOOKS){lab.setLook(look);assert.equal(lab.units[0].name,'broiler');}
  lab.dispose();
});

 test('Bagel rolls on five grounded facets and spring-tips up to brake in all looks', () => {
  const lab=createLab();lab.setShape('bagel');
  assert.ok(lab.actions.includes('stop'));
  for(const look of LOOKS){
    lab.setLook(look);const u=lab.units[0];
    assert.equal(u.children.length,4);assert.ok(triangles(u)<300);
    assert.equal(u.getObjectByName('body').geometry.userData.facets,5);
    lab.trigger('idle',0);for(let i=0;i<60;i++)lab.update(i/60);
    assert.ok(u.rotation.x>1.4);
    lab.trigger('move',1);const poses=[];
    for(let i=60;i<150;i++){lab.update(i/60);poses.push([u.position.x,u.rotation.z,u.scale.y]);}
    assert.ok(poses.at(-1)[0]-poses[30][0]>4,'fast forward rolling');
    assert.ok(Math.abs(u.rotation.z)>5);assert.ok(Math.abs(u.rotation.x)<.02);
    assert.ok(poses.some(p=>Math.abs(p[2]-1)>.001));
    const beforeTip=u.rotation.x;lab.trigger('stop',2.5);lab.update(2.5);
    assert.ok(Math.abs(u.rotation.x-beforeTip)<.1,'braking keeps spring continuity');for(let i=150;i<270;i++)lab.update(i/60);
    assert.ok(u.rotation.x>1.4);const x=u.position.x;lab.update(4.6);
    assert.ok(Math.abs(u.position.x-x)<.002,'brake settles without sliding');
    assert.ok(Math.abs(u.getObjectByName('brake').rotation.z)>.01);
  }
  lab.dispose();
});

test('Bible signature attacks recoil emitters and synchronise heavy toast',()=>{
  const lab=createLab();
  for(const kind of ['popper','zapper','four-slice']){
    lab.setShape(kind);lab.trigger('attack',0);lab.update(.15);const u=lab.units[0];
    if(kind==='zapper'){
      assert.ok(u.getObjectByName('coil0').position.z<0);
      assert.ok(u.getObjectByName('heater0').material.emissiveIntensity>0);
    }else{
      assert.ok(u.getObjectByName('toast0').position.y>u.getObjectByName('toast0').userData.home.y+.5);
      if(kind==='four-slice')assert.equal(u.getObjectByName('toast0').position.y,u.getObjectByName('toast1').position.y);
    }
    lab.setExpression('alarmed');lab.update(.3);assert.equal(u.getObjectByName('eye-left').geometry.type,'BoxGeometry');
    lab.setExpression('angry');lab.update(.4);assert.ok(u.getObjectByName('slot0').material.emissiveIntensity>0);
  }
  lab.dispose();
});

test('Defroster has six rigid pivots, frosty vents and a warm beam repairing an ally',()=>{
  const lab=createLab();lab.setShape('defroster');assert.ok(lab.actions.includes('repair'));
  for(const look of LOOKS){
    lab.setLook(look);const u=lab.units[0],vent=u.getObjectByName('coil0'),beam=u.getObjectByName('repair-beam');
    assert.equal(u.children.length,6);assert.ok(triangles(u)<300);
    assert.equal(vent.geometry.type,'BoxGeometry');
    assert.equal(vent.material.color.getHex(),0xa6ddec);
    assert.equal(u.getObjectByName('body').material.color.getHex(),0xf2d7a6);
    lab.trigger('idle',0);for(let i=0;i<60;i++)lab.update(i/60);
    assert.notEqual(vent.position.y,vent.userData.home.y);assert.equal(beam.visible,false);
    const ally=lab.scene.getObjectByName('repair-ally');assert.ok(ally);
    lab.trigger('repair',1);for(let i=60;i<100;i++)lab.update(i/60);
    assert.ok(beam.visible);assert.ok(beam.material.emissiveIntensity>0);
    assert.ok(ally.userData.repairProgress>0);assert.ok(vent.position.z<vent.userData.home.z);
    u.updateMatrixWorld(true);
    const tip=beam.localToWorld(new THREE.Vector3(0,.5,0));
    assert.ok(tip.distanceTo(ally.localToWorld(new THREE.Vector3(0,.55,0)))<1e-6);
    lab.trigger('move',2);const poses=[];for(let i=120;i<180;i++){lab.update(i/60);poses.push([u.position.x,u.position.y,u.scale.y]);}
    assert.ok(poses.some(p=>p[1]>.05));assert.ok(poses.every(p=>p[2]===1));assert.equal(poses[20][0],poses[23][0]);
    assert.equal(beam.visible,false);
  }
  lab.setTeam('orange');assert.equal(lab.units[0].getObjectByName('shoulder').material.color.getHex(),0xff8540);
  lab.dispose();
});

 test('Cold Toast unplugs on a spring, fades to outline and hops rigidly in every look',()=>{
  const lab=createLab();lab.setShape('cold-toast');assert.ok(lab.actions.includes('hide'));
  for(const look of LOOKS){
    lab.setLook(look);const u=lab.units[0],plug=u.getObjectByName('unplugged-plug');
    assert.equal(u.children.length,5);assert.ok(triangles(u)<300);
    assert.equal(u.getObjectByName('body').material.color.getHex(),0x303844);
    assert.equal(plug.geometry.type,'BoxGeometry');
    lab.trigger('idle',0);for(let i=0;i<60;i++)lab.update(i/60);
    assert.notEqual(plug.rotation.z,0);
    lab.trigger('hide',1);lab.update(1);assert.equal(u.userData.hiddenFraction,0);
    lab.update(1.2);assert.ok(u.userData.hiddenFraction>0&&u.userData.hiddenFraction<1);
    lab.update(1.8);assert.equal(u.userData.hiddenFraction,1);
    u.traverse(o=>{if(o.isMesh&&!o.userData.ink)assert.equal(o.material.opacity,0);});
    const outline=u.getObjectByName('stealth-outline');assert.ok(outline.visible);assert.ok(outline.material.opacity>0&&outline.material.opacity<.2);
    assert.ok(plug.position.z<plug.userData.home.z);
    lab.trigger('idle',2);for(let i=120;i<=162;i++)lab.update(i/60);assert.equal(u.userData.hiddenFraction,0);
    lab.trigger('move',3);const poses=[];for(let i=180;i<240;i++){lab.update(i/60);poses.push([u.position.x,u.position.y,u.scale.y]);}
    assert.ok(poses.some(p=>p[1]>.05));assert.ok(poses.every(p=>p[2]===1));assert.equal(poses[20][0],poses[23][0]);
  }
  lab.setTeam('orange');assert.equal(lab.units[0].getObjectByName('shoulder').material.color.getHex(),0xff8540);lab.dispose();
});

 test('Power cords cut, retain ten seconds battery, tip dark and replug with a Crumb',()=>{
  const lab=createLab();lab.setShape('cords-power');
  for(const look of LOOKS){
    lab.setLook(look);const u=lab.units[0],patient=u.getObjectByName('power-patient');
    assert.ok(triangles(u)<800);assert.equal(u.children.length,6);
    for(const name of ['outlet','extension-box'])assert.equal(u.getObjectByName(name).geometry.type,'BoxGeometry');
    assert.ok(triangles(patient)<300);
    lab.trigger('cut-cord',0);lab.update(.1);assert.ok(u.getObjectByName('cut-sparks').visible);
    lab.update(9);assert.equal(u.userData.powered,true);
    for(let i=540;i<=690;i++)lab.update(i/60);
    assert.equal(u.userData.powered,false);assert.ok(patient.rotation.z>1);
    assert.equal(patient.getObjectByName('eye-left').material.color.getHex(),0x303844);
    lab.trigger('replug',12);for(let i=720;i<=900;i++)lab.update(i/60);
    assert.equal(u.userData.powered,true);assert.ok(Math.abs(patient.rotation.z)<.02);
    assert.equal(patient.getObjectByName('eye-left').material.color.getHex(),0xf7f4eb);
    lab.trigger('move',16);const poses=[];for(let i=960;i<1020;i++){lab.update(i/60);poses.push(patient.position.clone());}
    assert.ok(poses.some(p=>p.y>.05));assert.equal(poses[20].x,poses[23].x);
    assert.ok(u.getObjectByName('patient-cord').geometry.attributes.position.count>4);
  }
  lab.setTeam('orange');lab.update(18);assert.equal(lab.units[0].getObjectByName('patient-glow').material.color.getHex(),0xff8540);
  lab.dispose();
 });

test('Terrain Kit preserves palette, resources, fog, ownership and four rigid Toastinators',()=>{
  const lab=createLab();lab.setShape('terrain-kit');
  for(const look of LOOKS){
    lab.setLook(look);const kit=lab.units[0];
    const palette={'base-ground':0x52696b,'high-ground':0x71878a,'cliff-faces':0x303f48,ramp:0x89918a,'river-shallow':0x367d8a,'river-deep':0x244e67,'dammed-water':0x499caa,wheat:0xc9a65e,'dairy-meadow':0x77977c,'generator-empty':0x516a79,'movable-rock':0xa0a7a0,'reach-neutral':0xcad3cd,'reach-ours':0x32d9e8,'reach-enemy':0xff8540,'fog-unexplored':0x26353f};
    for(const [name,color] of Object.entries(palette))assert.equal(kit.getObjectByName(name).material.color.getHex(),color,name);
    assert.ok(triangles(kit.getObjectByName('landscape'))<800);
    for(const name of ['crumb','popper','zapper','four-slice'])assert.ok(triangles(kit.getObjectByName(name))<300);
    assert.ok(kit.getObjectByName('reach-neutral').isLineSegments);
    assert.ok(kit.getObjectByName('fog-unexplored').material.opacity>.9);
    assert.ok(kit.getObjectByName('fog-explored').material.opacity<.7);
    assert.equal(kit.getObjectByName('movable-rock').geometry.parameters.radialSegments,5);
    lab.trigger('move',0);lab.update(.15);const u=kit.getObjectByName('crumb');const y=u.position.y;
    lab.update(.35);assert.notEqual(u.position.y,y);assert.equal(u.scale.y,1);
    lab.trigger('push-rock',1);lab.update(2);assert.ok(kit.getObjectByName('movable-rock').position.x>1);
    assert.equal(kit.position.y,0);assert.equal(kit.scale.y,1);
  }
  lab.dispose();
});

 test('Timer ticks, winds spells on springs and hops rigidly in all looks',()=>{
  const lab=createLab();lab.setShape('timer');assert.ok(lab.actions.includes('cast'));
  for(const look of LOOKS){
    lab.setLook(look);const u=lab.units[0],dial=u.getObjectByName('dial'),hand=u.getObjectByName('timer-hand');
    assert.equal(u.children.length,6);assert.ok(triangles(u)<300);
    assert.equal(dial.geometry.type,'BoxGeometry');
    lab.trigger('idle',0);for(let i=0;i<60;i++)lab.update(i/60);
    const angle=hand.rotation.z;lab.update(1.1);assert.notEqual(hand.rotation.z,angle);
    assert.notEqual(dial.position.y,dial.userData.home.y);
    lab.trigger('cast',2);lab.update(2);const start=hand.rotation.z;
    let recoil=0;for(let i=121;i<=138;i++){lab.update(i/60);recoil=Math.max(recoil,Math.abs(dial.rotation.z));}
    assert.ok(hand.rotation.z>start+2,'spell winds hand backwards');
    assert.ok(recoil>.02,'spring recoil');
    lab.trigger('move',3);const poses=[];for(let i=180;i<240;i++){lab.update(i/60);poses.push([u.position.x,u.position.y,u.scale.y]);}
    assert.ok(poses.some(p=>p[1]>.05));assert.ok(poses.every(p=>p[2]===1));assert.equal(poses[20][0],poses[23][0]);
  }
  lab.setTeam('orange');assert.equal(lab.units[0].getObjectByName('shoulder').material.color.getHex(),0xff8540);lab.dispose();
});


test('every picker shape builds and switches in every look (build 86 regression)', async()=>{
  const {readFile}=await import('node:fs/promises');
  const {SHAPES}=await import('../play/style-lab/lab.mjs');
  const html=await readFile(new URL('../play/style-lab.html',import.meta.url),'utf8');
  const picker=html.match(/<select id="shape">([\s\S]*?)<\/select>/)[1];
  const values=[...picker.matchAll(/value="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(new Set(values),new Set(['all',...SHAPES]));
  const lab=createLab();
  for(const look of LOOKS){
    lab.setLook(look);
    for(const kind of SHAPES){lab.setShape(kind);lab.update(0);assert.equal(lab.units[0].name,kind);assert.ok(triangles(lab.units[0])>0);}
  }
  lab.dispose();
});

test('Flying Toast has six rigid pivots, spring wings and a recovering dive strike',()=>{
  const lab=createLab();lab.setShape('flying-toast');
  for(const look of LOOKS){
    lab.setLook(look);const u=lab.units[0],wing=u.getObjectByName('wing-left');
    assert.equal(u.children.length,6);assert.ok(triangles(u)<300);
    assert.equal(wing.geometry.type,'BoxGeometry');
    assert.equal(u.getObjectByName('body').material.color.getHex(),0xf2d7a6);
    lab.trigger('idle',0);for(let i=0;i<60;i++)lab.update(i/60);
    assert.ok(u.position.y>.5);assert.ok(Math.abs(wing.rotation.z)>.01);
    lab.trigger('attack',1);let dive=0;
    for(let i=60;i<100;i++){lab.update(i/60);dive=Math.max(dive,u.rotation.x);assert.equal(u.scale.y,1);}
    assert.ok(dive>.3);
    lab.trigger('idle',2);for(let i=120;i<240;i++)lab.update(i/60);
    assert.ok(Math.abs(u.rotation.x)<.05);
    lab.trigger('move',4);const poses=[];
    for(let i=240;i<300;i++){lab.update(i/60);poses.push(u.position.clone());assert.equal(u.scale.y,1);}
    assert.ok(poses.some(p=>p.y>1));assert.equal(poses[20].x,poses[23].x);
  }
  lab.setTeam('orange');assert.equal(lab.units[0].getObjectByName('shoulder').material.color.getHex(),0xff8540);
  lab.dispose();
});

 test('Flying Toast presents a broad golden slice wearing a rigid pilot visor',()=>{
  for(const look of LOOKS){
    const u=buildModel('flying-toast',look,'cyan');
    const toast=u.getObjectByName('toast0'),visor=u.getObjectByName('pilot-visor');
    assert.ok(visor,'pilot visor must read as one broad charcoal panel');
    assert.equal(visor.parent,toast);
    assert.equal(visor.material.color.getHex(),0x303844);
    assert.equal(toast.geometry.type,'BoxGeometry');
    const size=new THREE.Box3().setFromObject(toast).getSize(new THREE.Vector3());
    assert.ok(size.x>.85&&size.y>.65,'toast slice dominates the air silhouette');
    assert.equal(u.children.length,6);
    assert.ok(triangles(u)<300);
  }
 });


test('Breadbox opens its rigid roll-top before dropping a unit and springs shut in all looks',()=>{
  const lab=createLab();lab.setShape('breadbox');assert.ok(lab.actions.includes('drop'));
  for(const look of LOOKS){
    lab.setLook(look);const u=lab.units[0],lid=u.getObjectByName('roll-top'),cargo=u.getObjectByName('cargo-unit');
    assert.equal(u.children.length,6);assert.ok(triangles(u)<300);
    assert.equal(lid.geometry.type,'BoxGeometry');
    assert.equal(u.getObjectByName('body').material.color.getHex(),0xf2d7a6);
    lab.trigger('idle',0);const heights=[];for(let i=0;i<60;i++){lab.update(i/60);heights.push(u.position.y);}
    assert.ok(Math.max(...heights)-Math.min(...heights)>.02);assert.equal(cargo.visible,false);
    lab.trigger('drop',1);lab.update(1);assert.equal(cargo.visible,false);
    for(let i=61;i<=80;i++)lab.update(i/60);
    assert.ok(lid.rotation.x>1);assert.ok(cargo.visible);
    const y=cargo.getWorldPosition(new THREE.Vector3()).y;
    lab.update(1.5);assert.ok(cargo.getWorldPosition(new THREE.Vector3()).y<y);
    lab.update(2.2);assert.equal(cargo.visible,false);
    lab.trigger('idle',3);for(let i=180;i<300;i++)lab.update(i/60);assert.ok(Math.abs(lid.rotation.x)<.01);
    lab.trigger('move',5);const poses=[];for(let i=300;i<360;i++){lab.update(i/60);poses.push(u.position.clone());assert.equal(u.scale.y,1);}
    assert.ok(poses.at(-1).distanceTo(poses[0])>.2);assert.ok(poses.every(p=>p.y>.8));
  }
  lab.setTeam('orange');assert.equal(lab.units[0].getObjectByName('shoulder').material.color.getHex(),0xff8540);lab.dispose();
});


test('Smoke Alarm floats, blinks and springs a five-sided detection pulse in every look',()=>{
  const lab=createLab();lab.setShape('smoke-alarm');assert.ok(lab.actions.includes('detect'));
  for(const look of LOOKS){
    lab.setLook(look);const u=lab.units[0],light=u.getObjectByName('alarm-light'),ring=u.getObjectByName('beep-ring');
    assert.equal(u.children.length,6);assert.ok(triangles(u)<300);
    assert.equal(u.getObjectByName('body').geometry.type,'BoxGeometry');
    assert.equal(light.geometry.type,'BoxGeometry');
    assert.equal(ring.geometry.type,'BoxGeometry');
    assert.equal(u.getObjectByName('body').material.color.getHex(),0xf2d7a6);
    for(const name of ['faceplate','eye-left','eye-right','slot0','toast0'])assert.ok(u.getObjectByName(name));
    lab.trigger('idle',0);const heights=[],blinks=new Set();
    for(let i=0;i<90;i++){lab.update(i/60);heights.push(u.position.y);blinks.add(light.material.emissiveIntensity);}
    assert.ok(Math.min(...heights)>.7);assert.ok(Math.max(...heights)-Math.min(...heights)>.03);assert.ok(blinks.size>1);
    lab.trigger('detect',2);let recoil=0;const sizes=[];
    for(let i=120;i<156;i++){lab.update(i/60);recoil=Math.max(recoil,Math.abs(u.rotation.x));if(ring.visible)sizes.push(ring.scale.x);}
    assert.ok(recoil>.03);assert.ok(sizes.length>5);assert.ok(Math.max(...sizes)-Math.min(...sizes)>.5);
    lab.trigger('idle',3);for(let i=180;i<300;i++)lab.update(i/60);assert.ok(Math.abs(u.rotation.x)<.01);
    lab.trigger('move',5);const poses=[];for(let i=300;i<360;i++){lab.update(i/60);poses.push(u.position.clone());assert.equal(u.scale.y,1);}
    assert.ok(poses.at(-1).distanceTo(poses[0])>.2);assert.equal(poses[20].x,poses[23].x);
  }
  lab.setTeam('orange');assert.equal(lab.units[0].getObjectByName('shoulder').material.color.getHex(),0xff8540);lab.dispose();
});

test('Outlet has six rigid pivots, five-facet hardware and spring plug-in motion',()=>{
  for(const look of LOOKS)for(const team of ['cyan','orange']){
    const m=buildModel('outlet',look,team);
    assert.equal(m.children.length,6);
    assert.ok(triangles(m)<800);
    m.traverse(o=>{if(o.geometry?.parameters?.radialSegments)assert.equal(o.geometry.parameters.radialSegments,5);});
  }
  const lab=createLab();lab.setShape('outlet');
  assert.ok(lab.actions.includes('claim'));
  const u=lab.units[0],shell=u.getObjectByName('outlet-shell');
  lab.trigger('idle',0);lab.update(.1);const idle=shell.rotation.z;lab.update(.3);
  assert.notEqual(shell.rotation.z,idle);
  lab.trigger('claim',1);for(let t=1;t<1.15;t+=.008)lab.update(t);
  assert.ok(shell.position.y> .7,'socket lifts before driving into ground');
  for(let t=1.15;t<2;t+=.008)lab.update(t);
  assert.ok(Math.abs(shell.position.y-.6)<.1,'claim seats the plug');
  lab.trigger('move',3);for(let t=3;t<3.42;t+=.008)lab.update(t);
  const x=shell.position.x;for(let t=3.42;t<3.49;t+=.008)lab.update(t);
  assert.equal(shell.position.x,x,'planted recovery does not slide');
  assert.equal(u.scale.y,1,'rigid geometry');
  assert.ok(u.getObjectByName('power-strip-end'));
  lab.dispose();
});

 test('Toaster Oven opens before presenting Popper and Zapper on its spring tray',()=>{
  const lab=createLab();lab.setShape('toaster-oven');assert.ok(lab.actions.includes('produce'));
  for(const look of LOOKS){
    lab.setLook(look);const u=lab.units[0],door=u.getObjectByName('oven-door'),tray=u.getObjectByName('oven-tray');
    assert.equal(u.children.length,6);assert.ok(triangles(u)<800);
    u.traverse(o=>{if(o.geometry?.parameters?.radialSegments)assert.equal(o.geometry.parameters.radialSegments,5);});
    assert.equal(u.getObjectByName('oven-shell').children[0].material.color.getHex(),0xf2d7a6);
    lab.trigger('idle',0);lab.update(.1);const rock=u.getObjectByName('oven-shell').rotation.z;lab.update(.3);assert.notEqual(u.getObjectByName('oven-shell').rotation.z,rock);
    lab.trigger('produce',1);lab.update(1.1);assert.equal(tray.position.z,0);assert.ok(door.rotation.x>0);
    for(let t=1.1;t<=1.7;t+=.008)lab.update(t);
    assert.ok(door.rotation.x>1.4);assert.ok(tray.position.z>1);
    for(const name of ['factory-popper','factory-zapper']){const troop=u.getObjectByName(name);assert.ok(troop.position.z>1);assert.equal(troop.scale.y,.32);}
    lab.trigger('idle',2);for(let t=2;t<3;t+=.008)lab.update(t);assert.ok(Math.abs(tray.position.z)<.01);
    lab.trigger('move',3);const poses=[];for(let i=0;i<60;i++){lab.update(3+i/60);poses.push(u.position.clone());assert.equal(u.scale.y,1);}
    assert.ok(poses.some(p=>p.y>.1));assert.equal(poses[25].x,poses[28].x);
  }
  lab.dispose();
 });

 test('Drill has five rigid pivots, a crystal bit and spring drilling on a planted stand',()=>{
  const lab=createLab();lab.setShape('drill');assert.ok(lab.actions.includes('drill'));
  for(const look of LOOKS){
    lab.setLook(look);const u=lab.units[0],motor=u.getObjectByName('drill-motor'),bit=u.getObjectByName('crystal-bit');
    assert.equal(u.children.length,5);assert.ok(triangles(u)<800);
    u.traverse(o=>{if(o.geometry?.parameters?.radialSegments)assert.equal(o.geometry.parameters.radialSegments,5);});
    lab.trigger('idle',0);lab.update(.1);const y=motor.position.y;lab.update(.3);assert.notEqual(motor.position.y,y);
    lab.trigger('drill',1);const heights=[],angles=[];
    for(let i=0;i<90;i++){lab.update(1+i/120);heights.push(motor.position.y);angles.push(bit.rotation.y);assert.equal(u.position.y,0);assert.equal(u.scale.y,1);}
    assert.ok(Math.max(...heights)-Math.min(...heights)>.08);assert.ok(angles.at(-1)>angles[0]+2);
    lab.trigger('move',3);const poses=[];for(let i=0;i<60;i++){lab.update(3+i/60);poses.push(u.position.clone());}
    assert.ok(poses.some(p=>p.y>.1));assert.equal(poses[25].x,poses[28].x);
  }lab.dispose();
 });

test('Track carries pentagonal crystal slices through straight, corner and junction pieces on springs',()=>{
  const lab=createLab();lab.setShape('track');assert.ok(lab.actions.includes('convey'));
  for(const look of LOOKS){
    lab.setLook(look);const u=lab.units[0];assert.equal(u.children.length,6);assert.ok(triangles(u)<800);
    for(const name of ['straight','corner','junction']){
      assert.ok(u.getObjectByName('track-'+name));
      const slice=u.getObjectByName('slice-'+name);assert.equal(slice.children[0].geometry.type,'BoxGeometry');
    }
    u.traverse(o=>{if(o.geometry?.parameters?.radialSegments)assert.equal(o.geometry.parameters.radialSegments,5);});
    lab.trigger('idle',0);lab.update(.1);const deck=u.getObjectByName('track-straight'),y=deck.position.y;lab.update(.3);assert.notEqual(deck.position.y,y);
    lab.trigger('convey',1);const positions=[];for(let i=0;i<90;i++){lab.update(1+i/120);positions.push(u.getObjectByName('slice-corner').position.clone());}
    assert.ok(Math.max(...positions.map(p=>p.x))-Math.min(...positions.map(p=>p.x))>.2);
    assert.ok(Math.max(...positions.map(p=>p.z))-Math.min(...positions.map(p=>p.z))>.2);
    lab.trigger('move',3);const poses=[];for(let i=0;i<60;i++){lab.update(3+i/60);poses.push(u.position.clone());assert.equal(u.scale.y,1);}
    assert.ok(poses.some(p=>p.y>.1));assert.equal(poses[25].x,poses[28].x);
  }lab.dispose();
});


test('Press clamps Shards and Flux before spring-ejecting an Alloy waffle in every look',()=>{
  const lab=createLab();lab.setShape('press');assert.ok(lab.actions.includes('press'));
  for(const look of LOOKS){
    lab.setLook(look);const u=lab.units[0],lid=u.getObjectByName('press-lid'),waffle=u.getObjectByName('alloy-waffle');
    assert.equal(u.children.length,6);assert.ok(triangles(u)<800);
    u.traverse(o=>{if(o.geometry?.parameters?.radialSegments)assert.equal(o.geometry.parameters.radialSegments,5);});
    lab.trigger('idle',0);lab.update(.1);const a=lid.rotation.x;lab.update(.3);assert.notEqual(lid.rotation.x,a);
    lab.trigger('press',1);lab.update(1);
    assert.ok(u.getObjectByName('shards').visible);assert.ok(u.getObjectByName('flux').visible);assert.equal(waffle.visible,false);
    for(let i=1;i<=55;i++)lab.update(1+i/120);
    assert.ok(Math.abs(lid.rotation.x)<.2,'iron clamps shut');
    assert.equal(u.getObjectByName('shards').visible,false);assert.equal(waffle.visible,false);
    for(let i=56;i<=120;i++)lab.update(1+i/120);
    assert.ok(lid.rotation.x<-.7);assert.ok(waffle.visible);assert.ok(waffle.position.y>.65);
    lab.trigger('move',3);const poses=[];for(let i=0;i<60;i++){lab.update(3+i/60);poses.push(u.position.clone());assert.equal(u.scale.y,1);}
    assert.ok(poses.some(p=>p.y>.1));assert.equal(poses[25].x,poses[28].x);
  }lab.dispose();
});


test('Trading House bustles on six rigid pivots and flips its price board during a cash sale',()=>{
  const lab=createLab();lab.setShape('trading-house');assert.ok(lab.actions.includes('trade'));
  for(const look of LOOKS)for(const team of ['cyan','orange']){
    lab.setLook(look);lab.setTeam(team);const u=lab.units[0];
    assert.equal(u.children.length,6);assert.ok(triangles(u)<800);
    u.traverse(o=>{if(o.geometry?.parameters?.radialSegments)assert.equal(o.geometry.parameters.radialSegments,5);});
    const register=u.getObjectByName('cash-register'),board=u.getObjectByName('price-board'),drawer=u.getObjectByName('cash-drawer');
    assert.equal(u.getObjectByName('counter-rim').material.color.getHex(),team==='orange'?0xff8540:0x32d9e8);
    lab.trigger('idle',0);lab.update(.1);const y=register.position.y;lab.update(.3);assert.notEqual(register.position.y,y);
    lab.trigger('trade',1);const angles=[],drawers=[],toast=[];
    for(let i=0;i<120;i++){lab.update(1+i/120);angles.push(board.rotation.x);drawers.push(drawer.position.z);toast.push(u.getObjectByName('purchase-toast').position.y);assert.equal(u.scale.y,1);}
    assert.ok(Math.max(...angles)-Math.min(...angles)>2.5,'board flips to a new quote');
    assert.ok(Math.max(...drawers)-Math.min(...drawers)>.25,'drawer springs open');
    assert.ok(Math.max(...toast)-Math.min(...toast)>.15,'purchase pops at checkout');
    lab.trigger('idle',2);for(let i=0;i<120;i++)lab.update(2+i/120);assert.ok(Math.abs(drawer.position.z-.25)<.02);
    lab.trigger('move',3);const poses=[];for(let i=0;i<60;i++){lab.update(3+i/60);poses.push(u.position.clone());}
    assert.ok(poses.some(p=>p.y>.1));assert.equal(poses[25].x,poses[28].x);
  }lab.dispose();
});


test('Turret opens its hatch, springs out of the ground before firing and retracts',()=>{
  const lab=createLab();lab.setShape('turret');
  for(const look of LOOKS)for(const team of ['cyan','orange']){
    lab.setLook(look);lab.setTeam(team);const u=lab.units[0];
    assert.equal(u.children.length,5);assert.ok(triangles(u)<800);
    u.traverse(o=>{if(o.geometry?.parameters?.radialSegments)assert.equal(o.geometry.parameters.radialSegments,5);});
    const body=u.getObjectByName('turret-body'),shot=u.getObjectByName('turret-shot'),hatch=u.getObjectByName('turret-hatch');
    lab.trigger('idle',0);lab.update(.1);const idle=body.position.y,idleHatch=hatch.rotation.x;lab.update(.3);assert.notEqual(body.position.y,idle);assert.notEqual(hatch.rotation.x,idleHatch);
    lab.trigger('attack',1);let fired=false,opened=false;
    for(let i=0;i<144;i++){lab.update(1+i/120);opened ||= hatch.rotation.x < -1;if(shot.visible){fired=true;assert.ok(body.position.y>1);assert.ok(hatch.rotation.x < -1);}assert.equal(u.position.y,0);}
    assert.ok(fired);assert.ok(opened);assert.ok(body.position.y<.1);assert.equal(shot.visible,false);
    lab.trigger('move',3);const poses=[];for(let i=0;i<60;i++){lab.update(3+i/60);poses.push(u.position.clone());}
    assert.ok(poses.some(p=>p.y>.1));assert.equal(poses[25].x,poses[28].x);
  }lab.dispose();
});


test('neutral Grudge Kettle guards with six rigid spring parts and planted scald hops',()=>{
  const lab=createLab();lab.setShape('grudge-kettle');
  for(const look of LOOKS)for(const team of ['cyan','orange']){
    lab.setLook(look);lab.setTeam(team);const u=lab.units[0];
    assert.equal(u.children.length,6);assert.ok(triangles(u)<300);
    u.traverse(o=>{if(o.geometry?.parameters?.radialSegments)assert.equal(o.geometry.parameters.radialSegments,5);});
    assert.equal(u.getObjectByName('neutral-band').material.color.getHex(),0xd99448);
    const lid=u.getObjectByName('kettle-lid'),spout=u.getObjectByName('kettle-spout');
    lab.trigger('idle',0);lab.update(.1);const y=lid.position.y;lab.update(.3);assert.notEqual(lid.position.y,y);
    lab.trigger('attack',1);const lifts=[],tilts=[];
    for(let i=0;i<120;i++){lab.update(1+i/120);lifts.push(lid.position.y);tilts.push(spout.rotation.x);}
    assert.ok(Math.max(...lifts)-Math.min(...lifts)>.12);assert.ok(Math.max(...tilts)-Math.min(...tilts)>.2);
    lab.trigger('move',3);const poses=[];
    for(let i=0;i<60;i++){lab.update(3+i/60);poses.push(u.position.clone());}
    assert.ok(poses.some(p=>p.y>.1));assert.equal(poses[25].x,poses[28].x);
    const foot=u.getObjectByName('kettle-left-foot');
    assert.ok(Math.abs(foot.getWorldPosition(new THREE.Vector3()).y)<.01,'feet plant at rest');
    lab.trigger('idle',4);for(let i=0;i<120;i++)lab.update(4+i/120);
    assert.ok(Math.abs(spout.rotation.x)<.04,'scald recoil recovers');
  }lab.dispose();
});

 test('Toast bank grows and shrinks beside its strip, with spring slices and planted hops',()=>{
  const lab=createLab();lab.setShape('toast-stacks');
  for(const look of LOOKS)for(const team of ['cyan','orange']){
    lab.setLook(look);lab.setTeam(team);lab.setToast(500);lab.trigger('idle',0);
    for(let i=0;i<120;i++)lab.update(i/120);
    const u=lab.units[0],slices=u.children.filter(p=>p.name.startsWith('bank-slice'));
    assert.equal(u.children.length,6);assert.equal(slices.length,5);assert.ok(triangles(u)<800);
    assert.ok(u.getObjectByName('bank-strip'));assert.ok(slices.every(p=>p.visible));
    assert.equal(u.getObjectByName('bank-rim').material.color.getHex(),team==='cyan'?0x32d9e8:0xff8540);
    assert.ok(slices[0].position.x>u.getObjectByName('bank-strip').position.x+1);
    const y=slices[4].position.y;lab.update(1.2);assert.notEqual(slices[4].position.y,y);
    lab.setToast(100);for(let i=0;i<120;i++)lab.update(2+i/120);
    assert.equal(slices.filter(p=>p.visible).length,1);
    lab.setToast(0);lab.update(3.1);assert.equal(slices.filter(p=>p.visible).length,0);
    lab.setToast(300);lab.update(3.2);assert.equal(slices.filter(p=>p.visible).length,3);
    lab.trigger('move',4);const poses=[];for(let i=0;i<60;i++){lab.update(4+i/60);poses.push(u.position.clone());}
    assert.ok(poses.some(p=>p.y>.1));assert.equal(poses[25].x,poses[28].x);
  }lab.dispose();
});

test('Thought bubbles: six pivots, four distinct wishes, moods and planted spring hops',()=>{
  for(const look of LOOKS)for(const team of ['cyan','orange']){
    const lab=createLab({look});lab.setTeam(team);lab.setShape('thought-moods');
    const u=lab.units[0];assert.equal(u.children.length,6);assert.ok(triangles(u)<300);
    for(const wish of ['plain','buttered','jam','gourmet']){
      lab.setWish(wish);lab.update(0);
      assert.equal(u.userData.wish,wish);
      assert.equal(u.getObjectByName('wish-butter').visible,['buttered','gourmet'].includes(wish));
      assert.equal(u.getObjectByName('wish-jam').visible,['jam','gourmet'].includes(wish));
      assert.equal(u.getObjectByName('wish-garnish').visible,wish==='gourmet');
    }
    assert.throws(()=>lab.setWish('burnt'));
    const sample=(action,start)=>{lab.trigger(action,start);for(let i=1;i<=30;i++)lab.update(start+i/60);};
    sample('idle',0);const idle=u.getObjectByName('mood-bubble').position.y;
    lab.update(.7);assert.notEqual(u.getObjectByName('mood-bubble').position.y,idle);
    sample('grumpy',1);assert.ok(u.getObjectByName('mood-brow').rotation.z>.15);
    sample('strike',2);assert.equal(u.getObjectByName('mood-sign').visible,true);
    assert.ok(u.getObjectByName('mood-sign').position.y>.5);
    sample('happy',3);assert.equal(u.getObjectByName('mood-sign').visible,false);
    lab.trigger('happy',4);lab.update(4.12);assert.ok(u.position.y>.1);
    lab.trigger('move',5);lab.update(5.42);const planted=u.position.x;lab.update(5.47);assert.equal(u.position.x,planted);
    lab.update(5.6);assert.ok(u.position.x>planted);assert.ok(u.position.y>.05);assert.notEqual(u.scale.y,1);
    lab.dispose();
  }
});


test('Toppings provides six readable pickup and market icons with spring collection and planted hops',()=>{
  for(const look of LOOKS)for(const team of ['cyan','orange']){
    const lab=createLab({look});lab.setTeam(team);lab.setShape('toppings');
    const u=lab.units[0];assert.equal(u.children.length,6);assert.ok(triangles(u)<300);
    const names=['butter','jam','honey','salt','sugar','nut-butter'];
    for(const name of names)assert.ok(u.getObjectByName('topping-'+name));
    u.traverse(o=>{if(o.geometry?.parameters?.radialSegments)assert.equal(o.geometry.parameters.radialSegments,5);});
    lab.trigger('idle',0);lab.update(.1);const y=u.children[0].position.y;lab.update(.3);assert.notEqual(u.children[0].position.y,y);
    lab.trigger('gather',1);const heights=[];for(let i=0;i<120;i++){lab.update(1+i/120);heights.push(u.children[0].position.y);}
    assert.ok(Math.max(...heights)-Math.min(...heights)>.3);
    lab.trigger('trade',3);for(let i=0;i<120;i++)lab.update(3+i/120);
    assert.equal(u.userData.presentation,'market');assert.ok(u.children.every(p=>Math.abs(p.position.z)<.01));
    lab.trigger('move',5);lab.update(5.42);const x=u.position.x;lab.update(5.47);assert.equal(u.position.x,x);
    lab.update(5.6);assert.ok(u.position.x>x);assert.ok(u.position.y>.05);assert.notEqual(u.scale.y,1);
    lab.dispose();
  }
});

test('Pop Shot reference is seekable, interruptible and emits one presentation hit without spending ammo',()=>{
  for(const look of LOOKS){
    let hits=0;const lab=createLab({look,onAttackHit:()=>hits++});lab.setShape('attack-popper');
    const u=lab.units[0],body=u.getObjectByName('body'),toast=u.getObjectByName('toast0');
    assert.equal(u.children.length,5);assert.ok(triangles(u)<300);
    u.traverse(o=>{if(o.geometry?.parameters?.radialSegments)assert.equal(o.geometry.parameters.radialSegments,5);});
    const home=toast.position.y;lab.playAttack();lab.setAnimationTime(0);assert.equal(body.rotation.x,0);
    lab.setAnimationTime(80);assert.ok(Math.abs(body.rotation.x+Math.PI/15)<1e-9);
    lab.setAnimationTime(160);assert.equal(toast.position.y,home-.15);
    lab.setAnimationTime(200);assert.equal(toast.position.y,home+.40);assert.ok(u.getObjectByName('pop-projectile').visible);
    lab.setAnimationTime(270);const p=u.getObjectByName('pop-projectile').position.clone();
    lab.setAnimationTime(340);assert.equal(hits,0,'seeking is presentation only');
    assert.equal(u.getObjectByName('pop-crumbs').children.length,5);assert.ok(u.getObjectByName('pop-flash').visible);
    lab.setAnimationTime(270);assert.deepEqual(u.getObjectByName('pop-projectile').position,p);
    lab.setAnimationTime(520);assert.equal(body.rotation.x,0);assert.equal(toast.position.y,home);
    lab.playAttack();lab.update(0);lab.update(.35);lab.update(.4);assert.equal(hits,1);
    lab.stopAttack();assert.equal(u.getObjectByName('pop-projectile').visible,false);assert.equal(body.rotation.x,0);
    lab.playAttack();lab.update(.45);lab.trigger('move',.45);lab.update(.8);assert.equal(hits,1);
    lab.dispose();
  }
});

test('Pop Shot loops repeat the arc, stop clears effects, and movement plants between hops',()=>{
  let hits=0;const lab=createLab({onAttackHit:()=>hits++});lab.setShape('attack-popper');
  const u=lab.units[0];lab.setAttackLoop(true);lab.playAttack();
  lab.update(.27);const p=u.getObjectByName('pop-projectile').position.clone();
  lab.update(.35);assert.equal(hits,1);lab.update(.79);
  assert.ok(u.getObjectByName('pop-projectile').position.distanceTo(p)<1e-10);
  lab.update(.87);assert.equal(hits,2);lab.stopAttack();
  for(const name of ['pop-projectile','pop-crumbs','pop-flash'])assert.equal(u.getObjectByName(name).visible,false);
  lab.trigger('move',1);lab.update(1.34);const x=u.position.x;lab.update(1.38);assert.equal(u.position.x,x);
  lab.update(1.5);assert.ok(u.position.y>0);assert.equal(u.scale.y,1);
  lab.dispose();
});

 test('Hot Coil preserves six pivots, one bolt, five beats, target heat and interruptible preview',()=>{
  for(const look of LOOKS)for(const team of ['cyan','orange']){
    let hits=0;const lab=createLab({look,onAttackHit:()=>hits++});lab.setTeam(team);lab.setShape('attack-zapper');
    const u=lab.units[0],coil=u.getObjectByName('coil0'),heater=u.getObjectByName('heater0');
    assert.equal(u.children.length,6);assert.ok(triangles(u)<300);
    u.traverse(o=>{if(o.geometry?.parameters?.radialSegments)assert.equal(o.geometry.parameters.radialSegments,5);});
    lab.playAttack();lab.setAnimationTime(160);assert.equal(heater.material.emissive.getHex(),0xff8540);assert.ok(heater.material.emissiveIntensity>1);
    lab.setAnimationTime(200);assert.ok(u.getObjectByName('hot-bolt').visible);assert.ok(coil.position.z<0);
    lab.setAnimationTime(270);const pos=u.getObjectByName('hot-bolt').position.clone();
    lab.setAnimationTime(340);assert.equal(u.getObjectByName('hot-bolt').visible,false);assert.ok(u.getObjectByName('hot-flash').visible);
    const target=u.getObjectByName('hot-target');assert.equal(target.material.color.getHex(),0xd99448);
    lab.setAnimationTime(375);assert.equal(target.material.color.getHex(),0x805432);
    lab.setAnimationTime(410);assert.equal(target.material.color.getHex(),0x303844);
    lab.setAnimationTime(270);assert.deepEqual(u.getObjectByName('hot-bolt').position,pos);assert.equal(hits,0);
    lab.setAnimationTime(520);assert.equal(coil.position.z,coil.userData.home.z);assert.equal(heater.material.emissiveIntensity,0);assert.equal(target.visible,false);
    lab.playAttack();lab.update(0);lab.update(.35);lab.update(.4);assert.equal(hits,1);
    lab.stopAttack();assert.equal(u.getObjectByName('hot-bolt').visible,false);
    lab.trigger('move',1);lab.update(1.34);const x=u.position.x;lab.update(1.38);assert.equal(u.position.x,x);
    lab.update(1.5);assert.ok(u.position.y>0);assert.equal(u.scale.y,1);
    lab.trigger('idle',2);lab.update(2.1);const y=coil.position.y;lab.update(2.3);assert.notEqual(coil.position.y,y);
    lab.setAttackLoop(true);lab.playAttack();lab.update(2.65);assert.equal(hits,2);lab.update(3.17);assert.equal(hits,3);
    lab.stopAttack();assert.equal(target.visible,false);lab.dispose();
  }
 });

test('attack gallery emits both presentation hits and Hot Coil interruption clears heat',()=>{
  const hits=[];const lab=createLab({onAttackHit:e=>hits.push(e.unit.name)});
  lab.setShape('all');lab.playAttack();lab.update(.35);
  assert.deepEqual(hits,['attack-specialists','attack-four-slice','attack-zapper','attack-popper']);
  lab.setShape('attack-zapper');lab.playAttack();lab.update(.51);
  const u=lab.units[0];assert.ok(u.getObjectByName('heater0').material.emissiveIntensity>1);
  lab.trigger('move',.51);lab.update(.52);
  for(const name of ['hot-bolt','hot-target','hot-flash'])assert.equal(u.getObjectByName(name).visible,false);
  assert.equal(u.getObjectByName('heater0').material.emissiveIntensity,0);
  assert.equal(hits.length,4);lab.dispose();
});

test('Quad Volley braces, holds, releases four spread slices and resets deterministically',()=>{
 for(const look of LOOKS){
  const lab=createLab({look});lab.setShape('attack-four-slice');const u=lab.units[0];
  assert.equal(u.children.length,6);assert.ok(triangles(u)<300);
  u.traverse(o=>{if(o.geometry?.parameters?.radialSegments)assert.equal(o.geometry.parameters.radialSegments,5);});
  lab.playAttack();lab.setAnimationTime(80);const brace=u.getObjectByName('body').rotation.x;
  assert.ok(brace<0);lab.setAnimationTime(150);assert.equal(u.getObjectByName('body').rotation.x,brace);
  lab.setAnimationTime(270);const slices=[0,1,2,3].map(i=>u.getObjectByName('quad-slice'+i));
  assert.ok(slices.every(o=>o.visible));assert.equal(new Set(slices.map(o=>o.position.x)).size,4);
  const p=slices[0].position.clone();lab.setAnimationTime(340);assert.ok(u.getObjectByName('quad-flash').visible);
  lab.setAnimationTime(270);assert.deepEqual(slices[0].position,p);
  lab.setAnimationTime(520);assert.equal(u.getObjectByName('body').rotation.x,0);assert.equal(u.userData.cameraShake,0);
  lab.stopAttack();assert.ok(slices.every(o=>!o.visible));lab.dispose();
 }
});

 test('Quad Volley release thump events follow playback, repeat and never fire on seek',()=>{
 let releases=0,hits=0;const lab=createLab({onAttackRelease:()=>releases++,onAttackHit:()=>hits++});lab.setShape('attack-four-slice');
 lab.playAttack();lab.setAnimationTime(250);assert.equal(releases,0);assert.notEqual(lab.units[0].userData.cameraShake,0);
 lab.playAttack();lab.update(.21);lab.update(.35);assert.equal(releases,1);assert.equal(hits,1);
 lab.stopAttack();assert.equal(lab.units[0].userData.cameraShake,0);
 lab.playAttack();lab.update(.56);assert.equal(releases,2);lab.dispose();
 });

test('Quad Volley moves in planted heavy hops and keeps toast on idle springs',()=>{
 const lab=createLab();lab.setShape('attack-four-slice');const u=lab.units[0];
 lab.trigger('move',0);lab.update(.47);const x=u.position.x;lab.update(.53);assert.equal(u.position.x,x);
 lab.update(.7);assert.ok(u.position.y>0);assert.equal(u.scale.y,1);
 lab.trigger('idle',1);lab.update(1.1);const y=u.getObjectByName('toast0').position.y;lab.update(1.3);assert.notEqual(u.getObjectByName('toast0').position.y,y);
 lab.dispose();
});

test('specialist attack study preserves rigs, budgets, deterministic seek and interruption',()=>{
 for(const look of LOOKS)for(const kind of ['broiler','flak-popper','bagel','crumb']){
  const lab=createLab({look});lab.setShape('attack-specialists');lab.setSpecialAttack(kind);
  const u=lab.units[0];assert.ok(u.children.length>=3&&u.children.length<=6);assert.ok(triangles(u)<300,kind+': '+triangles(u));
  const snapshot=()=>{const a=[];u.traverse(o=>{if(!o.userData.ink)a.push([o.name,o.visible,...o.position.toArray(),...o.rotation.toArray(),...o.scale.toArray()]);});return a;};
  lab.setAnimationTime(0);const idle=snapshot();lab.setAnimationTime(270);const flight=snapshot();
  assert.notDeepEqual(flight,idle);lab.setAnimationTime(340);assert.ok(u.getObjectByName('special-flash').visible);
  lab.setAnimationTime(270);assert.deepEqual(snapshot(),flight);lab.setAnimationTime(520);assert.deepEqual(snapshot(),idle);
  lab.playAttack();lab.update(.27);lab.stopAttack();assert.deepEqual(snapshot(),idle);
  lab.trigger('move',1);lab.update(1.2);assert.ok(u.position.y>0||kind==='bagel');
  lab.dispose();
 }
});

test('specialist signatures show shell arc, exactly five flak croutons, ram rebound and panic hop',()=>{
 const lab=createLab();lab.setShape('attack-specialists');
 for(const kind of ['broiler','flak-popper','bagel','crumb']){
  lab.setSpecialAttack(kind);const u=lab.units[0];
  u.traverse(o=>{if(o.isMesh&&!o.userData.ink&&o.geometry.parameters?.radialSegments!==undefined)assert.equal(o.geometry.parameters.radialSegments,5);});
  lab.setAnimationTime(270);
  const shell=u.getObjectByName('special-shell');
  if(kind==='broiler'){assert.ok(shell.visible);assert.ok(shell.position.z>0);assert.ok(u.getObjectByName('door').rotation.x<-1);}
  if(kind==='flak-popper'){assert.ok(shell.visible);assert.equal(shell.position.z,0);assert.ok(shell.position.y>2);}
  if(kind==='crumb')assert.equal([0,1,2,3,4].filter(i=>u.getObjectByName('special-crumb'+i).visible).length,5);
  lab.setAnimationTime(360);
  if(kind==='broiler')assert.ok(u.getObjectByName('special-fire').visible);
  if(kind==='flak-popper'){assert.equal(shell.visible,false);assert.equal([0,1,2,3,4].filter(i=>u.getObjectByName('special-crumb'+i).visible).length,5);}
  lab.setAnimationTime(340);const impact=u.position.z;lab.setAnimationTime(460);
  if(kind==='bagel')assert.ok(u.position.z<impact&&u.position.y>.8);
  if(kind==='crumb')assert.ok(u.position.z<1.2&&u.position.y>0);
  if(kind!=='broiler')assert.equal(u.userData.cameraShake,0);
 }
 lab.dispose();
});

 test('Blocky revision replaces every appliance surface and keeps all looks',()=>{
 for(const look of LOOKS)for(const kind of SHAPES.filter(k=>!['terrain-kit','ground-patches','toppings'].includes(k))){
  const u=buildModel(kind,look);assert.equal(u.userData.blocky,true,kind);
  u.traverse(o=>{if(o.isMesh&&!o.userData.ink)assert.ok(['BoxGeometry','BufferGeometry','CylinderGeometry'].includes(o.geometry.type),kind+': '+o.name);});
 }
 });

test('Blocky attack effects retain renderable surfaces within the sixty-triangle budget',()=>{
 for(const [kind,names] of [['attack-popper',['pop-projectile','pop-flash']],['attack-zapper',['hot-bolt','hot-target','hot-flash']],['attack-four-slice',['quad-slice0','quad-slice1','quad-slice2','quad-slice3','quad-flash']]]){
  const u=buildModel(kind);assert.ok(triangles(u)<=60);for(const name of names)assert.ok(u.getObjectByName(name).geometry.attributes.position.count>0,name);
 }
});
