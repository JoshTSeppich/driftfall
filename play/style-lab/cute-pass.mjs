import * as T from 'three';
import {TOASTERS,PALETTE,EXPRESSIONS} from '../toaster-spec.mjs';

// Four rigid pivots: chassis (with painted face), two feet, functional assembly.
export function buildCute(kind,look,team){
 const root=new T.Group();root.name=kind;root.userData={cute:true,blocky:true,team};
 const body=new T.Group(),left=new T.Group(),right=new T.Group(),action=new T.Group();
 body.name='chassis';left.name='left-pivot';right.name='right-pivot';action.name='action-pivot';root.add(body,left,right,action);
 const specs=TOASTERS[kind],chassis=specs.find(p=>p.name==='body'),face=specs.find(p=>p.name==='face');let toast=0;
 for(const p of specs)for(const sign of p.mirror?[-1,1]:[1]){
  const size=[...p.size],pos=[...p.pos];pos[0]*=sign;
  if(p.name==='foot'){pos[0]=sign*(chassis.size[0]*.60-size[0]/2);pos[2]=chassis.size[2]*.70-size[2]/2;}
  const decal=p.decal||p.name==='eye';
  let geometry=p.prism?new T.CylinderGeometry(size[0]/2,size[0]/2,size[2],5).rotateX(Math.PI/2):decal?new T.PlaneGeometry(size[0],size[1]):new T.BoxGeometry(...size);
  const color=PALETTE[p.colour==='team'?team:p.colour];
  const material=p.emissive?new T.MeshBasicMaterial({color,toneMapped:false,side:T.DoubleSide}):new T.MeshPhysicalMaterial({color,flatShading:true,roughness:look==='Y2K GLOSS'?.2:.8,clearcoat:look==='Y2K GLOSS'?1:0});
  const m=new T.Mesh(geometry,material);m.position.fromArray(pos);
  m.name=p.name==='eye'?(sign<0?'eye-left':'eye-right'):p.name==='foot'?(sign<0?'foot-left':'foot-right'):p.name==='toast'?'toast'+toast++:p.name;
  m.userData.home=m.position.clone();m.castShadow=!decal;m.receiveShadow=true;
  (p.name==='foot'?(sign<0?left:right):['toast','emitter','barrel','door','glow'].includes(p.name)?action:body).add(m);
 }
 root.userData.face=face;root.userData.bodyHeight=chassis.size[1];
 return root;
}
export function poseCute(root,{active,age,expression='determined',homeX=0}){
 root.visible=!(active==='death'&&age>=.3);
 const moving=active==='move',cycle=age/.6,phase=cycle%1,f=Math.min(1,phase/.72),hop=moving?4*f*(1-f):0;
 root.position.set(homeX+(moving?(Math.floor(cycle)+f*f*(3-2*f))*.22:0),.28*hop,0);
 root.scale.set(1+.04*hop,1-.08*Math.cos(f*Math.PI*2)*(moving?1:0),1);root.rotation.x=-.12*hop;root.rotation.z=root.name==='bagel'&&moving?-cycle*Math.PI*2/5:0;
 const e=EXPRESSIONS[expression]??EXPRESSIONS.determined,face=root.userData.face;
 root.traverse(p=>{
  if(p.userData.home)p.position.copy(p.userData.home);
  if(p.name.startsWith('eye-')){const sign=p.name==='eye-left'?-1:1;p.scale.set(face.size[0]*e.w/p.geometry.parameters.width,face.size[1]*e.h/p.geometry.parameters.height,1);p.position.set(sign*face.size[0]*e.x,face.pos[1]+face.size[1]*e.y,p.userData.home.z);p.rotation.z=-sign*e.rot*Math.PI/180;}
 });
 const spring=.035*Math.sin(age*11)*Math.exp(-.3*(age%1));
 const action=root.getObjectByName('action-pivot');const rise=spring+(active==='attack'?.65*Math.sin(Math.min(1,(age%1)/.38)*Math.PI):0);
 action.children.forEach(p=>p.position.y+=rise);
 action.rotation.x=active==='attack'?-.15*Math.sin(Math.min(1,(age%1)/.38)*Math.PI):0;
}
export function buildCutePass(build,look,team,before=false){
 const root=new T.Group();root.userData.toyShowcase=true;root.userData.blocky=true;
 for(const [i,kind] of Object.keys(TOASTERS).entries()){
  const u=before?build(kind,look,team):buildCute(kind,look,team);u.userData.showcaseX=(i-3)*2.4;u.position.x=u.userData.showcaseX;root.add(u);
 }
 return root;
}
