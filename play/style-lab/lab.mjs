import {buildHotCoil,poseHotCoil} from './hot-coil.mjs';
import {buildPopShot,posePopShot} from './pop-shot.mjs';
import {buildToppings,poseToppings} from './toppings.mjs';
import {buildMoods,poseMoods} from './thought-moods.mjs';
import {buildToastStacks,poseToastStacks} from './toast-stacks.mjs';
import {buildKettle,poseKettle} from './grudge-kettle.mjs';
import {buildTurret,poseTurret} from './turret.mjs';
import {buildTradingHouse,poseTradingHouse} from './trading-house.mjs';
import {buildPress,posePress} from './press.mjs';
import {buildTrack,poseTrack} from './track.mjs';
import {buildDrill,poseDrill} from './drill.mjs';
import {buildOven,poseOven} from './toaster-oven.mjs';
import {buildOutlet,poseOutlet} from './outlet.mjs';
import {buildSmokeAlarm,poseSmokeAlarm} from './smoke-alarm.mjs';
import {buildBreadbox,poseBreadbox} from './breadbox.mjs';
import {buildFlyingToast,poseFlyingToast} from './flying-toast.mjs';
import {buildTimer,poseTimer} from './timer.mjs';
import {buildTerrain,poseTerrain} from './terrain-kit.mjs';
import {buildPower,posePower} from './cords-power.mjs';
import {buildColdToast,poseColdToast} from './cold-toast.mjs';
import {buildDefroster,poseDefroster} from './defroster.mjs';
import {buildBible,poseBible,bibleKinds} from './bible.mjs';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
export const SHAPES=Object.freeze(['attack-zapper','attack-popper','toppings','thought-moods','toast-stacks','grudge-kettle','turret','trading-house','press','track','drill','toaster-oven','outlet','smoke-alarm','breadbox','flying-toast','timer','cords-power','cold-toast','defroster','bagel','broiler','crumb','popper','four-slice','zapper','flak-popper','mill','pump','churn','generator','ground-patches','power-strip','terrain-kit']);
export const LOOKS = ['FACETED', 'FACETED INK', 'Y2K GLOSS'];
const teamColor = team => team === 'orange' ? 0xff8a2a : 0x38e0ff;
const clamp = x => Math.max(0, Math.min(1, x));
const ease = x => 1 - (1 - clamp(x)) ** 3;
export function triangles(group) { let n = 0; group.traverse(o => { if (o.isMesh && !o.userData.ink) n += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; }); return n; }
function material(color, look, glass = false, metal = false) {
  return new T.MeshPhysicalMaterial({ color, flatShading: true, roughness: look === LOOKS[2] ? .16 : .86, metalness: metal ? .88 : .08, clearcoat: look === LOOKS[2] ? 1 : 0, transparent: glass || (look === LOOKS[2] && !metal), opacity: glass ? .42 : look === LOOKS[2] && !metal ? .9 : 1, depthWrite: !glass, side: glass ? T.DoubleSide : T.FrontSide });
}
function inkMaterial() {
  return new T.ShaderMaterial({ side: T.BackSide, uniforms: { viewport: { value: new T.Vector2(1000, 700) } }, vertexShader: `uniform vec2 viewport; void main(){ vec4 p=vec4(position,1.); vec3 n=normal;
#ifdef USE_INSTANCING
p=instanceMatrix*p; n=mat3(instanceMatrix)*n;
#endif
vec4 clip=projectionMatrix*modelViewMatrix*p; vec3 vn=normalMatrix*n; vec2 dir=(projectionMatrix*vec4(vn,0.)).xy; clip.xy+=normalize(dir+vec2(.00001))*3.0/viewport*clip.w; gl_Position=clip; }`, fragmentShader: 'void main(){gl_FragColor=vec4(.035,.045,.09,1.);}' });
}
function addInk(root) {
  const meshes = []; root.traverse(o => { if (o.isMesh && !o.material.transparent) meshes.push(o); });
  for (const m of meshes) { const ink = new T.Mesh(m.geometry, inkMaterial()); ink.userData.ink = true; m.add(ink); }
}
// A single shared profile keeps even the smallest debris true to the silhouette rule.
function pentagon() {
  const shape=new T.Shape();
  for(let i=0;i<5;i++){const a=Math.PI/2+i*Math.PI*2/5;const x=Math.cos(a),y=Math.sin(a);if(i===0)shape.moveTo(x,y);else shape.lineTo(x,y);}
  shape.closePath();const geo=new T.ShapeGeometry(shape);geo.userData.facets=5;return geo;
}
export function buildModel(kind, look = LOOKS[0], team = 'cyan') {
  const g = kind==='attack-zapper'?buildHotCoil(look,team):kind==='attack-popper'?buildPopShot(look,team):kind==='toppings'?buildToppings(look):kind==='thought-moods'?buildMoods(look,team):kind==='toast-stacks'?buildToastStacks(look,team):kind==='grudge-kettle'?buildKettle(look):kind==='turret'?buildTurret(look,team):kind==='trading-house'?buildTradingHouse(look,team):kind==='press'?buildPress(look,team):kind==='track'?buildTrack(look,team):kind==='drill'?buildDrill(look,team):kind==='toaster-oven'?buildOven(look,team):kind==='outlet'?buildOutlet(look,team):kind==='smoke-alarm'?buildSmokeAlarm(look,team):kind==='breadbox'?buildBreadbox(look,team):kind==='flying-toast'?buildFlyingToast(look,team):kind==='timer'?buildTimer(look,team):kind==='terrain-kit'?buildTerrain(look,team):kind==='cords-power'?buildPower(look,team):kind==='cold-toast'?buildColdToast(look,team):kind==='defroster'?buildDefroster(look,team):bibleKinds.includes(kind)?buildBible(kind,look,team):new T.Group(); g.name = kind;
  const mats = { hull: material(0x3f5d4a, look), team: material(teamColor(team), look), steel: material(0x5b6470, look, false, true), tooth: material(0xf8e9b9, look), glass: material(teamColor(team), look, true), dark: material(0x222936, look), sand: material(0xb58a72, look) };
  const part = (geo, mat, p, s = [1,1,1], name = '') => { const m = new T.Mesh(geo, mats[mat]); m.position.set(...p); m.scale.set(...s); m.name = name; g.add(m); return m; };
  const oct = () => new T.ConeGeometry(1, 1.5, 5), box = () => new T.BoxGeometry(1,1,1);
  if (kind==='attack-zapper'||kind==='attack-popper'||kind==='toppings'||kind==='thought-moods'||kind==='toast-stacks'||kind==='grudge-kettle'||kind==='turret'||kind==='trading-house'||kind==='press'||kind==='track'||kind==='drill'||kind==='toaster-oven'||kind==='outlet'||kind==='smoke-alarm'||kind==='breadbox'||kind==='flying-toast'||kind==='timer'||kind==='terrain-kit'||kind==='cords-power'||kind==='cold-toast'||kind==='defroster'||bibleKinds.includes(kind)) {
    // Rigid Bible rigs are built in bible.mjs.
  } else if (kind==='flak-popper') {
    const heavy=kind==='four-slice', w=heavy?1.65:kind==='popper'?1.05:.8, h=heavy?1.1:.8;
    part(box(),'team',[0,h/2+.18,0],[w,h,.8],'body');
    part(box(),'steel',[0,h+.2,0],[w+.04,.12,.84],'chrome');
    part(box(),'dark',[0,.18,0],[w*.85,.15,.65],'feet');
    const count=heavy?4:2;
    for(let i=0;i<count;i++) {
      const x=(i-(count-1)/2)*w/count;
      part(box(),'dark',[x,h+.27,0],[w/count*.7,.035,.58],`slot${i}`);
      part(box(),'tooth',[x,h+.32,0],[w/count*.53,.3,.42],`toast${i}`);
    }
    part(box(),'steel',[w/2+.08,h*.55,0],[.12,.4,.08],'rail');
    part(box(),'team',[w/2+.17,h*.62,0],[.24,.1,.2],'lever');
    part(new T.CylinderGeometry(.25,.31,.16,5),'steel',[-w*.25,h+.4,-.18],[1,1,1],'helmet');
    part(box(),'dark',[0,h*.65,.415],[w*.68,.15,.035],'visor');
    const dent=part(oct(),'dark',[-w/2,h*.8,.4],[.1,.09,.035],'dent');dent.rotation.z=.5;
    part(box(),'steel',[0,.3,-.49],[.1,.1,.25],'cord');
    if(kind==='flak-popper') {
      part(box(),'steel',[0,h+.49,-.3],[.7,.28,.12],'sight');
      for(let i=0;i<2;i++) {
        const flak=part(box(),'tooth',[(i-.5)*w/2,h+.4,0],[.18,.32,.3],`flak${i}`);
        flak.visible=false;
      }
    }
    if(kind==='zapper') {
      // Four angular runs per exposed heating element: cheap, readable coil silhouettes.
      for(let i=0;i<2;i++) {
        const x=(i-.5)*w/2;
        g.remove(g.getObjectByName(`toast${i}`));
        const coil=part(new T.CylinderGeometry(.5,.5,1,5).rotateX(Math.PI/2),'steel',[x,h+.4,0],[.07,.07,.48],`coil${i}`);
        coil.material=material(0xff8833,look,false,true);
        for(let j=0;j<3;j++) {
          const run=new T.Mesh(new T.CylinderGeometry(.5,.5,1,5,1,true).rotateZ(Math.PI/2),coil.material);run.position.set((j%2?.06:-.06)/.07,0,(j-1)*.13/.48);run.scale.set(2.7,1,.07/.48);coil.add(run);
        }
        const bolt=part(oct(),'steel',[x,h+.42,0],[.09,.22,.09],`bolt${i}`);
        bolt.material=material(0xffbb55,look);bolt.material.emissive.setHex(0xff7722);bolt.visible=false;
      }
    }
  } else if (kind === 'bagel') {
    // Hollow five-sided toaster tire; four rigid pieces, no surface detail.
    const outline=new T.Shape(), hole=new T.Path();
    for(let i=0;i<5;i++){
      const a=-Math.PI/2+i*Math.PI*2/5, b=-Math.PI/2-i*Math.PI*2/5;
      const x=Math.cos(a)*.8,y=Math.sin(a)*.8;
      if(i===0){outline.moveTo(x,y);hole.moveTo(Math.cos(b)*.36,Math.sin(b)*.36);}
      else {outline.lineTo(x,y);hole.lineTo(Math.cos(b)*.36,Math.sin(b)*.36);}
    }
    outline.closePath();hole.closePath();outline.holes.push(hole);
    const tire=new T.ExtrudeGeometry(outline,{depth:.4,bevelEnabled:false,steps:1,curveSegments:1});
    tire.translate(0,0,-.2);tire.userData.facets=5;
    part(tire,'team',[0,0,0],[1,1,1],'body');
    for(const z of [-.25,.25])part(new T.CylinderGeometry(.22,.22,.14,5).rotateX(Math.PI/2),'steel',[0,0,z],[1,1,1],z<0?'axle-back':'axle-front');
    part(new T.BoxGeometry(.16,.44,.16).translate(0,.22,0),'tooth',[.38,0,.25],[1,1,1],'brake');
  } else if (kind === 'broiler') {
    // Open-front oven shell, one rigid mesh; broad door pivots at its bottom hinge.
    const shell=[new T.BoxGeometry(1.35,.16,1).translate(0,.43,0),new T.BoxGeometry(1.35,.16,1).translate(0,1.35,0),new T.BoxGeometry(.16,.84,1).translate(-.595,.89,0),new T.BoxGeometry(.16,.84,1).translate(.595,.89,0),new T.BoxGeometry(1.03,.84,.14).translate(0,.89,-.43)];
    part(mergeGeometries(shell),'team',[0,0,0],[1,1,1],'body');shell.forEach(g=>g.dispose());
    for(const x of [-.46,.46])part(box(),'steel',[x,.18,0],[.32,.36,.65],x<0?'leg-left':'leg-right');
    part(new T.BoxGeometry(1.14,.8,.13).translate(0,.4,0),'steel',[0,.47,.55],[1,1,1],'door');
    part(box(),'tooth',[0,.85,.2],[.64,.16,.55],'siege-toast').visible=false;
    const flame=part(new T.ConeGeometry(.32,.65,5),'team',[0,1.12,.2],[1,1,1],'flame');
    flame.material=material(0xffa12b,look);flame.visible=false;
  } else if (kind === 'ground-patches') {
    // Two low ground slabs and four broad crop masses; no individual stalks or grass.
    mats.wheat=material(0xe8b84d,look);mats.meadow=material(0x69a34c,look);
    part(box(),'sand',[-.95,.04,0],[1.7,.08,1.65],'wheat-soil');
    part(box(),'meadow',[.95,.04,0],[1.7,.08,1.65],'dairy-turf');
    for(let i=0;i<2;i++) {
      part(new T.BoxGeometry(1.42,.22,.38).translate(0,.11,0),'wheat',[-.95,.08,(i-.5)*.76],[1,1,1],`wheat-row${i}`);
      part(new T.BoxGeometry(.58,.19,.48).translate(0,.095,0),'tooth',[.95,.08,(i-.5)*.76],[1,1,1],`dairy-block${i}`);
    }
  } else if (kind === 'generator') {
    // Five chunky rigid parts: the wheel spins around its own front-facing axle.
    part(box(),'dark',[0,.12,0],[1.8,.24,1.35],'base');
    part(box(),'team',[0,.65,-.2],[1.5,1,.85],'body');
    part(new T.CylinderGeometry(.67,.67,.32,5).rotateX(Math.PI/2),'steel',[0,.87,.46],[1,1,1],'wheel');
    part(new T.CylinderGeometry(.18,.18,.38,5).rotateX(Math.PI/2),'team',[0,.87,.7],[1,1,1],'hub');
    part(box(),'team',[.95,.5,-.2],[.45,.3,.35],'terminal');
  } else if (kind === 'churn') {
    // Five rigid pieces: a candy-plastic dairy machine with an oversized dasher.
    part(new T.CylinderGeometry(.55,.72,1.15,5),'team',[0,.64,0],[1,1,1],'body');
    part(new T.CylinderGeometry(.61,.61,.14,5),'steel',[0,1.27,0],[1,1,1],'lid');
    part(new T.CylinderGeometry(.09,.09,.95,5),'steel',[0,1.57,0],[1,1,1],'plunger');
    part(box(),'team',[0,2.08,0],[.95,.18,.24],'handle');
    part(box(),'tooth',[.85,.2,.15],[.45,.3,.42],'butter');
  } else if (kind === 'pump') {
    // Five independently pivoted rigid pieces: a very earnest kitchen waterworks.
    part(box(),'team',[0,.45,0],[1.2,.9,.85],'body');
    part(new T.CylinderGeometry(.3,.3,.5,5),'steel',[0,.02,0],[1,1,1],'intake');
    part(new T.CylinderGeometry(.28,.28,.65,5),'steel',[0,1.12,0],[1,1,1],'piston');
    part(new T.CylinderGeometry(.22,.22,1.25,5,1,true).rotateZ(Math.PI/2),'team',[.95,.55,0],[1,1,1],'pipe');
    part(new T.CylinderGeometry(.16,.16,.32,5).rotateZ(Math.PI/2),'glass',[1.65,.55,0],[1,1,1],'outflow');
  } else if (kind === 'mill') {
    // Five rigid meshes; mesh origins are their independent animation pivots.
    part(box(),'team',[0,.3,0],[1.5,.6,1.35],'body');
    part(new T.CylinderGeometry(.85,.85,.34,5),'steel',[0,.8,0],[1,1,1],'millstone');
    part(new T.CylinderGeometry(.42,.19,.45,5,1,true),'team',[0,1.3,0],[1,1,1],'hopper');
    part(new T.ConeGeometry(.24,.6,5),'sand',[0,1.6,0],[1,1,1],'wheat');
    part(new T.ConeGeometry(.42,.4,5),'tooth',[0,.22,.92],[1,1,1],'flour');
  } else if (kind === 'power-strip') {
    part(box(),'team',[0,.3,0],[2.8,.6,1.15],'body');
    part(box(),'steel',[0,.63,0],[2.85,.1,1.2],'chrome');
    for(const x of [-.85,0,.85]) {
      part(box(),'dark',[x,.7,0],[.65,.04,.8],'socket');
      for(const z of [-.18,.18]) part(box(),'tooth',[x,.73,z],[.12,.03,.17]);
    }
    part(box(),'team',[1.6,.35,0],[.35,.22,.35],'switch');
    part(box(),'dark',[-1.8,.15,0],[.8,.15,.15],'cord');
  } else if (kind === 'crystal') {
    for(let i=0;i<5;i++){ const m=part(new T.ConeGeometry(.35,.95+i*.18,5),'team',[Math.sin(i*2.4)*.55,.6,Math.cos(i*2.4)*.5],[1,1,1],`crystal${i}`); m.rotation.z=Math.sin(i)*.3; }
  } else if (kind === 'ground') {
    part(new T.CylinderGeometry(6.5,6.1,.45,5),'sand',[0,-.3,0]);
    for(let i=0;i<14;i++) part(oct(),i%2?'steel':'sand',[Math.sin(i*2.4)*5.4,.05,Math.cos(i*2.4)*5.4],[.25+i%3*.13,.2+i%2*.22,.35]);
  } else throw new Error(`Unknown model ${kind}`);
  g.updateMatrixWorld(true); g.traverse(o=>{ if(o.isMesh){o.userData.home=o.position.clone();o.userData.scale=o.scale.clone();} });
  if(look===LOOKS[1]) addInk(g);
  return g;
}
export function createLab({ renderer, width=1000, height=700, onAttackHit=()=>{}, look=LOOKS[0] }={}) {
  const scene=new T.Scene(), camera=new T.PerspectiveCamera(38,width/height,.1,150);
  // Geometry sky survives the bloom composer, unlike an HTML-only backdrop.
  const sky=new T.Mesh(new T.SphereGeometry(60,5,2),new T.ShaderMaterial({side:T.BackSide,depthWrite:false,vertexShader:'varying float height; void main(){height=position.y/60.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying float height; void main(){vec3 dusk=vec3(.169,.106,.290);vec3 peach=vec3(1.,.604,.420);gl_FragColor=vec4(mix(peach,dusk,smoothstep(-.15,.65,height)),1.);}'}));sky.renderOrder=-100;scene.add(sky);
  camera.position.set(10,9,14); camera.lookAt(0,.5,0);
  scene.add(new T.HemisphereLight(0xc5eaff,0x6e3640,2.2));
  const key=new T.DirectionalLight(0xffdfb0,4);key.position.set(3,8,4);scene.add(key);
  let shards;
  let shape='all';
  const roster=SHAPES;
  let bankToast=300, wish='plain';
  let dam=false, expression='determined';
  let team='cyan', objects=[], units=[], stress=[], active='idle', started=0, now=0, stressOn=false, fill=0;
  const dummy=new T.Object3D();
  const actions=['happy','grumpy','strike','trade','press','convey','drill','produce','claim','detect','drop','cast','push-rock','cut-cord','replug','hide','repair','stop','siege','spawn','idle','move','attack','hit','gather','deliver','grind','pump','churn','generate','harvest','death','rank-up','shimmer','construction'];
  function rebuild(){
    for(const o of objects){scene.remove(o); disposeObject(o);} objects=[];stress=[];
    const ground=buildModel('ground',look,team); objects.push(ground);
    units=roster.filter(k=>shape==='all'||shape===k).map(k=>buildModel(k,look,team));
    objects.push(...units);
    if(shape==='defroster'){
      const ally=buildModel('crumb',look,team);ally.name='repair-ally';ally.position.set(2,0,2.2);objects.push(ally);
    }
    const river=new T.Mesh(new T.BoxGeometry(2.3,.08,1.65),material(0x287baf,look));
    river.name='river-tile';river.position.y=-.06;objects.push(river);
    const crystal=buildModel('crystal',look,team);crystal.position.set(-3,0,-1.7);objects.push(crystal);
    
    if(shape==='terrain-kit'){for(const o of [ground,river,crystal])o.visible=false;}
    objects.forEach(o=>scene.add(o));
    const rings=new T.Group();rings.name='selection-rings';
    units.forEach((u,i)=>{const ring=new T.Mesh(new T.RingGeometry(.65,.7,5),material(teamColor(team),look));ring.rotation.x=-Math.PI/2;ring.position.set(units.length===1?0:(i-(units.length-1)/2)*1.8,.012,1.2);ring.material.side=T.DoubleSide;rings.add(ring);});
    objects.push(rings);scene.add(rings);
    const source=buildModel('crumb',LOOKS[0],team);source.updateMatrixWorld(true);
    const geos=[];source.traverse(o=>{if(o.isMesh){let geo=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();geo.applyMatrix4(o.matrixWorld);const c=o.material.color, count=geo.attributes.position.count;const colors=new Float32Array(count*3);for(let i=0;i<count;i++) c.toArray(colors,i*3);geo.setAttribute('color',new T.BufferAttribute(colors,3));geos.push(geo);}});
    const geo=mergeGeometries(geos);geos.forEach(g=>g.dispose());disposeObject(source);
    const mat=material(0xffffff,look);mat.vertexColors=true;
    const batch=new T.InstancedMesh(geo,mat,200);batch.name='stress-bots';batch.userData.springHops=true;batch.instanceMatrix.setUsage(T.DynamicDrawUsage);batch.frustumCulled=false;batch.visible=stressOn;scene.add(batch);objects.push(batch);stress.push(batch);
    if(look===LOOKS[1]){const outline=new T.InstancedMesh(geo,inkMaterial(),200);outline.userData.ink=true;outline.frustumCulled=false;outline.visible=stressOn;scene.add(outline);objects.push(outline);stress.push(outline);

    }
    const shardGeo=pentagon();shardGeo.scale(.28,.4,1);
    const shardMat=material(teamColor(team),look);shardMat.side=T.DoubleSide;shardMat.transparent=true;
    shards=new T.InstancedMesh(shardGeo,shardMat,16);shards.name='death-facets';shards.frustumCulled=false;shards.visible=false;objects.push(shards);scene.add(shards);
  }
  // Fixed small integration steps keep the damped springs stable after tab suspension.
  function spring(state,key,target,dt,k=150,d=18) {
    const v=key+'Velocity';state[v]??=0;state[key]??=target;
    state[v]+=((target-state[key])*k-state[v]*d)*dt;state[key]+=state[v]*dt;
    return state[key];
  }
  let previous=0, attackSeek=null, attackLoop=false, hitCycle=-1;
  function playAttack(){trigger('attack',now);}
  function stopAttack(){trigger('idle',now);units.filter(u=>['attack-popper','attack-zapper'].includes(u.name)).forEach(u=>(u.name==='attack-zapper'?poseHotCoil:posePopShot)(u,{active:'attack',age:0,ms:520}));}
  function setAnimationTime(ms){if(!Number.isFinite(ms))throw new Error('Invalid animation time');active='attack';attackSeek=Math.max(0,Math.min(520,ms));update(now);}
  function trigger(action,t=now){if(!actions.includes(action))throw new Error('Unknown action');active=action;started=t;fill=0;attackSeek=null;hitCycle=-1;units.forEach(u=>u.userData.attackHitCycle=-1);
    units.forEach(u=>{u.visible=true;u.userData.bagelAngle=u.userData.motion?.rollAngle||u.userData.bagelAngle||0;if(u.name!=='bagel'||!u.userData.motion)u.userData.motion={height:0,toast:0,lever:0,lean:0};if(action==='hit')u.userData.motion.leanVelocity=9;});}
  function update(t){now=t;const age=Math.max(0,t-started), elapsed=Math.min(.1,Math.max(0,t-previous));previous=t;
    fill=active==='gather'?(age<.8?clamp(age/.8):age<2.6?1:1-clamp((age-2.6)/.16)):0;
    units.forEach((u,index)=>{
      if(['attack-popper','attack-zapper'].includes(u.name)){
        u.visible=!(active==='death'&&age>=.3)&&!stressOn;
        const cycle=attackLoop?Math.floor(age/.52):0, ms=attackSeek??(attackLoop?(age*1000)%520:age*1000);
        (u.name==='attack-zapper'?poseHotCoil:posePopShot)(u,{active,age,ms,homeX:units.length===1?0:(index-(units.length-1)/2)*1.8});
        if(active==='attack'&&attackSeek===null&&ms>=340&&u.userData.attackHitCycle!==cycle){u.userData.attackHitCycle=cycle;onAttackHit({type:'impact',time:340,unit:u});}
        return;
      }
      if(u.name==='toppings'){poseToppings(u,{active,age,elapsed,spring,homeX:units.length===1?0:(index-(units.length-1)/2)*1.8});return;}
      if(u.name==='thought-moods'){poseMoods(u,{active,age,elapsed,spring,wish,homeX:units.length===1?0:(index-(units.length-1)/2)*1.8});return;}
      if(u.name==='toast-stacks'){poseToastStacks(u,{active,age,elapsed,spring,toast:bankToast,homeX:units.length===1?0:(index-(units.length-1)/2)*1.8});return;}
      if(u.name==='grudge-kettle'){poseKettle(u,{active,age,elapsed,spring,homeX:units.length===1?0:(index-(units.length-1)/2)*1.8});return;}
      if(u.name==='turret'){poseTurret(u,{active,age,elapsed,spring,homeX:units.length===1?0:(index-(units.length-1)/2)*1.8});return;}
      if(u.name==='trading-house'){poseTradingHouse(u,{active,age,elapsed,spring,homeX:units.length===1?0:(index-(units.length-1)/2)*1.8});return;}
      if(u.name==='press'){posePress(u,{active,age,elapsed,spring,homeX:units.length===1?0:(index-(units.length-1)/2)*1.8});return;}
      if(u.name==='track'){poseTrack(u,{active,age,elapsed,spring,homeX:units.length===1?0:(index-(units.length-1)/2)*1.8});return;}
      if(u.name==='drill'){poseDrill(u,{active,age,elapsed,spring,homeX:units.length===1?0:(index-(units.length-1)/2)*1.8});return;}
      if(u.name==='toaster-oven'){poseOven(u,{active,age,elapsed,spring,homeX:units.length===1?0:(index-(units.length-1)/2)*1.8});return;}
      if(u.name==='outlet'){poseOutlet(u,{active,age,elapsed,spring,homeX:units.length===1?0:(index-(units.length-1)/2)*1.8});return;}
      if(u.name==='smoke-alarm'){poseSmokeAlarm(u,{active,age,elapsed,spring,homeX:units.length===1?0:(index-(units.length-1)/2)*1.8});return;}
      if(u.name==='breadbox'){poseBreadbox(u,{active,age,elapsed,spring,homeX:units.length===1?0:(index-(units.length-1)/2)*1.8});return;}
      if(u.name==='terrain-kit'){u.userData.motion??={};poseTerrain(u,{active,age,elapsed,spring,expression});return;}
      const bagel=u.name==='bagel';
      const broiler=u.name==='broiler', sieging=broiler&&['siege','attack'].includes(active), patch=u.name==='ground-patches', harvesting=patch&&['harvest','gather','attack'].includes(active), generator=u.name==='generator', generating=generator&&['generate','attack','gather'].includes(active), churn=u.name==='churn', churning=churn&&['churn','attack','gather'].includes(active), pump=u.name==='pump', pumping=pump&&['pump','attack','gather'].includes(active), mill=u.name==='mill', grinding=mill&&['grind','attack','gather'].includes(active), heavy=broiler||u.name==='four-slice'||mill||pump||churn||generator||patch, zapper=u.name==='zapper', flakker=u.name==='flak-popper', homeX=units.length===1?0:(index-(units.length-1)/2)*1.8, state=u.userData.motion??={};
      const shot=age%1.1, firing=zapper&&active==='attack', heat=firing?clamp(shot/.2)*(shot<.2?1:Math.max(0,1-(shot-.2)/.09)):0;
      const moving=active==='move'||(active==='gather'&&age>.8&&age<2.6);
      const speed=heavy?1.5:2.5, cycle=age*speed, phase=cycle%1;
      const flight=clamp(phase/.8);
      const hop=moving?(heavy?.2:.34)*4*flight*(1-flight):0;
      const snap=zapper?firing&&shot>=.2&&shot<.29:active==='attack'&&age>.09&&age<.22;
      let height,toast,lever,lean,aim;
      const flakAttack=flakker&&active==='attack';
      const steps=Math.max(1,Math.ceil(elapsed/.008)),dt=elapsed/steps;
      for(let j=0;j<steps;j++) {
        if(bagel){
          spring(state,'rollSpeed',moving?9:0,dt,120,22);
          state.rollAngle??=u.userData.bagelAngle||0;
          state.rollAngle+=Math.max(0,state.rollSpeed)*dt;
          spring(state,'tip',moving?0:Math.PI/2,dt,180,16);
          spring(state,'brake',moving?-.35:.6+Math.sin(age*4)*.025,dt,240,14);
        }
        height=spring(state,'height',hop+((broiler||zapper||flakker||mill||pump||churn||generator||patch)&&!moving?.015*(1+Math.sin(age*4)):0),dt,heavy?220:300,heavy?21:18);
        toast=spring(state,'toast',snap?.95:fill*.4,dt,450,19);
        lever=spring(state,'lever',snap?-.25:fill?-.18:(zapper||flakker)?Math.sin(age*4)*.025:0,dt,230,12);
        spring(state,'door',sieging?1.65:0,dt,260,13);
        spring(state,'cropSway',patch?Math.sin(age*(harvesting?16:3))*(harvesting?.3:.035):0,dt,240,13);
        spring(state,'dairyBounce',patch?Math.max(0,Math.sin(age*(harvesting?16:3)))*(harvesting?.12:.012):0,dt,240,13);
        spring(state,'stoneSpeed',mill?(grinding?7:.45):0,dt,90,14);
        state.stoneAngle=(state.stoneAngle||0)+(state.stoneSpeed||0)*dt;
        spring(state,'wheelSpeed',generator?(generating?10:1.2):0,dt,100,15);
        state.wheelAngle=(state.wheelAngle||0)+(state.wheelSpeed||0)*dt;
        spring(state,'dynamoKick',generating?Math.sin(age*18)*.06:0,dt,260,13);
        spring(state,'piston',pump?Math.sin(age*(pumping?15:4))*(pumping?.24:.04):0,dt,300,14);
        spring(state,'dasher',churn?Math.sin(age*(churning?16:4))*(churning?.32:.035):0,dt,330,15);
        spring(state,'pipeKick',pumping?-Math.max(0,Math.sin(age*15))*.09:0,dt,230,12);
        spring(state,'hopper',grinding?Math.sin(age*18)*.07:0,dt,260,12);
        aim=spring(state,'aim',flakAttack&&shot<.5?-.48:0,dt,180,16);
        lean=spring(state,'lean',snap&&zapper?-.3:moving?Math.sin(cycle*1.5)*.18:0,dt);
      }
      u.position.set(homeX,Math.max(0,height||0),1.2);u.rotation.set(aim||0,lean||0,0);
      u.scale.set(1,Math.max(.76,Math.min(1.2,1+(state.heightVelocity||0)*.09)),1);
      if(moving){const travel=(Math.floor(cycle)+ease(flight))*.45;u.position.x+=Math.sin(travel)*.8;u.position.z+=Math.cos(travel)*.5;u.rotation.z=-(lean||0);}
      if(bagel){
        // A pentagon rolls about each successive ground corner, rather than skating.
        const a=Math.PI/5, angle=state.rollAngle||0;
        const edge=Math.floor((angle+a)/(2*a)), local=angle-edge*2*a;
        const tip=state.tip||0, support=.8*Math.cos(local);
        u.position.set(homeX+edge*1.6*Math.sin(a)+.8*Math.sin(local),support*Math.cos(tip)+.2*Math.sin(tip),1.2);
        u.rotation.set(tip,0,-angle);
        const stretch=1+Math.sin(age*18)*(moving?.025:.008);
        u.scale.set(1/Math.sqrt(stretch),stretch,1/Math.sqrt(stretch));
      }
      if(active==='gather'&&index===0&&!bagel){u.position.x=age<.8?-3:-3+4.5*ease((age-.8)/1.8);u.position.z=-1.6;}
      if(active==='hit')u.position.x+=Math.sin(age*24)*Math.exp(-age*8)*.25;
      if(active==='spawn'){const p=ease(age/.55);u.position.set(2+(homeX-2)*p,Math.sin(p*Math.PI)*1.8,-2+3.2*p);u.scale.multiplyScalar(Math.max(.01,p));}
      if(active==='rank-up')u.position.y+=Math.sin(clamp(age/.3)*Math.PI)*.4;
      u.traverse(m=>{if(!m.isMesh||m.userData.ink)return;
        m.position.copy(m.userData.home);m.scale.copy(m.userData.scale);
        if(m.name.startsWith('toast')){
          m.position.y+=toast||0;
          m.material.color.setHex(active==='gather'?teamColor(team):0xf8e9b9);
          if(active==='gather'&&index===0&&age<.8){m.position.y+=(1-fill)*.8;m.position.x-=(1-fill)*.5;}
          if(active==='deliver'||(active==='gather'&&age>=2.6)){const p=active==='deliver'?age:age-2.6;m.position.y+=Math.max(0,1.7*p-2*p*p);m.scale.multiplyScalar(1-clamp(p/.65));}
          m.rotation.x=snap?-.7:0;
        }
        if(bagel){
          if(m.name==='brake')m.rotation.z=state.brake||0;
          if(m.name.startsWith('axle'))m.position.z+=(m.name==='axle-front'?1:-1)*Math.sin(age*5)*.012;
        }
        if(broiler&&m.name==='door')m.rotation.x=state.door||0;
        if(patch) {
          if(m.name.startsWith('wheat-row'))m.rotation.z=(state.cropSway||0)*(m.name.endsWith('0')?1:-1);
          if(m.name.startsWith('dairy-block'))m.position.y+=state.dairyBounce||0;
        }
        if(churn) {
          if(m.name==='plunger'||m.name==='handle')m.position.y+=state.dasher||0;
          if(m.name==='lid')m.rotation.z=(state.dasherVelocity||0)*.012;
          if(m.name==='butter')m.visible=churning;
        }
        if(pump) {
          if(m.name==='piston')m.position.y+=state.piston||0;
          if(m.name==='pipe')m.position.x+=state.pipeKick||0;
          if(m.name==='outflow'){m.visible=pumping;m.position.x+=(age*3%1)*.65;m.scale.multiplyScalar(pumping?1-(age*3%1)*.7:1);}
        }
        if(mill) {
          const progress=grinding?(age%1.2)/1.2:0;
          if(m.name==='millstone')m.rotation.y=state.stoneAngle||0;
          if(m.name==='hopper')m.position.y+=state.hopper||0;
          if(m.name==='wheat'){m.scale.multiplyScalar(grinding?1-progress:1);m.position.y-=progress*.3;}
          if(m.name==='flour'){m.visible=grinding;m.scale.multiplyScalar(grinding?.2+progress*.8:1);}
        }
        if(m.name==='lever')m.position.y+=lever||0;
        if(m.name==='cord')m.rotation.x=(lean||0)*2;
        const flash=active==='hit'&&age<.08;
        m.material.emissive?.setHex(flash?0xffffff:0xff7722);m.material.emissiveIntensity=flash?2:fill*.7;
        if(generator) {
          if(m.name==='wheel'||m.name==='hub')m.rotation.z=state.wheelAngle||0;
          if(m.name==='body')m.rotation.z=state.dynamoKick||0;
          if(m.name==='terminal')m.position.y+=(state.dynamoKick||0)*.8;
          if(m.name==='wheel'||m.name==='hub'||m.name==='terminal'){
            m.material.emissive.setHex(teamColor(team));
            m.material.emissiveIntensity=dam?1.2+.35*Math.sin(age*6):generating?.25:0;
          }
        }
        if(m.name.startsWith('coil')||m.parent.name.startsWith('coil')){if(m.name.startsWith('coil'))m.position.y+=(toast||0)*.18;m.material.emissiveIntensity=heat*3;}
        if(m.name.startsWith('bolt')){m.visible=firing&&shot>=.2&&shot<.48;m.position.y+=(shot-.2)*7;m.position.z+=(shot-.2)*10;m.material.emissiveIntensity=4;}
        if(active==='death'){const p=clamp((age-.09)/.12);m.scale.multiplyScalar(1-p);}
      });
      if(u.userData.bible)poseBible(u,{active,age,phase,moving,shot,expression});
      if(u.name==='cords-power')posePower(u,{active,age,elapsed,spring});
      if(u.name==='flying-toast')poseFlyingToast(u,{active,age,elapsed,spring});
      if(u.name==='timer')poseTimer(u,{active,age,elapsed,spring});
      if(u.name==='cold-toast')poseColdToast(u,{active,age,elapsed,spring});
      if(u.name==='defroster')poseDefroster(u,{active,age,elapsed,spring,target:scene.getObjectByName('repair-ally')||units.find(a=>a.name==='crumb')});
      // The launched slice follows a world-space parabola, independent of suspension recoil.
      if(broiler) {
        const slice=u.getObjectByName('siege-toast'), flame=u.getObjectByName('flame');
        const p=shot-.28, launched=sieging&&p>=0&&p<.72;
        slice.visible=flame.visible=launched;
        if(launched){
          const volley=Math.floor(age/1.1);
          if(state.volley!==volley||!state.launch){state.launch=u.localToWorld(slice.userData.home.clone());state.volley=volley;}
          const world=state.launch.clone();world.y+=5*p-7*p*p;world.z+=4*p;
          slice.position.copy(u.worldToLocal(world));slice.rotation.x=-p*5;
          flame.position.copy(slice.position);flame.position.y+=.28;
          flame.material.emissive.setHex(0xff6611);flame.material.emissiveIntensity=2;
        }
      }
      // Capture the muzzle in world space once per volley; body recoil cannot bend the flight.
      u.updateMatrixWorld(true);
      const volley=Math.floor(age/1.1);
      for(let i=0;flakker&&i<2;i++) {
        const flak=u.getObjectByName(`flak${i}`);
        flak.visible=flakAttack&&shot>=.22&&shot<.6;
        if(flak.visible) {
          if(state.volley!==volley||!state.launches) {
            state.launches=[0,1].map(n=>u.localToWorld(u.getObjectByName(`flak${n}`).userData.home.clone()));
            state.volley=volley;
          }
          const world=state.launches[i].clone();world.y+=(shot-.22)*8;
          flak.position.copy(u.worldToLocal(world));
        }
      }
      u.visible=!(active==='death'&&age>=.3)&&!stressOn;
    });
    const river=scene.getObjectByName('river-tile'), pumpUnit=units.find(u=>u.name==='pump')||units.find(u=>u.name==='generator'&&dam);
    river.visible=!!pumpUnit&&!stressOn;
    if(pumpUnit){river.position.x=pumpUnit.position.x;river.position.z=pumpUnit.position.z;}
    const crystal=objects.find(o=>o.name==='crystal');crystal.traverse(m=>{if(m.isMesh&&!m.userData.ink){m.material.emissive.setHex(teamColor(team));m.material.emissiveIntensity=.2+.5*Math.max(0,Math.sin(t*2.6+m.id*.7));}});
    for(let i=0;i<200;i++){
      const phase=(t*2.5+i*.173)%1, hop=.3*4*phase*(1-phase);
      dummy.position.set((i%20-9.5)*.64,hop*.32,(Math.floor(i/20)-4.5)*.8);
      const stretch=1;dummy.scale.set(.32/Math.sqrt(stretch),.32*stretch,.32/Math.sqrt(stretch));
      dummy.rotation.set(0,Math.sin(t+i)*.15,Math.sin(t*2+i)*.06);dummy.updateMatrix();stress.forEach(b=>b.setMatrixAt(i,dummy.matrix));
    }
    stress.forEach(b=>b.instanceMatrix.needsUpdate=true);
    units.forEach(u=>{if(stressOn)u.visible=false;});
    shards.visible=active==='death'&&age<.45&&!stressOn;
    if(shards.visible){const p=clamp((age-.09)/.36), spread=age<.09?age*5:p;shards.material.opacity=1-clamp(age/.45);shards.material.color.setHex(age<.09?0xffdc66:teamColor(team));
      for(let i=0;i<16;i++){const a=i*2.399;dummy.position.set([-2.3,0,2.1][i%3]+Math.sin(a)*spread*1.8,.55+Math.sin(spread*Math.PI)*1.2-spread*.5,1.2+Math.cos(a)*spread*1.8);dummy.rotation.set(p*6+a,p*4,Math.sin(a));dummy.scale.setScalar(age<.09?.18:1-p*.65);dummy.updateMatrix();shards.setMatrixAt(i,dummy.matrix);}shards.instanceMatrix.needsUpdate=true;
    }
    const rings=scene.getObjectByName('selection-rings');
    rings.visible=!stressOn&&shape!=='terrain-kit';
    rings.children.forEach((r,i)=>{r.visible=units[i].visible;r.position.x=units[i].position.x;r.position.z=units[i].position.z;});
    renderer?.render(scene,camera);
  }
  rebuild();
  return { scene,camera,actions,get units(){return units;},get fill(){return fill;},get stressCount(){return stressOn?200:0;},trigger,update,playAttack,stopAttack,setAnimationTime,setAttackLoop(value){attackLoop=!!value;},
    setShape(value){if(value!=='all'&&!roster.includes(value))throw new Error('Unknown shape');shape=value;rebuild();},
    setLook(value){if(!LOOKS.includes(value))throw new Error('Unknown look');look=value;rebuild();},setTeam(value){team=value;rebuild();},
    setExpression(value){if(!['determined','proud','alarmed','angry'].includes(value))throw new Error('Unknown expression');expression=value;},
    setWish(value){if(!['plain','buttered','jam','gourmet'].includes(value))throw new Error('Unknown wish');wish=value;},
    setToast(value){if(!Number.isFinite(value))throw new Error('Invalid Toast');bankToast=Math.max(0,Math.min(500,value));},
    setDam(value){dam=!!value;},
    setStress(value){stressOn=value;stress.forEach(b=>b.visible=value);},
    resize(w,h){camera.aspect=w/h;camera.updateProjectionMatrix();scene.traverse(o=>{if(o.material?.uniforms?.viewport)o.material.uniforms.viewport.value.set(w,h);});},
    dispose(){disposeObject(sky);objects.forEach(disposeObject);renderer?.dispose?.();}
  };
}
function disposeObject(o){const geos=new Set(),mats=new Set();o.traverse(m=>{if(m.geometry)geos.add(m.geometry);if(m.material)mats.add(m.material);});geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());}
