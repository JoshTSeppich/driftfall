import * as T from 'three';
import {buildBible} from './bible.mjs';
// Six rigid pivots: chassis, feet, two vent pods and expressive faceplate.
export function buildDefroster(look,team){
  const u=buildBible('zapper',look,team);
  u.name='defroster';
  u.getObjectByName('body').scale.x=1.3;
  for(let i=0;i<2;i++){
    const vent=u.getObjectByName(`coil${i}`);
    vent.material=vent.material.clone();vent.material.color.setHex(0xa6ddec);
    vent.scale.set(1.35,.65,1.35);
    const mouth=u.getObjectByName(`heater${i}`);
    mouth.material=mouth.material.clone();mouth.material.color.setHex(0x303844);
    mouth.material.emissive.setHex(0xd99448);
  }
  const beam=new T.Mesh(new T.CylinderGeometry(.075,.16,1,5),new T.MeshPhysicalMaterial({color:0xf2d7a6,emissive:0xd99448,emissiveIntensity:1.5,transparent:true,opacity:.65,flatShading:true,depthWrite:false}));
  beam.name='repair-beam';beam.visible=false;u.getObjectByName('coil0').add(beam);
  return u;
}
export function poseDefroster(u,{active,age,elapsed,spring,target}){
  const state=u.userData.motion,repair=!!target&&['repair','attack'].includes(active);
  const steps=Math.max(1,Math.ceil(elapsed/.008));
  for(let i=0;i<steps;i++){
    spring(state,'ventBob',Math.sin(age*4)*.035,elapsed/steps,240,15);
    spring(state,'ventRecoil',repair?-.13:0,elapsed/steps,300,16);
  }
  for(let i=0;i<2;i++){
    const vent=u.getObjectByName(`coil${i}`);vent.position.copy(vent.userData.home);
    vent.position.y+=state.ventBob||0;vent.position.z+=state.ventRecoil||0;
    const mouth=u.getObjectByName(`heater${i}`);mouth.material.emissive.setHex(0xd99448);mouth.material.emissiveIntensity=repair?1.5:0;
  }
  const beam=u.getObjectByName('repair-beam');beam.visible=repair;
  if(!repair){if(target){target.userData.repairProgress=0;target.getObjectByName('slot0').material.emissiveIntensity=0;}return;}
  // Transform both ends into the pod's frame; suspension cannot detach the beam.
  u.updateMatrixWorld(true);target.updateMatrixWorld(true);
  const end=beam.parent.worldToLocal(target.localToWorld(new T.Vector3(0,.55,0)));
  const start=new T.Vector3(0,.3,0),delta=end.clone().sub(start);
  beam.position.copy(start).add(end).multiplyScalar(.5);
  beam.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.clone().normalize());
  beam.scale.set(1,delta.length(),1);
  beam.material.emissiveIntensity=1.3+Math.sin(age*18)*.25;
  target.userData.repairProgress=Math.min(1,age/2);
  target.getObjectByName('slot0').material.emissive.setHex(0xd99448);
  target.getObjectByName('slot0').material.emissiveIntensity=.8;
}
