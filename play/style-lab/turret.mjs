import * as T from 'three';

// Five rigid assemblies; the socket hides the retracted toaster below ground.
export function buildTurret(look,team){
  const root=new T.Group();
  const mat=c=>new T.MeshPhysicalMaterial({color:c,flatShading:true,roughness:look==='Y2K GLOSS'?.2:.85,clearcoat:look==='Y2K GLOSS'?1:0});
  const cream=mat(0xf2d7a6),dark=mat(0x303844),paint=mat(team==='orange'?0xff8540:0x32d9e8),gold=mat(0xd99448);
  const pivot=name=>{const g=new T.Group();g.name=name;root.add(g);return g;};
  const mesh=(p,g,m,x,y,z)=>{const o=new T.Mesh(g,m);o.position.set(x,y,z);p.add(o);return o;};
  const box=(p,w,h,d,m,x,y,z)=>mesh(p,new T.BoxGeometry(w,h,d),m,x,y,z);
  const prism=(p,r,h,m,x,y,z)=>mesh(p,new T.CylinderGeometry(r,r,h,5),m,x,y,z);
  const base=pivot('turret-socket');prism(base,1.12,.14,paint,0,.07,0);prism(base,.99,.06,dark,0,.16,0);
  const collar=pivot('turret-spring');prism(collar,.48,.15,dark,0,0,0);prism(collar,.52,.08,paint,0,.08,0);
  const body=pivot('turret-body');prism(body,.83,.72,cream,0,0,0);prism(body,.86,.14,paint,0,.29,0);
  box(body,.92,.28,.08,dark,0,.04,.68);
  for(const x of [-.23,.23]){const eye=box(body,.28,.07,.04,paint,x,.07,.74);eye.rotation.z=x<0?-.2:.2;}
  box(body,.92,.06,.38,dark,0,.4,0); // Oversized ammunition slot.
  const hatch=pivot('turret-hatch');prism(hatch,1.02,.13,cream,0,0,.72);box(hatch,.9,.07,.35,paint,0,.09,.72);
  const shot=pivot('turret-shot');const toast=prism(shot,.37,.15,gold,0,0,0);toast.rotation.x=Math.PI/2;
  box(shot,.4,.38,.04,cream,0,0,.1);
  return root;
}
export function poseTurret(root,{active,age,elapsed,spring,homeX}){
  const s=root.userData.motion??={},firing=active==='attack',cycle=age%1.4;
  const raised=firing&&cycle>.12&&cycle<.84,open=firing&&cycle<.98;
  const moving=active==='move',phase=age*2%1,f=Math.min(1,phase/.8);
  for(let i=0,n=Math.max(1,Math.ceil(elapsed/.008));i<n;i++){
    const dt=elapsed/n;
    spring(s,'rise',raised?1.45:.015*Math.sin(age*4),dt,460,24);
    spring(s,'hatch',open?-1.85:Math.sin(age*4)*.025,dt,460,25);
    spring(s,'recoil',firing&&cycle>.49&&cycle<.57?-.18:0,dt,450,16);
  }
  root.position.set(homeX+(moving?(Math.floor(age*2)+1-(1-f)**3)*.4:0),moving?.24*4*f*(1-f):0,1.2);
  const stretch=moving?1+.07*Math.sin(f*Math.PI*2):1;
  root.scale.set(1/Math.sqrt(stretch),stretch,1/Math.sqrt(stretch));root.rotation.set(0,0,0);
  const rise=s.rise||0,body=root.getObjectByName('turret-body');
  body.position.y=rise+(s.recoil||0);body.visible=rise>.22;body.rotation.x=(s.recoilVelocity||0)*.025;
  const collar=root.getObjectByName('turret-spring');collar.position.y=.2+rise*.35;collar.visible=rise>.3;
  const hatch=root.getObjectByName('turret-hatch');hatch.position.set(0,.23,-.72);hatch.rotation.x=s.hatch||0;
  const shot=root.getObjectByName('turret-shot'),p=cycle-.5;
  shot.visible=firing&&p>=0&&p<.3;
  // Flight is independent of the body's spring recoil, with a clean ballistic arc.
  shot.position.set(0,1.92+3*p-4*p*p,p*9);shot.rotation.x=-p*5;
  root.visible=active!=='death'||age<.3;
}
