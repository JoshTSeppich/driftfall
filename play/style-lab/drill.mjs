import * as T from 'three';

// Five rigid assemblies: the separated collars suggest a spring without a wire rig.
export function buildDrill(look,team){
  const root=new T.Group();
  const mat=c=>new T.MeshPhysicalMaterial({color:c,flatShading:true,roughness:look==='Y2K GLOSS'?.2:.85,clearcoat:look==='Y2K GLOSS'?1:0});
  const cream=mat(0xf2d7a6),dark=mat(0x303844),paint=mat(team==='orange'?0xff8540:0x32d9e8),gold=mat(0xd99448);
  const pivot=name=>{const g=new T.Group();g.name=name;root.add(g);return g;};
  const mesh=(p,g,m,x,y,z)=>{const o=new T.Mesh(g,m);o.position.set(x,y,z);p.add(o);return o;};
  const box=(p,w,h,d,m,x,y,z)=>mesh(p,new T.BoxGeometry(w,h,d),m,x,y,z);
  const prism=(p,r,h,m,x,y,z)=>mesh(p,new T.CylinderGeometry(r,r,h,5),m,x,y,z);
  const base=pivot('drill-stand');
  // Two wide planted runners and a rear suspension post leave the bit visible.
  for(const x of [-.72,.72])prism(base,.4,.2,dark,x,.1,0);
  box(base,1.6,.16,.35,paint,0,.24,-.42);
  prism(base,.18,.95,dark,0,.65,-.42);
  for(const name of ['spring-lower','spring-upper']){
    const collar=pivot(name);prism(collar,.4,.13,paint,0,0,-.42);
  }
  const motor=pivot('drill-motor');
  prism(motor,.85,.7,cream,0,0,0);
  prism(motor,.88,.12,paint,0,.3,0);
  box(motor,.92,.28,.08,dark,0,.03,.69);
  for(const x of [-.23,.23]){
    const eye=box(motor,.28,.07,.04,paint,x,.06,.75);eye.rotation.z=x<0?-.18:.18;
  }
  box(motor,.86,.055,.36,dark,0,.38,0);
  box(motor,.6,.17,.16,gold,0,.44,0);
  const bit=pivot('crystal-bit');
  mesh(bit,new T.ConeGeometry(.43,.82,5).rotateZ(Math.PI),paint,0,0,0);
  prism(bit,.46,.12,gold,0,.38,0);
  return root;
}
export function poseDrill(root,{active,age,elapsed,spring,homeX}){
  const s=root.userData.motion??={},drilling=['drill','gather','attack'].includes(active);
  const moving=active==='move',phase=age*2%1,f=Math.min(1,phase/.8);
  for(let i=0,n=Math.max(1,Math.ceil(elapsed/.008));i<n;i++){
    const dt=elapsed/n;
    spring(s,'bob',Math.sin(age*(drilling?24:4))*(drilling?.15:.025),dt,400,16);
    spring(s,'speed',drilling?17:.35,dt,140,18);
    spring(s,'lean',moving?-.12:Math.sin(age*4)*.012,dt,260,18);
    s.angle=(s.angle||0)+(s.speed||0)*dt;
  }
  root.position.set(homeX+(moving?(Math.floor(age*2)+1-(1-f)**3)*.4:0),moving?.24*4*f*(1-f):0,1.2);
  root.rotation.set(0,0,0);root.scale.setScalar(1);
  const bob=s.bob||0;
  root.getObjectByName('spring-lower').position.y=.55+bob*.33;
  root.getObjectByName('spring-upper').position.y=.83+bob*.66;
  const motor=root.getObjectByName('drill-motor');motor.position.y=1.25+bob;motor.rotation.z=s.lean||0;
  const bit=root.getObjectByName('crystal-bit');bit.position.y=.53+bob;bit.rotation.y=s.angle||0;
  root.visible=active!=='death'||age<.3;
}
