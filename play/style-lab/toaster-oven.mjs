import * as T from 'three';
import {buildBible} from './bible.mjs';
// Six independent rigid pivots; the two parade-ready soldiers ride the tray.
export function buildOven(look,team){
  const root=new T.Group();
  const mat=c=>new T.MeshPhysicalMaterial({color:c,flatShading:true,roughness:look==='Y2K GLOSS'?.2:.85,clearcoat:look==='Y2K GLOSS'?1:0});
  const cream=mat(0xf2d7a6),dark=mat(0x303844),paint=mat(team==='orange'?0xff8540:0x32d9e8),heat=mat(0xf25745);
  heat.emissive.setHex(0xf25745);heat.emissiveIntensity=.4;
  const pivot=name=>{const g=new T.Group();g.name=name;root.add(g);return g;};
  const mesh=(p,g,m,x,y,z)=>{const o=new T.Mesh(g,m);o.position.set(x,y,z);p.add(o);return o;};
  const box=(p,w,h,d,m,x,y,z)=>mesh(p,new T.BoxGeometry(w,h,d),m,x,y,z);
  const shell=pivot('oven-shell');
  for(const x of [-1.14,1.14])mesh(shell,new T.CylinderGeometry(.92,.92,.18,5).rotateZ(Math.PI/2),cream,x,1,0);
  box(shell,2.3,.16,1.3,cream,0,1.78,0);
  box(shell,2.3,1.3,.12,dark,0,1,-.62);
  box(shell,2.3,.16,1.3,paint,0,.4,0);
  box(shell,1.75,.12,.9,heat,0,1.65,0);
  const base=pivot('oven-base');
  for(const x of [-.85,.85])mesh(base,new T.CylinderGeometry(.3,.34,.3,5),dark,x,.15,0);
  const door=pivot('oven-door');
  box(door,2.12,1.2,.12,cream,0,.6,0);
  box(door,1.8,.72,.04,dark,0,.65,.085);
  for(const x of [-.42,.42])box(door,.38,.09,.035,paint,x,.75,.12);
  box(door,1.9,.16,.18,paint,0,1.12,.12);
  const tray=pivot('oven-tray');
  box(tray,1.9,.1,1.05,dark,0,.52,0);
  box(tray,1.95,.13,.12,paint,0,.57,.53);
  for(const kind of ['popper','zapper']){
    const troop=buildBible(kind,look,team);troop.name='factory-'+kind;troop.scale.setScalar(.32);root.add(troop);
    // All components are fixed together as one miniature rigid production load.
  }
  return root;
}
export function poseOven(root,{active,age,elapsed,spring,homeX}){
  const s=root.userData.motion??={},producing=['produce','spawn','attack'].includes(active),cycle=age%2.8;
  const open=producing&&cycle<2.25,extend=open&&cycle>.28;
  for(let i=0,n=Math.max(1,Math.ceil(elapsed/.008));i<n;i++){
    spring(s,'door',open?1.64:0,elapsed/n,330,20);
    spring(s,'tray',extend?1.35:0,elapsed/n,260,18);
    spring(s,'rock',Math.sin(age*5)*.014+(extend?-.025:0),elapsed/n,240,14);
    spring(s,'load',extend?Math.sin(cycle*18)*Math.exp(-cycle*3)*.12:0,elapsed/n,320,16);
  }
  const moving=active==='move',phase=age*2%1,f=Math.min(1,phase/.8);
  root.position.set(homeX+(moving?(Math.floor(age*2)+1-(1-f)**3)*.4:0),moving?.24*4*f*(1-f):0,1.2);
  root.scale.setScalar(1);root.rotation.set(0,0,0);
  root.getObjectByName('oven-shell').rotation.z=s.rock||0;
  const door=root.getObjectByName('oven-door');door.position.set(0,.4,.7);door.rotation.x=s.door||0;
  const tray=root.getObjectByName('oven-tray');tray.position.z=s.tray||0;
  for(const kind of ['popper','zapper']){
    const troop=root.getObjectByName('factory-'+kind);troop.position.set(kind==='popper'?-.48:.48,.58+(s.load||0),s.tray||0);troop.rotation.z=-(s.rock||0)*2;
  }
  root.visible=active!=='death'||age<.3;
}
