import * as T from 'three';
export const SPECIAL_ATTACKS=['broiler','flak-popper','bagel','crumb'];
const clamp=x=>Math.max(0,Math.min(1,x));
const ease=x=>{x=clamp(x);return x*x*(3-2*x);};
function pose(t,keys){for(let i=1;i<keys.length;i++)if(t<=keys[i][0])return keys[i-1][1]+(keys[i][1]-keys[i-1][1])*ease((t-keys[i][0]+30)/30);return keys.at(-1)[1];}
export function buildSpecialAttack(u,kind){
 u.userData.specialKind=kind;
 const body=u.getObjectByName('body');
 for(const name of ['flak0','flak1']){const old=u.getObjectByName(name);if(old){old.removeFromParent();old.geometry.dispose();}}
 // Static trim and old effects belong to a rigid chassis, never extra articulated parts.
 const keep=kind==='broiler'?['body','leg-left','leg-right','door']:kind==='bagel'?['body','axle-front','axle-back','brake']:kind==='crumb'?['body','foot-left','foot-right','toast0']:['body','feet','toast0'];
 u.updateMatrixWorld(true);
 for(const p of [...u.children])if(!keep.includes(p.name))body.attach(p);
 const fx=new T.Group();fx.name='special-effects';u.add(fx);
 const gold=new T.MeshPhysicalMaterial({color:0xd99448,flatShading:true,roughness:.8});
 const add=(name,geo,mat=gold)=>{const m=new T.Mesh(geo,mat);m.name=name;m.visible=false;fx.add(m);return m;};
 const shell=new T.CylinderGeometry(.27,.38,.75,5);shell.userData.facets=5;
 add('special-shell',shell);
 for(let i=0;i<5;i++){const geo=new T.CylinderGeometry(.12,.17,.19,5);geo.userData.facets=5;add('special-crumb'+i,geo);}
 add('special-flash',new T.CircleGeometry(.55,5),new T.MeshBasicMaterial({color:0xffffff,side:T.DoubleSide}));
 if(kind==='broiler')add('special-fire',new T.ConeGeometry(.7,.85,5),new T.MeshBasicMaterial({color:0xf25745}));
 u.traverse(o=>{o.userData.specialHome=o.position.clone();o.userData.specialRotation=o.rotation.clone();o.userData.specialScale=o.scale.clone();o.userData.specialVisible=o.visible;});
 return u;
}
export function poseSpecialAttack(u,{active,age,ms,homeX=0}){
 if(active==='attack'&&(ms??age*1000)>=520)return poseSpecialAttack(u,{active,age:0,ms:0,homeX});
 const kind=u.userData.specialKind,t=clamp((ms??age*1000)/520)*520,attacking=active==='attack';
 u.traverse(o=>{if(o===u||o.userData.ink)return;o.position.copy(o.userData.specialHome);o.rotation.copy(o.userData.specialRotation);o.scale.copy(o.userData.specialScale);o.visible=o.userData.specialVisible;});
 u.position.set(homeX,kind==='bagel'?.8:0,1.2);u.rotation.set(0,0,0);u.scale.set(1,1,1);u.userData.cameraShake=0;
 const body=u.getObjectByName('body');
 if(!attacking){
  const c=age*2,phase=c-Math.floor(c),p=clamp(phase/.8);
  if(active==='move'){
   const distance=(Math.floor(c)+ease(p))*.5;
   u.position.x+=distance;
   if(kind==='bagel')body.rotation.z=-distance/.8;
   else{u.position.y=.3*4*p*(1-p);body.rotation.x=phase<.8?-.15:0;}
  }else body.rotation.x=.015*Math.sin(age*4);
  return;
 }
 const recoil=pose(t,[[0,0],[80,-.18],[160,-.18],[200,.22],[340,.22],[410,-.07],[520,0]]);
 body.rotation.x+=recoil;
 const r=clamp((t-410)/110),spring=Math.exp(-5*r)*Math.sin(12*r)*(1-r);
 if(t>=410)body.rotation.z+=spring*.13;
 if(kind==='broiler'){
  u.getObjectByName('door').rotation.x=pose(t,[[0,0],[80,-.2],[160,-1.4],[200,-1.4],[340,-1.4],[410,-.3],[520,0]]);
  u.userData.cameraShake=t>=340&&t<410?.035*Math.sin(t*.2)*(1-(t-340)/70):0;
 }
 const f=clamp((t-200)/140),shell=u.getObjectByName('special-shell');
 shell.visible=kind!=='bagel'&&kind!=='crumb'&&t>=200&&t<340;
 shell.position.set(0,1.25+(kind==='flak-popper'?f*2.4:2.8*f*(1-f)-.5*f),kind==='flak-popper'?0:f*2.5);
 shell.rotation.z=f*2;
 if(kind==='broiler')shell.scale.set(1.7,1.7,1.7);
 for(let i=0;i<5;i++){
  const m=u.getObjectByName('special-crumb'+i),a=i*Math.PI*2/5;
  const burst=clamp((t-340)/70);
  m.visible=kind==='crumb'?t>=200&&t<410:kind==='flak-popper'&&t>=340&&t<410;
  const q=kind==='crumb'?clamp((t-200)/210):burst;
  m.position.set(Math.cos(a)*q*.8,kind==='flak-popper'?3.65+Math.sin(a)*q*.7:1+q*(1-q),kind==='crumb'?q*2.5:Math.sin(a)*q*.8);
  m.rotation.z=q*(i+1);
 }
 if(kind==='bagel'){
  const d=pose(t,[[0,0],[80,-.15],[160,-.15],[200,0],[340,2.4],[410,.7],[520,0]]);
  u.position.z+=d;u.position.y+=t>=340&&t<520?.3*Math.sin(Math.PI*(t-340)/180):0;
  body.rotation.z=-d/.8+(t>=410?spring*.5:0);
 }
 if(kind==='crumb'&&t>=410){u.position.z-=.5*Math.sin(Math.PI*r);u.position.y=.5*Math.sin(Math.PI*r);}
 const flash=u.getObjectByName('special-flash');flash.visible=t>=340&&t<375;flash.position.set(0,kind==='flak-popper'?3.6:.8,kind==='flak-popper'?0:2.5);
 const fire=u.getObjectByName('special-fire');if(fire){fire.visible=t>=340&&t<410;fire.position.set(0,.4,2.5);fire.scale.setScalar(1+clamp((t-340)/70)*.4);}
}
