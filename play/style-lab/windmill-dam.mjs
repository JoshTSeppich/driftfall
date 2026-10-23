import * as T from 'three';

// One paired power-site study. Architecture stays planted; mechanisms take the impulses.
export function buildWindmillDam(look,team){
 const root=new T.Group();root.userData.blocky=true;
 const color=team==='orange'?0xff8540:0x32d9e8;
 const mesh=(parent,name,geo,c,x,y,z)=>{
  const m=new T.Mesh(geo,new T.MeshStandardMaterial({color:c,flatShading:true,roughness:look==='Y2K GLOSS'?.3:.85}));
  m.name=name;m.position.set(x,y,z);parent.add(m);return m;
 };
 const box=(p,n,w,h,d,c,x,y,z)=>mesh(p,n,new T.BoxGeometry(w,h,d),c,x,y,z);
 box(root,'high-ground-pad',3,1,3,0x71878a,-2,.5,-1);
 box(root,'river-bed',3,.15,7,0x303f48,2,-.1,0);
 box(root,'upstream',2.8,.12,3.1,0x244e67,2,.42,-1.9);
 box(root,'downstream',2.8,.12,3.1,0x367d8a,2,.42,1.9);
 const mill=new T.Group();mill.name='windmill';mill.position.set(-2,1,-1);root.add(mill);
 box(mill,'tower',.85,1.8,.8,0xf2d7a6,0,.9,0);
 const hub=new T.Group();hub.name='windmill-hub';hub.position.set(0,1.9,.55);mill.add(hub);
 mesh(hub,'hub',new T.CylinderGeometry(.24,.24,.3,5).rotateX(Math.PI/2),color,0,0,0);
 for(let i=0;i<4;i++){
  const pivot=new T.Group();pivot.name='sail-'+i;pivot.rotation.z=i*Math.PI/2;hub.add(pivot);
  box(pivot,'plank',.3,1.25,.12,0xd99448,0,.82,0);
 }
 const dam=new T.Group();dam.name='dam';dam.position.set(2,0,0);root.add(dam);
 // Three broad masonry pieces and a single hinged sluice, each independently pivoted.
 for(let i=0;i<3;i++){
  const p=new T.Group();p.name='stone-'+i;p.position.set(i-1,0,0);dam.add(p);
  box(p,'stone-block',.96,i===1?.65:1,.7,0xa0a7a0,0,(i===1?.65:1)/2,0);
 }
 const gate=new T.Group();gate.name='sluice';gate.position.set(0,.72,.4);dam.add(gate);
 box(gate,'power-band',.75,.22,.15,color,0,0,0);
 box(root,'spillway',.65,.08,1.5,0x499caa,2,.28,1);
 root.userData.flowHome=1;return root;
}
export function poseWindmillDam(root,{active,age,elapsed,spring}){
 const s=root.userData.motion??={},working=['attack','gather','generate'].includes(active);
 const n=Math.max(1,Math.ceil(elapsed/.008)),dt=elapsed/n;
 for(let i=0;i<n;i++){
  spring(s,'speed',working?4:1,dt,80,14);s.angle=(s.angle||0)+s.speed*dt;
  spring(s,'wobble',Math.sin(age*(working?16:4))*(working?.09:.018),dt,200,12);
  spring(s,'built',working?1:0,dt,90,18);
  spring(s,'gate',working?-.6:0,dt,220,14);
 }
 const hub=root.getObjectByName('windmill-hub');hub.rotation.z=s.angle||0;hub.rotation.y=s.wobble||0;
 for(let i=0;i<4;i++)root.getObjectByName('sail-'+i).rotation.x=(s.wobble||0)*(i%2?1:-1);
 root.getObjectByName('sluice').rotation.x=s.gate||0;
 root.getObjectByName('downstream').position.y=.42-.32*(s.built||0);
 const flow=root.getObjectByName('spillway');flow.visible=(s.built||0)>.05;
 flow.position.z=.9+(age*1.7%1)*.3;flow.position.y=.35-.15*(s.built||0);
 for(const name of ['hub','power-band']){
  const m=root.getObjectByName(name);m.material.emissive.copy(m.material.color);m.material.emissiveIntensity=working?1.1+.15*Math.sin(age*6):0;
 }
 // Move is a readiness wobble, never a sliding building.
 root.position.set(0,0,0);
}
