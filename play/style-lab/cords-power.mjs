import * as T from 'three';
import {buildBible,poseBible} from './bible.mjs';
// Six scene pivots: two appliances, two power points, one lead bundle, one spark burst.
// Each appliance retains the four-part Crumb rig. Cords use a few straight segments, no rope rig.
export function buildPower(look,team){
  const root=new T.Group(),color=team==='orange'?0xff8540:0x32d9e8;
  const mat=c=>new T.MeshPhysicalMaterial({color:c,flatShading:true,roughness:look==='Y2K GLOSS'?.3:.85});
  for(const [name,x,z,r,h] of [['outlet',-2,-.8,.65,1],['extension-box',0,-.8,.5,.35]]){
    const o=new T.Mesh(new T.CylinderGeometry(r,r,h,5),mat(0xf2d7a6));o.name=name;o.position.set(x,h/2,z);root.add(o);
    const socket=new T.Mesh(new T.CylinderGeometry(r*.55,r*.55,.035,5),mat(0x303844));socket.position.y=h/2+.025;o.add(socket);
    const rim=new T.Mesh(new T.CylinderGeometry(r*.7,r*.7,.04,5,1,true),mat(color));rim.position.y=h/2+.02;o.add(rim);
    for(const x of [-.09,.09]){const hole=new T.Mesh(new T.BoxGeometry(.065,.025,.18),mat(0xf7f4eb));hole.position.set(x,h/2+.05,0);o.add(hole);}
  }
  for(const [name,x,z] of [['power-patient',1.45,.8],['power-crumb',-1.5,1.3]]){const u=buildBible('crumb',look,team);u.name=name;u.getObjectByName('eye-left').material=u.getObjectByName('eye-left').material.clone();u.getObjectByName('eye-right').material=u.getObjectByName('eye-right').material.clone();u.position.set(x,0,z);root.add(u);}
  const cords=new T.Group();cords.name='leads';root.add(cords);
  for(const name of ['network','patient','worker']){
    for(const glow of [false,true]){
      const line=new T.LineSegments(new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(new Float32Array(36),3)),new T.LineBasicMaterial({color:glow?color:0x303844,transparent:glow,opacity:glow?.42:1,depthWrite:!glow}));
      line.name=name+(glow?'-glow':'-cord');line.frustumCulled=false;cords.add(line);
    }
  }
  const plug=new T.Mesh(new T.CylinderGeometry(.12,.12,.2,5),mat(0x303844));plug.name='repair-plug';cords.add(plug);
  const sparks=new T.Group();sparks.name='cut-sparks';root.add(sparks);
  for(let i=0;i<5;i++){const s=new T.Mesh(new T.ConeGeometry(.045,.24,5),mat(0xf25745));s.rotation.z=i*Math.PI*2/5;sparks.add(s);}
  root.userData.powered=true;return root;
}
function lead(root,name,a,b,cut,age){
  // Angular slack follows the endpoints, including a moving appliance's back socket.
  const mid=a.clone().lerp(b,.5);mid.y=.055;mid.z-=.25;
  const points=[a,a.clone().lerp(mid,.6),mid,mid.clone().lerp(b,.5),b];
  for(const glow of [false,true]){
    const line=root.getObjectByName(name+(glow?'-glow':'-cord')),p=line.geometry.attributes.position;
    let n=0;
    for(let i=0;i<4;i++){
      const start=points[i].clone(),end=points[i+1].clone();
      if(cut&&i===1)end.lerp(start,.45);
      if(cut&&i===2)start.lerp(end,.45);
      if(glow){start.y+=.025;end.y+=.025;}
      p.setXYZ(n++,...start);p.setXYZ(n++,...end);
    }
    line.geometry.setDrawRange(0,n);p.needsUpdate=true;
    line.visible=!glow||!cut;line.material.color.setHex(cut&&Math.floor(age*6)%2?0xf25745:glow?root.userData.teamColor:0x303844);
  }
}
export function posePower(root,{active,age,elapsed,spring}){
  root.scale.setScalar(1);root.rotation.set(0,0,0);root.position.y=0;
  const state=root.userData.motion,repair=active==='replug';
  if(active==='cut-cord'){root.userData.cut=true;root.userData.battery=Math.max(0,10-age);}
  if(root.userData.cut&&active!=='cut-cord')root.userData.battery=Math.max(0,root.userData.battery-elapsed);
  if(repair&&age>=1.2)root.userData.cut=false;
  if(active==='idle'||active==='spawn')root.userData.cut=false;
  const down=root.userData.cut&&root.userData.battery===0;
  root.userData.powered=!down;
  const steps=Math.max(1,Math.ceil(elapsed/.008));
  for(let i=0;i<steps;i++){
    spring(state,'powerTip',down?1.42:0,elapsed/steps,190,17);
    spring(state,'powerBob',Math.sin(age*5)*.035,elapsed/steps,240,13);
    spring(state,'plugKick',repair&&age>=1.2&&age<1.4?.2:0,elapsed/steps,280,14);
  }
  const patient=root.getObjectByName('power-patient'),worker=root.getObjectByName('power-crumb');
  for(const u of [patient,worker]){
    const moving=(active==='move'&&!down)||(u===worker&&repair&&age<1.2),cycle=age*2.5,phase=cycle%1,f=Math.min(1,phase/.8);
    poseBible(u,{active:'idle',age,phase,moving,shot:0,expression:down&&u===patient?'alarmed':'determined'});
    const progress=repair?Math.min(1,(Math.floor(cycle)+1-(1-f)**3)/3):active==='move'?(Math.floor(cycle)+1-(1-f)**3)*.12:0;
    u.position.x=u===patient?1.45+(!down&&active==='move'?progress:0):-1.5+progress*1.9;
    u.position.z=u===patient?.8:1.3;
    u.getObjectByName('toast0').position.y+=state.powerBob||0;
  }
  patient.rotation.z=state.powerTip||0;
  for(const side of ['left','right']){const eye=patient.getObjectByName('eye-'+side);eye.material.color.setHex(down?0x303844:0xf7f4eb);eye.material.emissiveIntensity=0;}
  const plug=root.getObjectByName('repair-plug');plug.position.set(repair?worker.position.x+.38:.45,.15+(state.plugKick||0),.55);
  root.userData.teamColor=patient.getObjectByName('shoulder').material.color.getHex();
  const endpoint=u=>{u.updateMatrixWorld(true);root.updateWorldMatrix(true,false);return root.worldToLocal(u.localToWorld(new T.Vector3(0,.25,-.45)));};
  lead(root,'network',new T.Vector3(-2,.1,-.8),new T.Vector3(0,.1,-.8),false,age);
  lead(root,'patient',new T.Vector3(0,.1,-.8),endpoint(patient),!!root.userData.cut,age);
  lead(root,'worker',new T.Vector3(-2,.1,-.8),endpoint(worker),false,age);
  const sparks=root.getObjectByName('cut-sparks');sparks.position.set(.45,.15,.1);sparks.visible=!!root.userData.cut&&Math.floor(age*12)%3!==2;
  sparks.children.forEach((s,i)=>{const a=i*Math.PI*2/5,r=.12+(age*4%1)*.18;s.position.set(Math.cos(a)*r,Math.sin(a)*r,0);s.material.emissive.setHex(0xf25745);s.material.emissiveIntensity=2;});
}
