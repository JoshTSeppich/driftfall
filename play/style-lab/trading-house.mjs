import * as T from 'three';

// Six independent rigid assemblies. Broad quote bars replace illegible price text.
export function buildTradingHouse(look,team){
  const root=new T.Group();
  const mat=color=>new T.MeshPhysicalMaterial({color,flatShading:true,roughness:look==='Y2K GLOSS'?.2:.85,clearcoat:look==='Y2K GLOSS'?1:0});
  const cream=mat(0xf2d7a6),dark=mat(0x303844),paint=mat(team==='orange'?0xff8540:0x32d9e8),gold=mat(0xd99448);
  const pivot=name=>{const g=new T.Group();g.name=name;root.add(g);return g;};
  const mesh=(p,g,m,x,y,z,name='')=>{const o=new T.Mesh(g,m);o.position.set(x,y,z);o.name=name;p.add(o);return o;};
  const box=(p,w,h,d,m,x,y,z,name)=>mesh(p,new T.BoxGeometry(w,h,d),m,x,y,z,name);
  const prism=(p,r,h,m,x,y,z)=>mesh(p,new T.CylinderGeometry(r,r,h,5),m,x,y,z);
  const counter=pivot('store-counter');
  const shell=prism(counter,1.4,.65,cream,0,.5,0);shell.scale.z=.7;
  box(counter,2.65,.18,1.5,paint,0,.9,0,'counter-rim');
  box(counter,1.5,.3,.08,dark,0,.55,1);
  for(const x of [-.35,.35]){const eye=box(counter,.38,.08,.05,paint,x,.59,1.06);eye.rotation.z=x<0?-.18:.18;}
  for(const x of [-.9,.9])prism(counter,.28,.2,dark,x,.1,0);
  const register=pivot('cash-register');
  prism(register,.48,.4,cream,0,0,0);
  box(register,.72,.4,.14,dark,0,.32,-.12);
  box(register,.5,.12,.06,paint,0,.35,-.025);
  box(register,.55,.04,.23,dark,0,.23,.18); // Chunky receipt/toast slot.
  const drawer=pivot('cash-drawer');
  box(drawer,.8,.19,.62,dark,0,0,0);box(drawer,.65,.15,.07,paint,0,0,.35);
  const stand=pivot('price-stand');
  for(const x of [-.62,.62])prism(stand,.08,1.15,dark,x,0,0);
  const board=pivot('price-board');
  box(board,1.5,.65,.14,paint,0,0,0);
  for(const z of [-.09,.09]){
    box(board,1.3,.49,.03,dark,0,0,z);
    // Two bold price bars; reverse quote changes on the physical back face.
    box(board,z>0?.72:1.05,.11,.03,gold,-.08,.1,z*1.3);
    box(board,z>0?1.05:.72,.11,.03,cream,.02,-.12,z*1.3);
  }
  const toast=pivot('purchase-toast');
  const slice=prism(toast,.38,.15,gold,0,0,0);slice.rotation.x=Math.PI/2;
  return root;
}

export function poseTradingHouse(root,{active,age,elapsed,spring,homeX}){
  const s=root.userData.motion??={},trading=['trade','gather','attack'].includes(active),cycle=age%1.2;
  const moving=active==='move',phase=age*2%1,f=Math.min(1,phase/.8);
  for(let i=0,n=Math.max(1,Math.ceil(elapsed/.008));i<n;i++){
    const dt=elapsed/n;
    spring(s,'bob',Math.sin(age*7)*.018,dt,420,19);
    spring(s,'flip',trading&&cycle>.12?Math.PI:0,dt,480,24);
    spring(s,'drawer',trading&&cycle>.22&&cycle<.65?.45:0,dt,420,18);
    spring(s,'toast',trading&&cycle>.28&&cycle<.7?.35:0,dt,400,16);
    spring(s,'tilt',moving?-.1*Math.sin(f*Math.PI):0,dt,420,20);
  }
  root.position.set(homeX+(moving?(Math.floor(age*2)+1-(1-f)**3)*.4:0),moving?.24*4*f*(1-f):0,1.2);
  root.rotation.set(0,0,s.tilt||0);root.scale.setScalar(1);
  const bob=s.bob||0;
  root.getObjectByName('store-counter').position.y=bob;
  const register=root.getObjectByName('cash-register');register.position.set(-.65,1.23+bob,0);register.rotation.z=bob*2;
  root.getObjectByName('cash-drawer').position.set(-.65,1.04+bob,.25+(s.drawer||0));
  const stand=root.getObjectByName('price-stand');stand.position.set(.55,1.55+bob,-.42);stand.rotation.z=-bob;
  const board=root.getObjectByName('price-board');board.position.set(.55,2.05+bob,-.42);board.rotation.x=s.flip||0;
  const toast=root.getObjectByName('purchase-toast');toast.position.set(-.65,1.65+bob+(s.toast||0),.2);toast.rotation.z=-bob*3;
  root.visible=active!=='death'||age<.3;
}
