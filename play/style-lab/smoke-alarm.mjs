import * as T from 'three';
import {buildBible} from './bible.mjs';
// Six rigid pivots: alarm shell, two stabilisers, toast, beacon, pulse effect.
export function buildSmokeAlarm(look,team){
  const u=buildBible('crumb',look,team);u.name='smoke-alarm';
  const body=u.getObjectByName('body');
  body.geometry.dispose();body.geometry=new T.CylinderGeometry(.88,.98,.4,5);body.position.y=.65;
  u.getObjectByName('faceplate').position.set(0,0,.81);
  u.getObjectByName('shoulder').position.set(.63,.06,.55);
  u.getObjectByName('slot0').position.set(0,.23,-.15);
  const toast=u.getObjectByName('toast0');toast.position.set(0,.96,-.15);toast.scale.set(.8,.6,.8);
  for(const side of ['left','right']){
    const fin=u.getObjectByName('foot-'+side);fin.name='stabiliser-'+side;
    fin.position.set(side==='left'?-.73:.73,.35,0);
  }
  const light=new T.Mesh(new T.CylinderGeometry(.18,.24,.23,5),body.material.clone());
  light.name='alarm-light';light.material.color.setHex(0xf25745);light.material.emissive.setHex(0xf25745);
  light.position.set(0,.98,.29);u.add(light);
  const pulseMaterial=body.material.clone();pulseMaterial.color.setHex(team==='orange'?0xff8540:0x32d9e8);
  pulseMaterial.emissive.copy(pulseMaterial.color);pulseMaterial.emissiveIntensity=1;
  pulseMaterial.transparent=true;pulseMaterial.depthWrite=false;pulseMaterial.side=T.DoubleSide;
  const ring=new T.Mesh(new T.RingGeometry(.96,1.04,5),pulseMaterial);
  ring.name='beep-ring';ring.rotation.x=-Math.PI/2;ring.position.y=.65;ring.visible=false;u.add(ring);
  return u;
}
export function poseSmokeAlarm(u,{active,age,elapsed,spring,homeX}){
  const s=u.userData.motion??={},moving=active==='move',detecting=['detect','attack'].includes(active);
  const cycle=age*2,phase=cycle%1,flight=Math.min(1,phase/.65);
  const pulse=age%(detecting?.8:2),beep=pulse<.5;
  for(let i=0,n=Math.max(1,Math.ceil(elapsed/.008));i<n;i++){
    const dt=elapsed/n;
    spring(s,'hover',Math.sin(age*5)*.045+(moving?.18*4*flight*(1-flight):0),dt,240,14);
    spring(s,'recoil',detecting&&pulse<.12?.2:moving?-.13:0,dt,320,15);
    spring(s,'beacon',beep?.09:0,dt,360,14);
    spring(s,'fin',Math.sin(age*(moving?15:5))*.1,dt,220,12);
  }
  // Flight advances only during each thrust hop, then holds for the recovery beat.
  const travel=moving?(Math.floor(cycle)+1-(1-flight)**3)*.55:0;
  u.position.set(homeX+travel,1+(s.hover||0),1.2);
  u.rotation.set(s.recoil||0,0,-(s.fin||0)*.15);u.scale.set(1,1,1);
  for(const side of ['left','right'])u.getObjectByName('stabiliser-'+side).rotation.z=(side==='left'?-1:1)*(s.fin||0);
  const light=u.getObjectByName('alarm-light');light.position.y=.98+(s.beacon||0);
  light.material.emissiveIntensity=pulse<.12?2.4:0;
  u.getObjectByName('toast0').position.y=.96+(s.beacon||0)*.6;
  const ring=u.getObjectByName('beep-ring');ring.visible=beep;
  ring.scale.setScalar(1+pulse*3);ring.material.opacity=Math.max(0,1-pulse*2);
  u.visible=active!=='death'||age<.45;
}
