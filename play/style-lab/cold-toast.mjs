import * as T from 'three';
import {buildBible} from './bible.mjs';
// Five rigid pivots: chassis, two feet, frosty toast and dangling unplugged plug.
export function buildColdToast(look,team){
  const u=buildBible('crumb',look,team);u.name='cold-toast';
  const body=u.getObjectByName('body');body.scale.x=1.3;body.material.color.setHex(0x303844);
  const toast=u.getObjectByName('toast0');toast.material.color.setHex(0xa6ddec);
  const plug=new T.Mesh(new T.CylinderGeometry(.16,.19,.28,5),body.material.clone());
  plug.name='unplugged-plug';plug.position.set(.62,.38,-.48);plug.rotation.x=Math.PI/2;u.add(plug);
  for(const x of [-.07,.07]){
    const pin=new T.Mesh(new T.BoxGeometry(.055,.06,.16),new T.MeshPhysicalMaterial({color:0xa6ddec,flatShading:true}));pin.position.set(x,.19,0);plug.add(pin);
  }
  // Edge lines survive invisibility in every look; they follow each rigid mesh.
  u.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.userData.solidOpacity=o.material.opacity;}});
  const meshes=[];u.traverse(o=>{if(o.isMesh)meshes.push(o);});
  for(const o of meshes){
    const edge=new T.LineSegments(new T.EdgesGeometry(o.geometry),new T.LineBasicMaterial({color:0xa6ddec,transparent:true,opacity:.12,depthWrite:false}));
    edge.name='stealth-outline';edge.visible=false;o.add(edge);
  }
  u.userData.hiddenFraction=0;return u;
}
export function poseColdToast(u,{active,age,elapsed,spring}){
  const hidden=active==='hide'||active==='shimmer',state=u.userData.motion;
  const fade=Math.min(1,age/.5);u.userData.hiddenFraction=hidden?fade:Math.max(0,(u.userData.hiddenFraction||0)-elapsed*3);
  const fraction=u.userData.hiddenFraction;
  const steps=Math.max(1,Math.ceil(elapsed/.008));
  for(let i=0;i<steps;i++){
    spring(state,'coldBob',Math.sin(age*4)*.025,elapsed/steps,220,14);
    spring(state,'plugKick',hidden?.3:0,elapsed/steps,270,15);
  }
  const plug=u.getObjectByName('unplugged-plug');plug.position.copy(plug.userData.home);plug.position.z-=state.plugKick||0;
  plug.rotation.z=(state.coldBob||0)*3+(state.plugKick||0);
  const toast=u.getObjectByName('toast0');toast.material.color.setHex(0xa6ddec);toast.position.y+=state.coldBob||0;
  u.traverse(o=>{
    if(o.name==='stealth-outline'){o.visible=fraction>0;o.material.opacity=.12*fraction;}
    if(o.userData.ink){o.visible=fraction===0;return;}
    if(o.isMesh){o.material.transparent=fraction>0;o.material.opacity=(1-fraction)*o.userData.solidOpacity;o.material.depthWrite=fraction===0;}
  });
}
