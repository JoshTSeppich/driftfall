import * as T from 'three';
// Six rigid pivots: socket shell, ground prongs, three cord links, supply strip.
export function buildOutlet(look,team){
  const root=new T.Group(),color=team==='orange'?0xff8540:0x32d9e8;
  const mat=c=>new T.MeshPhysicalMaterial({color:c,flatShading:true,roughness:look==='Y2K GLOSS'?.2:.85,clearcoat:look==='Y2K GLOSS'?1:0});
  const cream=mat(0xf2d7a6),dark=mat(0x303844),trim=mat(color);
  const pivot=(name)=>{const g=new T.Group();g.name=name;root.add(g);return g;};
  const mesh=(parent,geometry,material,x,y,z)=>{const m=new T.Mesh(geometry,material);m.position.set(x,y,z);parent.add(m);return m;};
  const prism=(r,h)=>new T.CylinderGeometry(r,r,h,5);
  const shell=pivot('outlet-shell');
  mesh(shell,prism(.82,.55),cream,0,0,0);
  mesh(shell,prism(.85,.12),trim,0,-.23,0);
  mesh(shell,prism(.6,.06),dark,0,.3,0);
  for(const x of [-.18,.18])mesh(shell,new T.BoxGeometry(.12,.035,.28),cream,x,.34,0);
  // The socket's two stern slots are its mechanical expression.
  const stake=pivot('ground-plug');
  for(const x of [-.28,.28])mesh(stake,prism(.12,.65),dark,x,0,0);
  for(let i=0;i<3;i++){
    const link=pivot('cord-link-'+i);
    const cable=mesh(link,prism(.095,1.05),dark,0,0,.525);cable.rotation.x=Math.PI/2;
    const live=mesh(link,prism(.038,1.05),trim,0,.085,.525);live.rotation.x=Math.PI/2;
  }
  const strip=pivot('power-strip-end');
  mesh(strip,new T.BoxGeometry(1.5,.24,.65),cream,0,0,0);
  mesh(strip,prism(.23,.035),dark,0,.14,0);
  mesh(strip,new T.BoxGeometry(.28,.08,.5),trim,.55,.16,0);
  return root;
}
export function poseOutlet(root,{active,age,elapsed,spring,homeX}){
  const s=root.userData.motion??={},moving=active==='move',claim=['claim','construction','attack','replug'].includes(active);
  const phase=(age*2)%1,f=Math.min(1,phase/.8),hop=moving?.42*4*f*(1-f):0;
  const travel=moving?(Math.floor(age*2)+1-(1-f)**3)*.45:0;
  for(let i=0,n=Math.max(1,Math.ceil(elapsed/.008));i<n;i++){
    spring(s,'seat',claim?(age<.15?.35:age<.27?-.18:0):0,elapsed/n,380,16);
    spring(s,'rock',Math.sin(age*5)*.025,elapsed/n,220,13);
    spring(s,'slack',Math.sin(age*4)*.12+(claim&&age<.3?.3:0),elapsed/n,240,14);
  }
  root.position.set(homeX,0,1.2);root.rotation.set(0,0,0);root.scale.setScalar(1);
  const shell=root.getObjectByName('outlet-shell'),stake=root.getObjectByName('ground-plug');
  shell.position.set(travel,.6+hop+(s.seat||0),0);shell.rotation.z=(s.rock||0)+(moving?Math.sin(f*Math.PI)*.15:0);
  stake.position.set(travel,.05+hop+Math.max(0,s.seat||0),0);
  let x=travel,z=-.65;
  for(let i=0;i<3;i++){
    const link=root.getObjectByName('cord-link-'+i),a=Math.PI+(i%2?-.6:.6)+(s.slack||0)*(i%2?-1:1);
    link.position.set(x,.12,z);link.rotation.y=a;
    x+=Math.sin(a)*1.05;z+=Math.cos(a)*1.05;
  }
  root.getObjectByName('power-strip-end').position.set(x,.17,z-.28);
  root.visible=active!=='death'||age<.3;
}
