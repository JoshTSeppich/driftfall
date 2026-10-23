import * as T from 'three';
import {buildBible} from './bible.mjs';
export function buildPopShot(look,team){
  const u=buildBible('popper',look,team);
  const mat=c=>new T.MeshPhysicalMaterial({color:c,flatShading:true,roughness:look==='Y2K GLOSS'?.3:.85,clearcoat:look==='Y2K GLOSS'?1:0});
  // Effects ride a planted foot, never the recoiling chassis; no extra articulated parts.
  const anchor=u.getObjectByName('foot-right');
  const shot=new T.Mesh(u.getObjectByName('toast0').geometry.clone(),mat(0xd99448));shot.name='pop-projectile';anchor.add(shot);
  const crumbs=new T.Group();crumbs.name='pop-crumbs';anchor.add(crumbs);
  for(let i=0;i<5;i++){const m=new T.Mesh(new T.CylinderGeometry(.11,.15,.14,5),mat(0x805432));crumbs.add(m);}
  const flash=new T.Mesh(new T.CircleGeometry(.45,5),mat(0xffffff));flash.name='pop-flash';flash.material.side=T.DoubleSide;flash.material.emissive.setHex(0xffffff);anchor.add(flash);
  shot.visible=crumbs.visible=flash.visible=false;
  return u;
}
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
// Hold each military pose, then transition over the last 30 ms.
function sample(ms,keys){for(let i=1;i<keys.length;i++)if(ms<=keys[i][0]){const [t,v]=keys[i],prev=keys[i-1][1];return prev+(v-prev)*smooth((ms-(t-30))/30);}return keys.at(-1)[1];}
export function posePopShot(u,{active,age,homeX=0,ms}){
  const body=u.getObjectByName('body'),brow=u.getObjectByName('brow'),toast=u.getObjectByName('toast0');
  const shot=u.getObjectByName('pop-projectile'),crumbs=u.getObjectByName('pop-crumbs'),flash=u.getObjectByName('pop-flash');
  const attacking=active==='attack',t=Math.max(0,Math.min(520,ms??age*1000));
  u.position.set(homeX,0,1.2);u.rotation.set(0,0,0);u.scale.set(1,1,1);
  for(const p of [body,brow,toast]){p.position.copy(p.userData.home);p.rotation.set(0,0,0);}
  for(const name of ['foot-left','foot-right']){const p=u.getObjectByName(name);p.position.copy(p.userData.home);p.rotation.set(0,0,0);}
  shot.visible=attacking&&t>=200&&t<340;crumbs.visible=attacking&&t>=340&&t<410;flash.visible=attacking&&t>=340&&t<370;
  const heat=attacking?sample(t,[[0,0],[80,.2],[160,1],[200,0],[520,0]]):0;
  const slot=u.getObjectByName('slot0');slot.material.emissive.setHex(0xf25745);slot.material.emissiveIntensity=heat*2;
  if(attacking){
    body.rotation.x=sample(t,[[0,0],[80,-Math.PI/15],[160,-Math.PI/15],[200,.15],[340,.15],[410,0],[520,0]]);
    brow.position.y+=sample(t,[[0,0],[80,-.07],[340,-.07],[520,0]]);
    toast.position.y+=sample(t,[[0,0],[80,0],[160,-.15],[200,.40],[340,.12],[410,0],[520,0]]);
    const anchor=shot.parent;
    const place=(o,x,y,z)=>o.position.set(x-anchor.position.x,y-anchor.position.y,z-anchor.position.z);
    const p=(t-200)/140;
    place(shot,0,1.63+( .5-1.63)*p+2.8*p*(1-p),3*p);
    shot.rotation.x=-p*Math.PI;
    place(flash,0,.5,3.02);
    const q=(t-340)/70;
    crumbs.children.forEach((m,i)=>{const a=i*Math.PI*2/5;place(m,Math.cos(a)*q*.65,.5+1.5*q*(1-q),3+Math.sin(a)*q*.65);m.rotation.set(q*3,a,q*2);});
  }else{
    const moving=active==='move',cycle=age*2.5,phase=cycle%1,p=Math.min(1,phase/.8);
    const hop=moving?.32*4*p*(1-p):0;
    u.position.y=hop;
    if(moving){u.position.x+=(Math.floor(cycle)+smooth(p))*.45;u.rotation.x=phase<.8?-.18:0;
      for(const name of ['foot-left','foot-right'])u.getObjectByName(name).position.y=phase<.8?.23:.1;
      toast.position.y+=phase>=.8?.12*Math.sin((phase-.8)/.2*Math.PI):0;
    }else{body.rotation.x=Math.sin(age*4)*.018;toast.position.y+=Math.sin(age*5)*.018;brow.position.y+=Math.sin(age*4)*.008;}
  }
}
