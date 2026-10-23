import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {buildBible} from './bible.mjs';
// Six rigid pivots: open box, roll-top, two lift pods, toast and passenger.
export function buildBreadbox(look,team){
  const u=buildBible('crumb',look,team);u.name='breadbox';
  const body=u.getObjectByName('body');
  const panels=[new T.BoxGeometry(1.7,.12,1.1).translate(0,-.36,0),new T.BoxGeometry(1.7,.72,.1).translate(0,0,-.5)];
  for(const x of [-.8,.8]){
    const side=new T.CylinderGeometry(.58,.58,.1,5).rotateZ(Math.PI/2);side.translate(x,.1,0);panels.push(side);
  }
  body.geometry.dispose();body.geometry=mergeGeometries(panels);panels.forEach(g=>g.dispose());
  body.position.y=.7;
  u.getObjectByName('faceplate').position.set(0,-.18,.57);
  u.getObjectByName('shoulder').position.set(.61,.05,.57);
  u.getObjectByName('slot0').position.set(0,.4,-.3);
  const toast=u.getObjectByName('toast0');toast.position.set(0,1.15,-.3);
  for(const side of ['left','right']){
    const pod=u.getObjectByName('foot-'+side);pod.name='lift-'+side;
    pod.position.set(side==='left'?-1:1,.45,0);pod.scale.set(1.2,1.8,1.2);
  }
  const lid=new T.Mesh(new T.CylinderGeometry(.6,.6,1.5,5).rotateZ(Math.PI/2),body.material.clone());
  lid.name='roll-top';lid.position.set(0,.82,0);u.add(lid);
  // One rigid passenger, with all its recognisable details fixed to its chassis.
  const passenger=buildBible('crumb',look,team),cargo=new T.Group();cargo.name='cargo-unit';
  for(const name of ['shoulder','brow','slot0']){const detail=passenger.getObjectByName(name);detail.removeFromParent();detail.geometry.dispose();}
  while(passenger.children.length)cargo.add(passenger.children[0]);
  cargo.scale.setScalar(.38);cargo.position.set(0,.55,0);u.add(cargo);
  return u;
}
export function poseBreadbox(u,{active,age,elapsed,spring,homeX}){
  const s=u.userData.motion??={},dropping=['drop','attack','deliver'].includes(active),open=dropping&&age<.9;
  for(let i=0,n=Math.max(1,Math.ceil(elapsed/.008));i<n;i++){
    const dt=elapsed/n;
    spring(s,'lid',open?1.85:0,dt,300,18);
    spring(s,'hover',Math.sin(age*4)*.055,dt,180,12);
    spring(s,'bank',active==='move'?-.18:open?.12:0,dt,220,14);
    spring(s,'pod',Math.sin(age*(active==='move'?14:6))*.09,dt,230,12);
  }
  u.scale.set(1,1,1);u.rotation.set(s.bank||0,0,0);
  u.position.set(homeX+(active==='move'?Math.sin(age*1.2)*1.4:0),1.15+(s.hover||0),1.2+(active==='move'?Math.cos(age*1.2)*.5:0));
  const lid=u.getObjectByName('roll-top');lid.rotation.x=s.lid||0;
  // Rigid drum rolls backwards to expose the cargo bay, without bending slats.
  lid.position.z=-Math.sin(Math.min(1.57,s.lid||0))*.6;
  lid.position.y=.82+Math.sin(Math.min(1.57,s.lid||0))*.27;
  for(const side of ['left','right'])u.getObjectByName('lift-'+side).rotation.z=(side==='left'?-1:1)*(s.pod||0);
  u.getObjectByName('toast0').position.y=1.15+(s.hover||0)*.7;
  const cargo=u.getObjectByName('cargo-unit'),p=Math.max(0,age-.26);
  cargo.visible=dropping&&age>.26&&age<1.05;
  cargo.position.set(0,.55-3*p*p,.65+p*.5);cargo.rotation.x=-p*.2;
  u.visible=active!=='death'||age<.45;
}
