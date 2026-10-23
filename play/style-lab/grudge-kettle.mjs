import * as T from 'three';

// A wild kitchen sentinel: six rigid assemblies, no rigged details or particles.
export function buildKettle(look){
  const root=new T.Group();root.userData.neutral=true;
  const mat=color=>new T.MeshPhysicalMaterial({color,flatShading:true,roughness:look==='Y2K GLOSS'?.2:.85,clearcoat:look==='Y2K GLOSS'?1:0});
  const cream=mat(0xf2d7a6),dark=mat(0x303844),gold=mat(0xd99448),heat=mat(0xf25745);
  const pivot=name=>{const p=new T.Group();p.name=name;root.add(p);return p;};
  const mesh=(p,g,m,x,y,z,name='')=>{const o=new T.Mesh(g,m);o.position.set(x,y,z);o.name=name;p.add(o);return o;};
  const prism=(p,r,h,m,x,y,z,name)=>mesh(p,new T.CylinderGeometry(r,r,h,5),m,x,y,z,name);
  const box=(p,w,h,d,m,x,y,z,name)=>mesh(p,new T.BoxGeometry(w,h,d),m,x,y,z,name);
  const body=pivot('kettle-body');prism(body,.73,.7,cream,0,0,0);prism(body,.75,.15,gold,0,-.22,0,'neutral-band');
  box(body,.84,.27,.08,dark,0,.02,.59,'faceplate');
  for(const x of [-.21,.21]){const eye=box(body,.25,.065,.03,gold,x,.045,.65);eye.rotation.z=x<0?-.22:.22;}
  box(body,.7,.04,.25,dark,0,.37,0,'toast-slot');
  for(const side of ['left','right']){const foot=pivot('kettle-'+side+'-foot');prism(foot,.23,.14,dark,0,.07,0);}
  const lid=pivot('kettle-lid');prism(lid,.67,.1,cream,0,0,0);prism(lid,.18,.18,dark,0,.13,0);
  const spout=pivot('kettle-spout');const tube=mesh(spout,new T.CylinderGeometry(.22,.31,.65,5),cream,0,.22,.23);tube.rotation.x=.8;
  const mouth=prism(spout,.2,.045,heat,0,.45,.47,'scald-mouth');mouth.rotation.x=.8;
  const handle=pivot('kettle-handle');
  // Open angular handle, three broad bars attached to one rear hinge.
  box(handle,.12,.65,.14,dark,-.45,.25,0);box(handle,.12,.65,.14,dark,.45,.25,0);box(handle,1.02,.13,.14,gold,0,.57,0);
  return root;
}
export function poseKettle(root,{active,age,elapsed,spring,homeX}){
  const s=root.userData.motion??={},moving=active==='move',phase=age*2%1,f=Math.min(1,phase/.8);
  const attack=active==='attack',cycle=age%1.05,scald=attack&&cycle>.16&&cycle<.36;
  for(let i=0,n=Math.max(1,Math.ceil(elapsed/.008));i<n;i++){
    const dt=elapsed/n;
    spring(s,'lidLift',scald?.24:.016*Math.sin(age*7),dt,440,17);
    spring(s,'pitch',scald?-.45:0,dt,420,18);
    spring(s,'handle',scald?.24:Math.sin(age*4)*.035,dt,240,13);
    spring(s,'body',scald?-.1:Math.sin(age*4)*.015,dt,360,18);
  }
  root.position.set(homeX+(moving?(Math.floor(age*2)+1-(1-f)**3)*.36:0),moving?.23*4*f*(1-f):0,1.2);
  const stretch=moving?1+.065*Math.sin(f*Math.PI*2):1;
  root.scale.set(1/Math.sqrt(stretch),stretch,1/Math.sqrt(stretch));
  const body=root.getObjectByName('kettle-body');body.position.set(0,.57,0);body.rotation.x=s.body||0;
  for(const [side,x] of [['left',-.4],['right',.4]])root.getObjectByName('kettle-'+side+'-foot').position.set(x,0,0);
  const lid=root.getObjectByName('kettle-lid');lid.position.set(0,.98+(s.lidLift||0),0);lid.rotation.z=(s.lidLiftVelocity||0)*.035;
  const spout=root.getObjectByName('kettle-spout');spout.position.set(.55,.61,0);spout.rotation.x=s.pitch||0;
  root.getObjectByName('scald-mouth').material.emissive.setHex(scald?0xf25745:0x000000);
  const handle=root.getObjectByName('kettle-handle');handle.position.set(0,.65,-.45);handle.rotation.x=s.handle||0;
  root.visible=active!=='death'||age<.3;
}
