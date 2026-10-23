import * as T from 'three';
import {buildBible} from './bible.mjs';
// Six rigid pivots: chassis, two feet, toast and two broad wing plates.
export function buildFlyingToast(look,team){
  const u=buildBible('crumb',look,team);u.name='flying-toast';
  const body=u.getObjectByName('body'),toast=u.getObjectByName('toast0');
  // The slice is the pilot: broad crust silhouette with its visor rigidly attached.
  toast.scale.set(1.8,1.9,1);
  toast.position.y=1.18;
  const visor=u.getObjectByName('faceplate');
  visor.name='pilot-visor';toast.add(visor);
  visor.position.set(0,0,.15);visor.scale.set(1,.65,1);

  for(const side of [-1,1]){
    const profile=new T.Shape();
    const points=[[0,-.2],[.72,-.28],[.92,0],[.65,.3],[0,.2]];
    points.forEach(([x,z],i)=>i?profile.lineTo(x,z):profile.moveTo(x,z));profile.closePath();
    const geo=new T.ExtrudeGeometry(profile,{depth:.08,bevelEnabled:false,steps:1});
    geo.rotateX(Math.PI/2);geo.userData.facets=5;
    const wing=new T.Mesh(geo,body.material.clone());wing.name=side<0?'wing-left':'wing-right';
    if(side<0)wing.geometry.rotateY(Math.PI);
    wing.position.set(side*.37,.68,0);u.add(wing);
  }
  return u;
}
export function poseFlyingToast(u,{active,age,elapsed,spring}){
  const state=u.userData.motion,striking=active==='attack'&&age%1.1<.22;
  const steps=Math.max(1,Math.ceil(elapsed/.008));
  for(let i=0;i<steps;i++){
    const dt=elapsed/steps;
    spring(state,'wing',striking?-.65:Math.sin(age*(active==='move'?16:8))*.28,dt,280,13);
    spring(state,'flightBob',Math.sin(age*4)*.05,dt,240,15);
    spring(state,'dive',striking?.65:0,dt,300,16);
  }
  u.position.y+=.85+(state.flightBob||0)-(state.dive||0)*.35;
  u.rotation.x+=state.dive||0;
  for(const side of [-1,1])u.getObjectByName(side<0?'wing-left':'wing-right').rotation.z=side*(state.wing||0);
}
