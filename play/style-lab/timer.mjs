import * as T from 'three';
import {buildBible} from './bible.mjs';
// Six rigid pivots: chassis, feet, toast, dial and hand. No tiny dial markings.
export function buildTimer(look,team){
  const u=buildBible('crumb',look,team);u.name='timer';
  const body=u.getObjectByName('body');body.scale.x=1.35;
  const dark=body.material.clone();dark.color.setHex(0x303844);
  const dial=new T.Mesh(new T.CylinderGeometry(.43,.43,.14,5),dark);
  dial.name='dial';dial.geometry.rotateX(Math.PI/2);dial.position.set(0,1.25,.08);u.add(dial);
  const face=new T.Mesh(new T.CylinderGeometry(.35,.35,.025,5),body.material.clone());
  face.geometry.rotateX(Math.PI/2);face.position.z=.085;dial.add(face);
  const hand=new T.Group();hand.name='timer-hand';hand.position.set(0,1.25,.19);hand.userData.home=hand.position.clone();u.add(hand);
  const needle=new T.Mesh(new T.BoxGeometry(.085,.3,.045),body.material.clone());
  needle.material.color.setHex(0xf25745);needle.position.y=.11;hand.add(needle);
  return u;
}
export function poseTimer(u,{active,age,elapsed,spring}){
  const state=u.userData.motion,casting=active==='cast'||active==='attack';
  const steps=Math.max(1,Math.ceil(elapsed/.008));
  for(let i=0;i<steps;i++){
    spring(state,'timerBob',Math.sin(age*4)*.025,elapsed/steps,230,14);
    spring(state,'timerWind',casting?Math.min(1,age/.18)*Math.PI*2:0,elapsed/steps,280,16);
    spring(state,'timerKick',casting&&age%1.1<.18?-.22:0,elapsed/steps,300,14);
  }
  const dial=u.getObjectByName('dial'),hand=u.getObjectByName('timer-hand');
  dial.position.copy(dial.userData.home);dial.position.y+=state.timerBob||0;
  dial.rotation.z=state.timerKick||0;
  hand.position.copy(hand.userData.home);hand.position.y+=state.timerBob||0;
  hand.rotation.z=-Math.floor(age*5)*Math.PI*2/5+(state.timerWind||0);
  const toast=u.getObjectByName('toast0');toast.position.y+=(state.timerBob||0)-(state.timerKick||0);
}
