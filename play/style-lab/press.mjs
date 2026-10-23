import * as T from 'three';

// Six rigid assemblies; the broad cross grooves are the waffle's entire detail.
export function buildPress(look,team){
  const root=new T.Group();
  const mat=c=>new T.MeshPhysicalMaterial({color:c,flatShading:true,roughness:look==='Y2K GLOSS'?.2:.85,clearcoat:look==='Y2K GLOSS'?1:0});
  const cream=mat(0xf2d7a6),dark=mat(0x303844),paint=mat(team==='orange'?0xff8540:0x32d9e8),gold=mat(0xd99448),red=mat(0xf25745);
  const pivot=name=>{const g=new T.Group();g.name=name;root.add(g);return g;};
  const mesh=(p,g,m,x,y,z)=>{const o=new T.Mesh(g,m);o.position.set(x,y,z);p.add(o);return o;};
  const box=(p,w,h,d,m,x,y,z)=>mesh(p,new T.BoxGeometry(w,h,d),m,x,y,z);
  const prism=(p,r,h,m,x,y,z)=>mesh(p,new T.CylinderGeometry(r,r,h,5),m,x,y,z);
  const base=pivot('press-base');
  prism(base,1.15,.38,cream,0,.32,0);prism(base,1.18,.13,paint,0,.49,0);
  prism(base,1.02,.08,dark,0,.58,0);
  for(const x of [-.72,.72])prism(base,.25,.18,dark,x,.09,0);
  box(base,1.1,.22,.08,dark,0,.34,.92);
  for(const x of [-.25,.25]){const eye=box(base,.28,.065,.05,paint,x,.37,.98);eye.rotation.z=x<0?-.18:.18;}
  box(base,.7,.04,.22,dark,0,.55,.6); // Oversized toast-slot recess.
  const lid=pivot('press-lid');
  prism(lid,1.12,.28,cream,0,.02,.85);prism(lid,1.15,.1,paint,0,.2,.85);
  prism(lid,1,.06,dark,0,-.15,.85);
  const handle=pivot('press-handle');
  box(handle,.88,.14,.25,dark,0,0,0);
  for(const [name,m,x] of [['shards',gold,-.36],['flux',red,.36]]){
    const p=pivot(name);prism(p,.27,.22,m,0,0,0);p.userData.side=x;
  }
  const waffle=pivot('alloy-waffle');
  prism(waffle,.72,.16,gold,0,0,0);
  box(waffle,1.12,.025,.09,dark,0,.09,0);box(waffle,.09,.025,1.12,dark,0,.09,0);
  return root;
}
export function posePress(root,{active,age,elapsed,spring,homeX}){
  const s=root.userData.motion??={},pressing=['press','gather','attack'].includes(active);
  const cycle=age%1.8,clamped=pressing&&cycle>.16&&cycle<.6;
  const moving=active==='move',phase=age*2%1,f=Math.min(1,phase/.8);
  for(let i=0,n=Math.max(1,Math.ceil(elapsed/.008));i<n;i++){
    const dt=elapsed/n;
    spring(s,'lid',clamped?0:-1.05+Math.sin(age*4)*.025,dt,480,24);
    spring(s,'bob',clamped?-.035:Math.sin(age*4)*.018,dt,420,18);
    spring(s,'waffle',pressing&&cycle>.68?.26:0,dt,360,14);
  }
  root.position.set(homeX+(moving?(Math.floor(age*2)+1-(1-f)**3)*.4:0),moving?.24*4*f*(1-f):0,1.2);
  root.rotation.set(0,0,0);root.scale.setScalar(1);
  const bob=s.bob||0,lid=root.getObjectByName('press-lid'),angle=s.lid||0;
  root.getObjectByName('press-base').position.y=bob;
  lid.position.set(0,.78+bob,-.85);lid.rotation.x=angle;
  // The handle is a separate rigid pivot following the hinged lid, with spring lag.
  const handle=root.getObjectByName('press-handle');
  handle.position.set(0,.78+bob-Math.sin(angle)*1.8,Math.cos(angle)*1.8-.85);handle.rotation.x=angle*.92;
  for(const name of ['shards','flux']){
    const p=root.getObjectByName(name);p.position.set(p.userData.side,.75+bob,0);
    p.visible=!pressing||cycle<.27;
  }
  const waffle=root.getObjectByName('alloy-waffle');
  waffle.visible=pressing&&cycle>.68;waffle.position.set(0,.72+(s.waffle||0),pressing&&cycle>.68?(cycle-.68)*.6:0);
  root.visible=active!=='death'||age<.3;
}
