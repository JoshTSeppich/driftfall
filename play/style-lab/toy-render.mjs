import {poseCute} from './cute-pass.mjs';
import * as T from 'three';

export function configureToyRenderer(renderer,enabled=true){
 renderer.toneMapping=enabled?T.ACESFilmicToneMapping:T.ACESFilmicToneMapping;
 renderer.toneMappingExposure=enabled?1.15:1;
 renderer.outputColorSpace=T.SRGBColorSpace;
 renderer.shadowMap.enabled=enabled;renderer.shadowMap.type=T.PCFSoftShadowMap;
}
const TABLE=new Map([[0xf2d7a6,[.48,0]],[0x303844,[.35,.08]],[0x32d9e8,[.38,.05]],[0xff8540,[.38,.05]],[0xd99448,[.82,0]],[0x434a52,[.65,.10]]]);
function edgeShader(shader){
 shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 toyLocal; attribute vec3 toyHalf; varying vec3 vToyLocal; varying vec3 vToyHalf;').replace('#include <begin_vertex>','#include <begin_vertex>\nvToyLocal=toyLocal;vToyHalf=toyHalf;');
 shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vToyLocal; varying vec3 vToyHalf;').replace('#include <opaque_fragment>',`
 vec3 toyDistance=max(vToyHalf-abs(vToyLocal),vec3(0.))/max(vToyHalf,vec3(.0001));
 float toySecond=max(min(toyDistance.x,toyDistance.y),min(max(toyDistance.x,toyDistance.y),toyDistance.z));
 float toyAA=max(fwidth(toySecond),.0001);
 float toyBand=1.-smoothstep(.015-toyAA,.015+toyAA,toySecond);
 float toyInset=(1.-smoothstep(.045-toyAA,.045+toyAA,toySecond))-toyBand;
 outgoingLight=outgoingLight*(1.-.06*toyInset)+vec3(1.,.94,.82)*toyBand*.17;
 #include <opaque_fragment>`);
}
export function applyToyMaterials(root){
 const shared=new Map(),replaced=new Set();
 root.traverse(o=>{
  if(!o.isMesh||o.userData.ink||o.userData.toyStressPart||!o.material?.isMeshStandardMaterial)return;
  let owner=o;while(owner.parent&&!owner.userData.team)owner=owner.parent;
  const eyeTeam=owner.userData.team==='orange'?0xff8540:0x32d9e8;
  const role=/^(slot|heater|.*flash|.*target|.*projectile|.*bolt|special-|wish-|thought-)/.test(o.name)?o.name:o.name.startsWith('eye-')?'eye'+eyeTeam:'surface';
  const old=o.material,hex=/^(foot-|feet|joint)/.test(o.name)?0x434a52:old.color.getHex(),box=o.geometry.type==='BoxGeometry'||o.userData.blockySurface;
  const key=[hex,old.emissive?.getHex(),old.emissiveIntensity,old.transparent,old.opacity,old.side,!!old.vertexColors,!!box,role].join('/');
  if(!shared.has(key)){
   const [roughness,metalness]=TABLE.get(hex)??[.65,.05];
   const mat=new T.MeshStandardMaterial({color:hex,roughness,metalness,flatShading:true,side:old.side,transparent:old.transparent,opacity:old.opacity,depthWrite:old.depthWrite,vertexColors:old.vertexColors,emissive:old.emissive,emissiveIntensity:old.emissiveIntensity});
   if(o.name.startsWith('eye-')){mat.emissive.setHex(eyeTeam);mat.emissiveIntensity=2;}
   if(box){mat.onBeforeCompile=edgeShader;mat.customProgramCacheKey=()=> 'toy-box-edges-v1';}
   shared.set(key,mat);
  }
  replaced.add(old);o.material=shared.get(key);o.castShadow=!old.transparent;o.receiveShadow=true;
  if(box){
   const geo=o.geometry;geo.computeBoundingBox();const half=geo.boundingBox.getSize(new T.Vector3()).multiplyScalar(.5),center=geo.boundingBox.getCenter(new T.Vector3()),p=geo.attributes.position;
   const local=[],extents=[];for(let i=0;i<p.count;i++){local.push(p.getX(i)-center.x,p.getY(i)-center.y,p.getZ(i)-center.z);extents.push(half.x,half.y,half.z);}
   geo.setAttribute('toyLocal',new T.Float32BufferAttribute(local,3));geo.setAttribute('toyHalf',new T.Float32BufferAttribute(extents,3));
  }
 });
 replaced.forEach(m=>m.dispose());
}
export function buildToyShowcase(build,look,team){
 const root=new T.Group();root.userData.toyShowcase=true;
 for(const [i,kind] of ['crumb','popper','four-slice'].entries()){
  const u=build(kind,look,team);u.position.x=(i-1)*2.8;u.userData.showcaseX=u.position.x;root.add(u);
 }
 return root;
}
export function poseToyShowcase(root,{active,age,expression}){
 root.children.forEach((u,i)=>{
  if(u.userData.cute){poseCute(u,{active,age,expression,homeX:u.userData.showcaseX});return;}
  const heavy=i===2,cycle=age/(heavy?.9:.6),phase=cycle%1,flight=Math.min(1,phase/.72),moving=active==='move',hop=moving?4*flight*(1-flight):0;
  u.position.set(u.userData.showcaseX+(moving?(Math.floor(cycle)+flight*flight*(3-2*flight))*.22:0),(heavy?.18:.32)*hop,0);
  u.scale.set(1+(moving?.04*Math.cos(flight*Math.PI*2):0),1+(moving?-.08*Math.cos(flight*Math.PI*2):0),1);
  u.rotation.x=moving?-.12*hop:0;
  u.traverse(p=>{if(!p.userData.home)return;p.position.copy(p.userData.home);
   if(/^toast/.test(p.name))p.position.y+=.035*Math.sin(age*11-i)*Math.exp(-.3*(age%1))+(active==='attack'?.65*Math.max(0,Math.sin(Math.min(1,(age%1)/.38)*Math.PI)):0);
   if(/^foot-/.test(p.name))p.position.y+=hop*.09;
  });
 });
}
export function createToyStage(scene){
 const rig=new T.Group();rig.name='toy-light-rig';
 for(const [color,intensity,pos] of [[0xffedd7,2.6,[-8,14,9]],[0xd7edff,.65,[7,5,-4]],[0xffffff,.9,[4,9,-10]]]){const light=new T.DirectionalLight(color,intensity);light.position.fromArray(pos);rig.add(light);}
 const key=rig.children[0];key.castShadow=true;key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-28,right:28,top:28,bottom:-28,near:.5,far:65});key.shadow.bias=-.00015;key.shadow.normalBias=.025;
 rig.add(new T.HemisphereLight(0xe8f5ff,0x65727d,.85));scene.add(rig);
 const plane=new T.Mesh(new T.PlaneGeometry(160,160),new T.MeshStandardMaterial({color:0xede9e0,roughness:.95}));plane.name='toy-ivory-plane';plane.rotation.x=-Math.PI/2;plane.position.y=-.12;plane.receiveShadow=true;scene.add(plane);
 // Linear alpha data: no colour-space transform on the radial shadow mask.
 const size=32,data=new Uint8Array(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const j=(y*size+x)*4,r=Math.hypot((x+.5-size/2)/(size/2),(y+.5-size/2)/(size/2));data[j+3]=Math.round(255*Math.max(0,1-r*r)**2);}
 const texture=new T.DataTexture(data,size,size);texture.needsUpdate=true;
 const material=new T.MeshBasicMaterial({color:0x303844,map:texture,transparent:true,opacity:.25,depthWrite:false});
 const decals=new T.InstancedMesh(new T.PlaneGeometry(1,1),material,256);decals.name='toy-contact-decals';decals.frustumCulled=false;scene.add(decals);
 let batches=new T.Group();batches.name='toy-part-batches';scene.add(batches);
 let entries=[];const dummy=new T.Object3D();
 function clear(){entries=[];for(const b of [...batches.children]){b.dispose();batches.remove(b);}}
 function batch(roots){
  clear();const groups=new Map();
  for(const root of roots)root.traverse(o=>{
   if(o.name==='power-cord'||!o.isMesh||o.isInstancedMesh||o.userData.ink||!o.material?.isMeshStandardMaterial||o.material.transparent)return;
   // Identical local geometry shares one GPU buffer, including differently placed pivots.
   o.updateWorldMatrix(true,false);const pos=o.getWorldPosition(new T.Vector3()),chunk=[Math.floor(pos.x/8),Math.floor(pos.z/8)].join(',');
   const g=o.geometry,key=[chunk,o.material.uuid,Array.from(g.attributes.position.array).join(','),g.index?Array.from(g.index.array).join(','):''].join('|');
   if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);o.layers.set(1);
  });
  for(const sources of groups.values()){
   const first=sources[0],b=new T.InstancedMesh(first.geometry,first.material,sources.length);b.castShadow=true;b.receiveShadow=true;b.instanceMatrix.setUsage(T.DynamicDrawUsage);b.frustumCulled=true;batches.add(b);entries.push({b,sources});
  }
 }
 function sync(units,enabled,stressOn=false){
  batches.visible=enabled;decals.visible=enabled;
  scene.updateMatrixWorld(true);
  for(const {b,sources} of entries){sources.forEach((s,i)=>{let visible=true;for(let p=s;p;p=p.parent)visible&&=p.visible;dummy.matrix.copy(s.matrixWorld);if(!visible)dummy.matrix.scale(new T.Vector3(0,0,0));b.setMatrixAt(i,dummy.matrix);});b.instanceMatrix.needsUpdate=true;b.computeBoundingSphere();}
  const targets=units.flatMap(u=>u.userData.toyShowcase?u.children:[u]);decals.count=stressOn?200:Math.min(256,targets.length);
  for(let i=0;i<decals.count;i++){
   const u=targets[i];if(stressOn)dummy.position.set((i%20-9.5)*.65,-.105,(Math.floor(i/20)-4.5)*.75);
   else {u.getWorldPosition(dummy.position);dummy.position.y=-.105;}
   const body=u?.getObjectByName('body');let width=1,depth=.8;if(body?.geometry.attributes.position.count){body.geometry.computeBoundingBox();const size=body.geometry.boundingBox.getSize(new T.Vector3());width=size.x*body.scale.x*1.1;depth=size.z*body.scale.z*1.1;}
   dummy.rotation.set(-Math.PI/2,0,0);dummy.scale.set(stressOn?.86:width,stressOn?.88:depth,1);dummy.updateMatrix();decals.setMatrixAt(i,dummy.matrix);
  }decals.instanceMatrix.needsUpdate=true;
 }
 return {rig,plane,batch,sync,clear,dispose(){clear();plane.geometry.dispose();plane.material.dispose();decals.geometry.dispose();material.dispose();texture.dispose();decals.dispose();scene.remove(rig,plane,decals,batches);}};
}

// Each rigid part gets its own batch; the lab uploads the common hop transform once per batch.
export function buildToyStress(source){
 applyToyMaterials(source);source.updateMatrixWorld(true);
 const batches=[],materials=new Map();
 source.traverse(o=>{
  if(!o.isMesh||o.userData.ink||!o.geometry.attributes.position.count)return;
  const geometry=o.geometry.clone();geometry.applyMatrix4(o.matrixWorld);
  if(!materials.has(o.material)){
   const m=o.material.clone();m.onBeforeCompile=o.material.onBeforeCompile;m.customProgramCacheKey=o.material.customProgramCacheKey;materials.set(o.material,m);
  }
  const batch=new T.InstancedMesh(geometry,materials.get(o.material),200);batch.name=batches.length?'stress-part-'+o.name:'stress-bots';batch.userData.springHops=true;batch.userData.toyStressPart=true;batch.castShadow=true;batch.receiveShadow=true;batch.instanceMatrix.setUsage(T.DynamicDrawUsage);batch.frustumCulled=false;batches.push(batch);
 });return batches;
}
