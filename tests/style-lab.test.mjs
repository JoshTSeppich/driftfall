import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildModel, triangles, LOOKS, createLab } from '../play/style-lab/lab.mjs';
for (const look of LOOKS) test(`${look}: real geometry builds with a stub renderer`, () => {
  const renderer = { render() {}, setSize() {}, dispose() {} };
  const lab = createLab({ renderer, width: 900, height: 600, look });
  for (const kind of ['crumb', 'popper', 'four-slice', 'zapper', 'flak-popper', 'cold-toast', 'defroster', 'bagel', 'broiler', 'mill', 'pump', 'churn', 'generator', 'ground-patches', 'power-strip', 'cords-power', 'crystal', 'ground']) {
    const model = buildModel(kind, look, 'cyan');
    assert.ok(model instanceof THREE.Group);
    assert.ok(triangles(model) > 0);
    if (['crumb', 'popper', 'four-slice', 'zapper', 'flak-popper','cold-toast','defroster','bagel','broiler'].includes(kind)) assert.ok(triangles(model) < 300, `${kind}: ${triangles(model)}`);
    if (['mill','pump','churn','generator','ground-patches','power-strip','cords-power'].includes(kind)) assert.ok(triangles(model) < 800);
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
  for(const kind of ['crumb','popper','four-slice','zapper','flak-popper', 'cold-toast', 'defroster', 'bagel', 'broiler','mill','pump','churn','generator','ground-patches','power-strip','crystal','ground']) {
    const m=buildModel(kind);
    m.traverse(o=>{
      if(!o.isMesh)return;
      const geo=o.geometry, p=geo.parameters;
      if(p?.radialSegments!==undefined)assert.equal(p.radialSegments,5,kind);
      assert.notEqual(geo.type,'OctahedronGeometry',kind);
      if(geo.type==='ShapeGeometry'&&!geo.userData.flatPanel)assert.equal(geo.userData.facets,5,kind);
    });
    assert.ok(triangles(m)<(['mill','pump','churn','generator','ground-patches','power-strip','cords-power'].includes(kind)?800:kind==='ground'?800:300));
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
  lab.setShape('all');assert.equal(lab.units.length,16);lab.dispose();
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
    lab.setExpression('alarmed');lab.update(.3);assert.equal(u.getObjectByName('eye-left').geometry.userData.facets,5);
    lab.setExpression('angry');lab.update(.4);assert.ok(u.getObjectByName('slot0').material.emissiveIntensity>0);
  }
  lab.dispose();
});

test('Defroster has six rigid pivots, frosty vents and a warm beam repairing an ally',()=>{
  const lab=createLab();lab.setShape('defroster');assert.ok(lab.actions.includes('repair'));
  for(const look of LOOKS){
    lab.setLook(look);const u=lab.units[0],vent=u.getObjectByName('coil0'),beam=u.getObjectByName('repair-beam');
    assert.equal(u.children.length,6);assert.ok(triangles(u)<300);
    assert.equal(vent.geometry.parameters.radialSegments,5);
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
    assert.equal(plug.geometry.parameters.radialSegments,5);
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
    for(const name of ['outlet','extension-box'])assert.equal(u.getObjectByName(name).geometry.parameters.radialSegments,5);
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
