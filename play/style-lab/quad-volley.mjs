import * as T from 'three';
import {buildBible} from './bible.mjs';
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
function sample(t,keys){for(let i=1;i<keys.length;i++)if(t<=keys[i][0]){const [end,v]=keys[i];return keys[i-1][1]+(v-keys[i-1][1])*smooth((t-end+30)/30);}return keys.at(-1)[1];}
export function buildQuadVolley(look,team){
 const u=buildBible('four-slice',look,team),anchor=u.getObjectByName('foot-right');
 const geo=u.getObjectByName('toast0').geometry;
 for(let i=0;i<4;i++){
  const m=new T.Mesh(geo.clone(),u.getObjectByName('toast0').material.clone());m.name='quad-slice'+i;m.visible=false;anchor.add(m);
 }
 const flash=new T.Mesh(new T.CircleGeometry(.8,5),new T.MeshBasicMaterial({color:0xffffff,side:T.DoubleSide}));flash.name='quad-flash';flash.visible=false;anchor.add(flash);
 return u;
}
// 0–80 brace; 80–160 one-beat hold; 160–200 pop; 200–340 spread; 340–410 hit; 410–520 settle.
export function poseQuadVolley(u,{active,age,ms,homeX=0}){
 const t=Math.max(0,Math.min(520,ms??age*1000)),attack=active==='attack';
 u.position.set(homeX,0,1.2);u.rotation.set(0,0,0);u.scale.set(1,1,1);
 for(const p of u.children){p.position.copy(p.userData.home);p.rotation.set(0,0,0);p.visible=true;}
 const body=u.getObjectByName('body'),brow=u.getObjectByName('brow');
 const recoil=attack?sample(t,[[0,0],[80,-.2],[160,-.2],[200,.23],[340,.23],[410,-.04],[520,0]]):0;
 body.rotation.x=recoil;brow.rotation.x=recoil*.5;
 u.userData.cameraShake=attack&&t>=200&&t<300?.035*Math.sin((t-200)*.19)*(1-(t-200)/100):0;
 for(let i=0;i<2;i++){
  const toast=u.getObjectByName('toast'+i);toast.visible=!attack||t<200||t===520;
  const r=Math.max(0,t-340)/1000;
  toast.position.y+=attack?sample(t,[[0,0],[80,-.16],[160,-.16],[200,.5],[340,0],[520,0]]):Math.sin(age*4+i*.4)*.02;
  if(attack&&t>=340)toast.position.y+=.1*Math.exp(-20*r)*Math.sin(45*r)*(1-smooth((t-410)/110));
 }
 const f=Math.max(0,Math.min(1,(t-200)/140));
 for(let i=0;i<4;i++){
  const m=u.getObjectByName('quad-slice'+i),a=m.parent.position;
  m.visible=attack&&t>=200&&t<340;
  m.position.set((i-1.5)*(.3+.55*f)-a.x,1.95-1.2*f+2.4*f*(1-f)-a.y,3*f-a.z);
  m.rotation.set(-Math.PI*f,0,(i-1.5)*f*.2);
 }
 const flash=u.getObjectByName('quad-flash');flash.visible=attack&&t>=340&&t<375;flash.position.set(-flash.parent.position.x,.75-flash.parent.position.y,2.95);
 if(!attack){
  const cycle=age*1.8,phase=cycle%1,p=Math.min(1,phase/.8);
  if(active==='move'){
   u.position.x+=(Math.floor(cycle)+smooth(p))*.4;u.position.y=.23*4*p*(1-p);u.rotation.x=phase<.8?-.13:0;
   for(const name of ['foot-left','foot-right'])u.getObjectByName(name).position.y=phase<.8?.23:.1;
   body.position.y+=phase>=.8?-.055*Math.sin((phase-.8)*5*Math.PI):.025*Math.sin(p*Math.PI);
  }else body.rotation.x=Math.sin(age*3)*.015;
 }
}
