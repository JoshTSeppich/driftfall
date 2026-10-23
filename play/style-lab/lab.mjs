import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
export function buildModel(kind, look = LOOKS[0], team = 'cyan') {
  const g = new T.Group(); g.name = kind;
  const mats = { hull: material(0x3f5d4a, look), team: material(teamColor(team), look), steel: material(0x5b6470, look, false, true), tooth: material(0xf8e9b9, look), glass: material(teamColor(team), look, true), dark: material(0x222936, look), sand: material(0xb58a72, look) };
  const part = (geo, mat, p, s = [1,1,1], name = '') => { const m = new T.Mesh(geo, mats[mat]); m.position.set(...p); m.scale.set(...s); m.name = name; g.add(m); return m; };
  const oct = () => new T.OctahedronGeometry(1, 0), box = () => new T.BoxGeometry(1,1,1);
  if (kind === 'siphoner' || kind === 'fang') {
    for (let i=0;i<5;i++) part(oct(), i%2 ? 'team':'hull', [Math.sin(i*1.2)*.28,.35,-i*.43], [.5-i*.055,.37-i*.035,.42], `segment${i}`);
    part(box(), 'team', [0,.83,.12], [.85,.65,.7], 'head');
    part(new T.CylinderGeometry(.57,.53,.29,5), 'steel', [0,1.23,.04], [1,1,1], 'helmet');
    part(box(), 'dark', [0,.98,.484], [.62,.13,.04]);
    for (const x of [-.2,.2]) part(box(), 'tooth', [x,1,.515], [.09,.07,.04]);
    if (kind === 'siphoner') {
      part(new T.CylinderGeometry(.33,.33,.85,5), 'glass', [0,1,-.68], [1,1,1], 'tank');
      part(new T.CylinderGeometry(.25,.25,.68,5), 'team', [0,.65,-.68], [1,.02,1], 'fill');
      for (const y of [.55,1.45]) part(new T.CylinderGeometry(.36,.36,.1,5), 'steel', [0,y,-.68]);
      const hose=part(new T.CylinderGeometry(.105,.105,.64,5), 'steel', [0,.55,.75]); hose.rotation.x=Math.PI/2;
      const drill=part(new T.ConeGeometry(.23,.5,5), 'tooth', [0,.55,1.23], [1,1,1], 'drill'); drill.rotation.x=Math.PI/2;
    } else {
      for (const x of [-.37,.37]) { const fang=part(new T.ConeGeometry(.21,.95,4), 'tooth', [x,.65,.65]); fang.rotation.x=2.65; }
      part(box(),'steel',[-.65,.68,-.05],[.35,.5,.5]);
      part(oct(),'team',[.62,.52,.15],[.4,.42,.4]);
    }
  } else if (kind === 'nest') {
    part(new T.CylinderGeometry(1.4,1.65,.4,7),'steel',[0,.2,0]);
    for(let i=0;i<7;i++){ const a=i*Math.PI*2/7; const m=part(box(),i%2?'team':'hull',[Math.cos(a)*1.05,.75,Math.sin(a)*1.05],[.65,1.1,.55]); m.rotation.y=-a; }
    part(new T.ConeGeometry(1.65,1.2,7),'hull',[0,1.8,0]);
    part(new T.CylinderGeometry(.28,.4,1,5),'team',[0,2.5,0]);
    part(new T.ConeGeometry(.5,.7,4),'tooth',[0,3.2,0]);
    part(box(),'dark',[0,.75,1.13],[.8,.85,.3]);
    for(const x of [-.5,.5]) part(new T.ConeGeometry(.23,.8,4),'tooth',[x,.7,1.37]);
  } else if (kind === 'crystal') {
    for(let i=0;i<5;i++){ const m=part(new T.ConeGeometry(.35,.95+i*.18,4),'team',[Math.sin(i*2.4)*.55,.6,Math.cos(i*2.4)*.5],[1,1,1],`crystal${i}`); m.rotation.z=Math.sin(i)*.3; }
  } else if (kind === 'ground') {
    part(new T.CylinderGeometry(6.5,6.1,.45,11),'sand',[0,-.3,0]);
    for(let i=0;i<14;i++) part(oct(),i%2?'steel':'sand',[Math.sin(i*2.4)*5.4,.05,Math.cos(i*2.4)*5.4],[.25+i%3*.13,.2+i%2*.22,.35]);
  } else throw new Error(`Unknown model ${kind}`);
  g.updateMatrixWorld(true); g.traverse(o=>{ if(o.isMesh){o.userData.home=o.position.clone();o.userData.scale=o.scale.clone();} });
  if(look===LOOKS[1]) addInk(g);
  return g;
}
export function createLab({ renderer, width=1000, height=700, look=LOOKS[0] }={}) {
  const scene=new T.Scene(), camera=new T.PerspectiveCamera(38,width/height,.1,150);
  // Geometry sky survives the bloom composer, unlike an HTML-only backdrop.
  const sky=new T.Mesh(new T.SphereGeometry(60,12,8),new T.ShaderMaterial({side:T.BackSide,depthWrite:false,vertexShader:'varying float height; void main(){height=position.y/60.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying float height; void main(){vec3 dusk=vec3(.169,.106,.290);vec3 peach=vec3(1.,.604,.420);gl_FragColor=vec4(mix(peach,dusk,smoothstep(-.15,.65,height)),1.);}'}));sky.renderOrder=-100;scene.add(sky);
  camera.position.set(10,9,14); camera.lookAt(0,.5,0);
  scene.add(new T.HemisphereLight(0xc5eaff,0x6e3640,2.2));
  const key=new T.DirectionalLight(0xffdfb0,4);key.position.set(3,8,4);scene.add(key);
  const waveTime={value:0};
  let shards;
  let team='cyan', objects=[], units=[], stress=[], active='idle', started=0, now=0, stressOn=false, fill=0;
  const dummy=new T.Object3D();
  const actions=['spawn','idle','move','attack','hit','gather','death','rank-up','shimmer','construction'];
  function rebuild(){
    for(const o of objects){scene.remove(o); disposeObject(o);} objects=[];stress=[];
    const ground=buildModel('ground',look,team); objects.push(ground);
    units=[buildModel('siphoner',look,team),buildModel('fang',look,team)];
    units[0].position.set(-1.8,0,1.1);units[1].position.set(1,0,1.3);objects.push(...units);
    const crystal=buildModel('crystal',look,team);crystal.position.set(-3,0,-1.7);objects.push(crystal);
    const nest=buildModel('nest',look,team);nest.position.set(2,0,-2);objects.push(nest);
    objects.forEach(o=>scene.add(o));
    const source=buildModel('siphoner',LOOKS[0],team);source.updateMatrixWorld(true);
    const geos=[];source.traverse(o=>{if(o.isMesh){let geo=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();geo.applyMatrix4(o.matrixWorld);const c=o.material.color, count=geo.attributes.position.count;const colors=new Float32Array(count*3);for(let i=0;i<count;i++) c.toArray(colors,i*3);geo.setAttribute('color',new T.BufferAttribute(colors,3));geos.push(geo);}});
    const geo=mergeGeometries(geos);geos.forEach(g=>g.dispose());disposeObject(source);
    const mat=material(0xffffff,look);mat.vertexColors=true;
    mat.onBeforeCompile=shader=>{shader.uniforms.labTime=waveTime;shader.vertexShader='uniform float labTime;\n'+shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n float phase=labTime*8.0-instanceMatrix[3].x*1.7; transformed.x+=sin(position.z*4.0-phase)*.16*clamp(-position.z,0.0,1.0);');};
    const batch=new T.InstancedMesh(geo,mat,200);batch.name='stress-siphoners';batch.userData.travellingWave=true;batch.instanceMatrix.setUsage(T.DynamicDrawUsage);batch.frustumCulled=false;batch.visible=stressOn;scene.add(batch);objects.push(batch);stress.push(batch);
    if(look===LOOKS[1]){const outline=new T.InstancedMesh(geo,inkMaterial(),200);outline.userData.ink=true;outline.frustumCulled=false;outline.visible=stressOn;scene.add(outline);objects.push(outline);stress.push(outline);
      outline.material.vertexShader=outline.material.vertexShader.replace('void main(){','uniform float labTime; void main(){').replace('vec4 p=vec4(position,1.);','vec3 wavePosition=position; wavePosition.x+=sin(position.z*4.0-(labTime*8.0-instanceMatrix[3].x*1.7))*.16*clamp(-position.z,0.0,1.0); vec4 p=vec4(wavePosition,1.);');outline.material.uniforms.labTime=waveTime;
    }
    const shardGeo=new T.BufferGeometry();shardGeo.setAttribute('position',new T.Float32BufferAttribute([-.25,0,0,.25,0,0,0,.55,0],3));shardGeo.computeVertexNormals();
    const shardMat=material(teamColor(team),look);shardMat.side=T.DoubleSide;shardMat.transparent=true;
    shards=new T.InstancedMesh(shardGeo,shardMat,16);shards.name='death-facets';shards.frustumCulled=false;shards.visible=false;objects.push(shards);scene.add(shards);
  }
  function trigger(action,t=now){if(!actions.includes(action))throw new Error('Unknown action');active=action;started=t;fill=0;units.forEach(u=>u.visible=true);}
  function update(t){now=t;waveTime.value=t;const age=Math.max(0,t-started);
    units.forEach((u,index)=>{
      u.position.set(index?1:-1.8,0,1.2);u.rotation.set(0,0,0);u.scale.setScalar(1);
      u.traverse(m=>{if(!m.isMesh||m.userData.ink)return; m.position.copy(m.userData.home);m.scale.copy(m.userData.scale);m.rotation.y=0;
        if(m.name.startsWith('segment')){const i=Number(m.name.slice(7));m.position.y+=Math.sin(t*3+i)*.025;if(active==='move'||active==='gather')m.position.x+=Math.sin(age*14-i*1.1)*.18;}
        if(active==='spawn'){const p=ease((age-((m.id%5)*.025))/.14);m.scale.multiplyScalar(p);m.position.y+=(1-p)*1.8;}
        if(active==='death'){const p=clamp(age/.12);m.position.x+=Math.sin(m.id*7)*p*2;m.position.y+=Math.sin(p*Math.PI)*1.3-p*.7;m.scale.multiplyScalar(1-p);m.rotation.y=p*5;}
        const flash=(active==='hit'&&age<.08)||(active==='rank-up'&&age<.14);m.material.emissive?.setHex(flash?0xffffff:0x000000);m.material.emissiveIntensity=flash?2:0;
      });
      if(active==='move') {u.position.x+=Math.sin(age*1.7)*1.8;u.position.z+=Math.cos(age*1.7)*.6;u.rotation.y=Math.cos(age*1.7)*.4;}
      if(active==='attack'){const z=age<.09?-.3*ease(age/.09):age<.16?-.3+1.1*ease((age-.09)/.07):.8*(1-ease((age-.16)/.14));u.position.z+=z;u.rotation.x=-z*.25;}
      if(active==='hit'&&age<.14)u.position.x+=Math.sin(age*160)*.065*(1-age/.14);
      if(active==='rank-up'){u.position.y=Math.sin(clamp(age/.2)*Math.PI)*.3;}
      u.visible=!(active==='death'&&age>=.45);
    });
    if(active==='gather'){
      fill=age<.8?clamp(age/.8):age<2.6?1:1-clamp((age-2.6)/.16);
      const u=units[0];u.position.x=-1.8+(age<.8?-1.1*ease(age/.2):age<2.6?-1.1+4.4*ease((age-.8)/1.8):3.3);u.position.z=age<.8?-.7:1.2-3*ease((age-.8)/1.8);
    }
    const tank=units[0].getObjectByName('fill');tank.scale.y=Math.max(.02,fill);tank.position.y=.65+fill*.25;tank.material.emissive.setHex(teamColor(team));tank.material.emissiveIntensity=fill*1.3;
    const crystal=objects.find(o=>o.name==='crystal');crystal.traverse(m=>{if(m.isMesh&&!m.userData.ink){m.material.emissive.setHex(teamColor(team));m.material.emissiveIntensity=.2+.5*Math.max(0,Math.sin(t*2.6+m.id*.7));}});
    const nest=objects.find(o=>o.name==='nest');nest.traverse(m=>{if(m.isMesh&&!m.userData.ink){m.position.copy(m.userData.home);m.scale.copy(m.userData.scale);if(active==='construction'){const p=ease((age-(m.id%4)*.1)/.14);m.position.y+=(1-p)*3;m.scale.multiplyScalar(p);}}});
    for(let i=0;i<200;i++){dummy.position.set((i%20-9.5)*.64+Math.sin(t*3+i)*.1,.02,(Math.floor(i/20)-4.5)*.8);dummy.scale.setScalar(.32);dummy.rotation.set(0,Math.sin(t+i)*.15,0);dummy.updateMatrix();stress.forEach(b=>b.setMatrixAt(i,dummy.matrix));}
    stress.forEach(b=>b.instanceMatrix.needsUpdate=true);
    units.forEach(u=>{if(stressOn)u.visible=false;});
    shards.visible=active==='death'&&age<.45&&!stressOn;
    if(shards.visible){const p=clamp(age/.45);shards.material.opacity=1-p;
      for(let i=0;i<16;i++){const a=i*2.399;dummy.position.set((i<8?-1.8:1)+Math.sin(a)*p*1.8,.55+Math.sin(p*Math.PI)*1.2-p*.5,1.2+Math.cos(a)*p*1.8);dummy.rotation.set(p*6+a,p*4,Math.sin(a));dummy.scale.setScalar(1-p*.65);dummy.updateMatrix();shards.setMatrixAt(i,dummy.matrix);}shards.instanceMatrix.needsUpdate=true;
    }
    renderer?.render(scene,camera);
  }
  rebuild();
  return { scene,camera,actions,get units(){return units;},get fill(){return fill;},get stressCount(){return stressOn?200:0;},trigger,update,
    setLook(value){if(!LOOKS.includes(value))throw new Error('Unknown look');look=value;rebuild();},setTeam(value){team=value;rebuild();},
    setStress(value){stressOn=value;stress.forEach(b=>b.visible=value);},
    resize(w,h){camera.aspect=w/h;camera.updateProjectionMatrix();scene.traverse(o=>{if(o.material?.uniforms?.viewport)o.material.uniforms.viewport.value.set(w,h);});},
    dispose(){disposeObject(sky);objects.forEach(disposeObject);renderer?.dispose?.();}
  };
}
function disposeObject(o){const geos=new Set(),mats=new Set();o.traverse(m=>{if(m.geometry)geos.add(m.geometry);if(m.material)mats.add(m.material);});geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());}
