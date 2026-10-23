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
  if (['crumb','popper','four-slice'].includes(kind)) {
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
  let shards;
  let team='cyan', objects=[], units=[], stress=[], active='idle', started=0, now=0, stressOn=false, fill=0;
  const dummy=new T.Object3D();
  const actions=['spawn','idle','move','attack','hit','gather','deliver','death','rank-up','shimmer','construction'];
  function rebuild(){
    for(const o of objects){scene.remove(o); disposeObject(o);} objects=[];stress=[];
    const ground=buildModel('ground',look,team); objects.push(ground);
    units=[buildModel('crumb',look,team),buildModel('popper',look,team),buildModel('four-slice',look,team)];
    units[0].position.set(-1.8,0,1.1);units[1].position.set(0,0,1.3);objects.push(...units);
    const crystal=buildModel('crystal',look,team);crystal.position.set(-3,0,-1.7);objects.push(crystal);
    const strip=buildModel('power-strip',look,team);strip.position.set(2,0,-2);objects.push(strip);
    objects.forEach(o=>scene.add(o));
    const source=buildModel('crumb',LOOKS[0],team);source.updateMatrixWorld(true);
    const geos=[];source.traverse(o=>{if(o.isMesh){let geo=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();geo.applyMatrix4(o.matrixWorld);const c=o.material.color, count=geo.attributes.position.count;const colors=new Float32Array(count*3);for(let i=0;i<count;i++) c.toArray(colors,i*3);geo.setAttribute('color',new T.BufferAttribute(colors,3));geos.push(geo);}});
    const geo=mergeGeometries(geos);geos.forEach(g=>g.dispose());disposeObject(source);
    const mat=material(0xffffff,look);mat.vertexColors=true;
    const batch=new T.InstancedMesh(geo,mat,200);batch.name='stress-bots';batch.userData.springHops=true;batch.instanceMatrix.setUsage(T.DynamicDrawUsage);batch.frustumCulled=false;batch.visible=stressOn;scene.add(batch);objects.push(batch);stress.push(batch);
    if(look===LOOKS[1]){const outline=new T.InstancedMesh(geo,inkMaterial(),200);outline.userData.ink=true;outline.frustumCulled=false;outline.visible=stressOn;scene.add(outline);objects.push(outline);stress.push(outline);

    }
    const shardGeo=new T.BufferGeometry();shardGeo.setAttribute('position',new T.Float32BufferAttribute([-.25,0,0,.25,0,0,0,.55,0],3));shardGeo.computeVertexNormals();
    const shardMat=material(teamColor(team),look);shardMat.side=T.DoubleSide;shardMat.transparent=true;
    shards=new T.InstancedMesh(shardGeo,shardMat,16);shards.name='death-facets';shards.frustumCulled=false;shards.visible=false;objects.push(shards);scene.add(shards);
  }
  // Fixed small integration steps keep the damped springs stable after tab suspension.
  function spring(state,key,target,dt,k=150,d=18) {
    const v=key+'Velocity';state[v]??=0;state[key]??=target;
    state[v]+=((target-state[key])*k-state[v]*d)*dt;state[key]+=state[v]*dt;
    return state[key];
  }
  let previous=0;
  function trigger(action,t=now){if(!actions.includes(action))throw new Error('Unknown action');active=action;started=t;fill=0;
    units.forEach(u=>{u.visible=true;u.userData.motion={height:0,toast:0,lever:0,lean:0};if(action==='hit')u.userData.motion.leanVelocity=9;});}
  function update(t){now=t;const age=Math.max(0,t-started), elapsed=Math.min(.1,Math.max(0,t-previous));previous=t;
    fill=active==='gather'?(age<.8?clamp(age/.8):age<2.6?1:1-clamp((age-2.6)/.16)):0;
    units.forEach((u,index)=>{
      const heavy=index===2, homeX=[-2.3,0,2.1][index], state=u.userData.motion??={};
      const moving=active==='move'||(active==='gather'&&age>.8&&age<2.6);
      const speed=heavy?1.5:2.5, cycle=age*speed, phase=cycle%1;
      const flight=clamp(phase/.8);
      const hop=moving?(heavy?.2:.34)*4*flight*(1-flight):0;
      const snap=active==='attack'&&age>.09&&age<.22;
      let height,toast,lever,lean;
      const steps=Math.max(1,Math.ceil(elapsed/.008)),dt=elapsed/steps;
      for(let j=0;j<steps;j++) {
        height=spring(state,'height',hop,dt,heavy?220:300,heavy?21:18);
        toast=spring(state,'toast',snap?.95:fill*.4,dt,450,19);
        lever=spring(state,'lever',snap?-.25:fill?-.18:0,dt,230,12);
        lean=spring(state,'lean',moving?Math.sin(cycle*1.5)*.18:0,dt);
      }
      u.position.set(homeX,Math.max(0,height||0),1.2);u.rotation.set(0,lean||0,0);
      u.scale.set(1,Math.max(.76,Math.min(1.2,1+(state.heightVelocity||0)*.09)),1);
      if(moving){const travel=(Math.floor(cycle)+ease(flight))*.45;u.position.x+=Math.sin(travel)*.8;u.position.z+=Math.cos(travel)*.5;u.rotation.z=-(lean||0);}
      if(active==='gather'&&index===0){u.position.x=age<.8?-3:-3+4.5*ease((age-.8)/1.8);u.position.z=-1.6;}
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
        if(m.name==='lever')m.position.y+=lever||0;
        if(m.name==='cord')m.rotation.x=(lean||0)*2;
        const flash=active==='hit'&&age<.08;
        m.material.emissive?.setHex(flash?0xffffff:0xff7722);m.material.emissiveIntensity=flash?2:fill*.7;
        if(active==='death'){const p=clamp((age-.09)/.12);m.scale.multiplyScalar(1-p);}
      });
      u.visible=!(active==='death'&&age>=.3)&&!stressOn;
    });
    const crystal=objects.find(o=>o.name==='crystal');crystal.traverse(m=>{if(m.isMesh&&!m.userData.ink){m.material.emissive.setHex(teamColor(team));m.material.emissiveIntensity=.2+.5*Math.max(0,Math.sin(t*2.6+m.id*.7));}});
    const strip=objects.find(o=>o.name==='power-strip');strip.traverse(m=>{if(m.isMesh&&!m.userData.ink){m.position.copy(m.userData.home);m.scale.copy(m.userData.scale);if(active==='construction'){const p=ease((age-(m.id%4)*.1)/.14);m.position.y+=(1-p)*3;m.scale.multiplyScalar(p);}}});
    for(let i=0;i<200;i++){
      const phase=(t*2.5+i*.173)%1, hop=.3*4*phase*(1-phase);
      dummy.position.set((i%20-9.5)*.64,hop*.32,(Math.floor(i/20)-4.5)*.8);
      const stretch=1+.18*(1-2*phase);dummy.scale.set(.32/Math.sqrt(stretch),.32*stretch,.32/Math.sqrt(stretch));
      dummy.rotation.set(0,Math.sin(t+i)*.15,Math.sin(t*2+i)*.06);dummy.updateMatrix();stress.forEach(b=>b.setMatrixAt(i,dummy.matrix));
    }
    stress.forEach(b=>b.instanceMatrix.needsUpdate=true);
    units.forEach(u=>{if(stressOn)u.visible=false;});
    shards.visible=active==='death'&&age<.45&&!stressOn;
    if(shards.visible){const p=clamp((age-.09)/.36), spread=age<.09?age*5:p;shards.material.opacity=1-clamp(age/.45);shards.material.color.setHex(age<.09?0xffdc66:teamColor(team));
      for(let i=0;i<16;i++){const a=i*2.399;dummy.position.set([-2.3,0,2.1][i%3]+Math.sin(a)*spread*1.8,.55+Math.sin(spread*Math.PI)*1.2-spread*.5,1.2+Math.cos(a)*spread*1.8);dummy.rotation.set(p*6+a,p*4,Math.sin(a));dummy.scale.setScalar(age<.09?.18:1-p*.65);dummy.updateMatrix();shards.setMatrixAt(i,dummy.matrix);}shards.instanceMatrix.needsUpdate=true;
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
