import * as T from 'three';
import {buildBible} from './bible.mjs';
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
// Military key poses hold until their final 30 ms transition.
function sample(t,keys){for(let i=1;i<keys.length;i++)if(t<=keys[i][0]){const [end,v]=keys[i];return keys[i-1][1]+(v-keys[i-1][1])*smooth((t-end+30)/30);}return keys.at(-1)[1];}
export function buildHotCoil(look,team){
  const u=buildBible('zapper',look,team),anchor=u.getObjectByName('foot-right');
  const mat=c=>new T.MeshPhysicalMaterial({color:c,flatShading:true,roughness:look==='Y2K GLOSS'?.3:.85,clearcoat:look==='Y2K GLOSS'?1:0});
  // One broad pentagonal toast silhouette; effects are fixed to the planted reference foot.
  const toast=new T.CylinderGeometry(.42,.42,.22,5);toast.rotateX(Math.PI/2);
  for(const [name,geo,color] of [['hot-bolt',toast,0xd99448],['hot-target',toast.clone(),0xd99448],['hot-flash',new T.CircleGeometry(.55,5),0xffffff]]){
    const m=new T.Mesh(geo,mat(color));m.name=name;m.visible=false;anchor.add(m);
    if(name!=='hot-target'){m.material.emissive.setHex(name==='hot-flash'?0xffffff:0xff8540);m.material.emissiveIntensity=name==='hot-flash'?2:3;}
    if(name==='hot-flash')m.material.side=T.DoubleSide;
  }
  return u;
}
export function poseHotCoil(u,{active,age,ms,homeX=0}){
  const t=Math.max(0,Math.min(520,ms??age*1000)),attack=active==='attack';
  const body=u.getObjectByName('body'),face=u.getObjectByName('faceplate');
  u.position.set(homeX,0,1.2);u.rotation.set(0,0,0);u.scale.set(1,1,1);
  for(const p of u.children){p.position.copy(p.userData.home);p.rotation.set(0,0,0);}
  const bolt=u.getObjectByName('hot-bolt'),target=u.getObjectByName('hot-target'),flash=u.getObjectByName('hot-flash');
  bolt.visible=attack&&t>=200&&t<340;target.visible=attack&&t<520;flash.visible=attack&&t>=340&&t<370;
  const place=(o,x,y,z)=>o.position.set(x-bolt.parent.position.x,y-bolt.parent.position.y,z-bolt.parent.position.z);
  // Target is a presentation prop, never a sim unit; heat is the only status colour.
  target.material.color.setHex(t<365?0xd99448:t<400?0x805432:0x303844);
  const q=Math.max(0,Math.min(1,(t-340)/70));place(target,0,.65+Math.sin(q*Math.PI)*.18,3+q*.16);target.rotation.x=-Math.sin(q*Math.PI)*.2;
  place(flash,0,.65,2.86);
  const flight=Math.max(0,Math.min(1,(t-200)/140));place(bolt,0,1.45-.8*flight+.45*4*flight*(1-flight),3*flight);bolt.rotation.x=-flight*Math.PI;
  const heat=attack?sample(t,[[0,0],[80,.25],[160,1],[200,1],[340,.3],[410,0],[520,0]]):0;
  for(let i=0;i<2;i++){
    const coil=u.getObjectByName('coil'+i),heater=u.getObjectByName('heater'+i);
    heater.material.emissive.setHex(0xff8540);heater.material.emissiveIntensity=heat*2.5;
    if(attack){
      // Analytic damped spring after impact, enveloped to land exactly at idle.
      const r=Math.max(0,t-340)/1000,settle=t>=340?-.12*Math.exp(-18*r)*Math.cos(42*r)*(1-smooth((t-410)/110)):0;
      coil.position.z+=t<340?sample(t,[[0,0],[160,0],[200,-.24],[340,-.12]]):settle;
      coil.rotation.x=sample(t,[[0,0],[160,.12],[200,-.3],[340,-.14],[410,.04],[520,0]]);
    }else coil.position.y+=Math.sin(age*5+i*.5)*.018;
  }
  if(attack){
    body.rotation.x=sample(t,[[0,0],[80,-.18],[160,-.18],[200,.18],[340,.18],[410,-.035],[520,0]]);
    face.rotation.x=body.rotation.x*.5;
  }else{
    const moving=active==='move',cycle=age*2.5,phase=cycle%1,p=Math.min(1,phase/.8);
    if(moving){u.position.x+=(Math.floor(cycle)+smooth(p))*.45;u.position.y=.32*4*p*(1-p);u.rotation.x=phase<.8?-.18:0;
      for(const name of ['foot-left','foot-right'])u.getObjectByName(name).position.y=phase<.8?.23:.1;
      body.position.y+=phase>=.8?-.035*Math.sin((phase-.8)/.2*Math.PI):.025*Math.sin(p*Math.PI);
    }else{body.rotation.x=Math.sin(age*4)*.018;face.position.y+=Math.sin(age*4)*.008;}
  }
}
