import * as T from 'three';
// Four rigid pivots per appliance. Face marks ride the body; no fine mechanisms.
export function buildSquad(look,team){
 const root=new T.Group();root.userData.blocky=true;
 const mat=c=>new T.MeshStandardMaterial({color:c,flatShading:true,roughness:look==='Y2K GLOSS'?.2:.8});
 const cream=mat(0xf2d7a6),dark=mat(0x303844),gold=mat(0xd99448),paint=mat(team==='orange'?0xff8540:0x32d9e8);
 const add=(p,n,g,m,pos)=>{const o=new T.Mesh(g,m);o.name=n;o.position.set(...pos);p.add(o);return o;};
 const box=(p,n,m,pos,s)=>add(p,n,new T.BoxGeometry(...s),m,pos);
 const plane=(p,n,m,pos,s)=>add(p,n,new T.PlaneGeometry(...s),m,pos);
 root.userData.members=Array.from({length:4},(_,i)=>{
  const u=new T.Group();u.name=i<2?'squad-popper-'+i:'conga-crumb-'+i;root.add(u);
  const body=new T.Group();body.name='squad-body';u.add(body);
  box(body,'chassis',cream,[0,.65,0],[.7,.8,.55]);plane(body,'face',dark,[0,.7,.281],[.57,.28]);
  plane(body,'team',paint,[0,.95,.282],[.65,.18]);
  for(const [n,x] of [['left',-.15],['right',.15]])plane(body,'eye-'+n,paint,[x,.72,.29],[.13,.07]);
  const feet=new T.Group();feet.name='feet';u.add(feet);box(feet,'foot-block',dark,[0,.12,0],[.6,.24,.45]);
  const toast=new T.Group();toast.name='toast';u.add(toast);box(toast,'slice',gold,[0,0,0],[.4,.5,.1]);
  const cord=new T.Group();cord.name='cord';cord.position.set(0,.3,-.27);u.add(cord);box(cord,'cord-block',dark,[0,0,-.23],[.06,.06,.5]);
  return u;
 });
 const banner=new T.Group();banner.name='banner';root.add(banner);
 box(banner,'pole',dark,[0,.95,0],[.07,1.9,.07]);box(banner,'flag',paint,[.3,1.62,0],[.6,.4,.05]);
 return root;
}
const clamp=x=>Math.max(0,Math.min(1,x));
const ease=x=>x*x*(3-2*x);
// Analytic damped spring response: deterministic under seeking and command interruption.
const ring=(t,w=22)=>Math.exp(-8*t)*Math.sin(w*t);
export function poseSquad(root,{active,age,homeX=0}){
 root.visible=!(active==='death'&&age>=.3);root.position.set(homeX,0,0);const moving=active==='move'||active==='conga'||active==='gather',dance=active==='victory',hungry=active==='hungry';
 const stride=age/.6,c=Math.floor(stride),p=clamp((stride-c)/.72),travel=.48*(c+ease(p));
 const banner=root.getObjectByName('banner');banner.position.set(moving?travel:0,0,-.7);banner.rotation.z=.035*ring(age%1.2);
 root.userData.members.forEach((u,i)=>{
  const conga=active==='conga'||active==='gather';const local=conga?Math.max(0,age-i*.12):age;
  const cycle=local/.6,step=Math.floor(cycle),phase=clamp((cycle-step)/.72),hop=4*phase*(1-phase);
  const airborne=moving||dance;const x=conga?0:(i%2-.5)*1.25,z=conga?.5+i*.8:.6+Math.floor(i/2)*1.2;
  u.position.set(x+(moving?.48*(step+ease(phase)):0),airborne?.28*hop:0,z);
  u.scale.setScalar(i<2?1:.75);u.rotation.set(0,0,dance?.12*Math.sin(phase*2*Math.PI):0);
  const body=u.getObjectByName('squad-body'),toast=u.getObjectByName('toast'),feet=u.getObjectByName('feet'),cord=u.getObjectByName('cord');
  body.position.y=airborne?.025*ring((cycle%1)*.6):.012*ring(age%1.2);body.rotation.x=airborne?-.13*hop:0;
  // Suspension compresses and extends the assembly; the four parts remain rigid.
  feet.position.y=airborne?.08*hop:0;feet.rotation.x=airborne?-.2*hop:0;
  const salute=active==='select'&&age<.6?.28*(1-Math.exp(-age*35))*clamp((.6-age)/.15):0;
  const polish=!moving&&!dance&&!hungry&&active!=='stop'?.07*Math.sin(age*9+i):0;
  toast.position.set(polish,1.12+salute+(airborne?.07*ring((cycle%1)*.6):.025*ring(age%1.2)),0);toast.rotation.z=polish*2;toast.visible=!hungry;
  cord.rotation.x=!moving&&!dance&&active!=='stop'?.25*ring(age%1.2,16):-.1*hop;
  for(const [n,sign] of [['left',1],['right',-1]]){const eye=u.getObjectByName('eye-'+n);eye.rotation.z=hungry?sign*.25:0;eye.scale.y=hungry?.4:1;}
 });
}
