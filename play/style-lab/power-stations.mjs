import * as T from 'three';

// All architecture is planted. Three rigid pivots per station and per Crumb.
export function buildPowerStations(look,team){
 const root=new T.Group();root.userData.blocky=true;
 const color=team==='orange'?0xff8540:0x32d9e8;
 const mat=(c,glow=0)=>new T.MeshStandardMaterial({color:c,emissive:c,emissiveIntensity:glow,flatShading:true,roughness:look==='Y2K GLOSS'?.3:.85,side:T.DoubleSide});
 const mesh=(p,n,g,c,x,y,z,glow=0)=>{const m=new T.Mesh(g,mat(c,glow));m.name=n;m.position.set(x,y,z);p.add(m);return m;};
 const box=(p,n,s,c,x,y,z,glow=0)=>mesh(p,n,new T.BoxGeometry(...s),c,x,y,z,glow);
 const pivot=(p,n,x=0,y=0,z=0)=>{const g=new T.Group();g.name=n;g.position.set(x,y,z);p.add(g);return g;};
 for(const [n,x,z,tall] of [['extension-a',-3,-2,false],['extension-b',0,-2,false],['relay-a',1,-2,true],['relay-b',4,-2,true]]){
  const station=pivot(root,n,x,0,z);
  const base=pivot(station,n+'-base');box(base,'foot', [.8,.2,.7],0x303844,0,.1,0);
  const mast=pivot(station,n+'-mast');box(mast,'post',[tall?.24:.65,tall?2.5:.55,.45],0x303844,0,tall?1.35:.45,0);
  const cap=pivot(station,n+'-cap',0,tall?2.6:.75,0);box(cap,'live-cap',[tall?1:.7,.18,.5],color,0,0,0,.4);
 }
 box(root,'ground-fence',[3,.19,.19],color,-1.5,.28,-2,1.1);
 box(root,'fence-return',[.19,.19,2.5],color,-3,.28,-.75,1.1);
 box(root,'fence-front',[3,.19,.19],color,-1.5,.28,.5,1.1);
 box(root,'fence-close',[.19,.19,2.5],color,0,.28,-.75,1.1);
 box(root,'high-line',[3,.045,.045],color,2.5,2.65,-2,.35);
 box(root,'high-shadow',[3,.008,.08],0x303f48,2.5,.012,-1.8);
 box(root,'brownout-line',[2,.12,.12],0x303844,2.5,.18,0);
 box(root,'short-line',[2,.12,.12],0x303844,2.5,.18,1);
 mesh(root,'short-rock',new T.CylinderGeometry(.4,.55,.65,5),0xa0a7a0,2.5,.38,1);
 box(root,'cliff',[1.2,1.15,1.2],0x303f48,-1,.575,2.5);
 // Each tint is a plain pentagonal tile; the same five corners define the reach ring.
 const pent=(radius,ring=false)=>{
  const v=[];for(let i=0;i<5;i++){
   const a=i*2*Math.PI/5,b=(i+1)*2*Math.PI/5;
   const point=(r,t)=>[Math.cos(t)*r,0,Math.sin(t)*r];
   if(ring){v.push(...point(radius,a),...point(radius,b),...point(radius*.96,a),...point(radius,b),...point(radius*.96,b),...point(radius*.96,a));}
   else v.push(0,0,0,...point(radius,a),...point(radius,b));
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(v,3));g.computeVertexNormals();return g;
 };
 const land=pivot(root,'fenced-land');
 for(let i=0;i<4;i++){const m=mesh(land,'tint-'+i,pent(.55),color,-2.3+i%2*1.4,.015,-1.3+Math.floor(i/2)*1.1);m.material.transparent=true;m.material.opacity=.14;m.material.depthWrite=false;}
 const unit=pivot(root,'cord-unit');
 const body=pivot(unit,'unit-body');box(body,'cream-chassis',[.55,.55,.45],0xf2d7a6,0,.48,0);
 box(body,'face',[.46,.17,.02],0x303844,0,.5,.235);
 for(const x of [-.11,.11])mesh(body,'eye',new T.PlaneGeometry(.09,.045),color,x,.52,.25);
 const feet=pivot(unit,'unit-feet');box(feet,'feet',[.5,.16,.42],color,0,.08,0);
 const toast=pivot(unit,'unit-toast',0,.84,0);box(toast,'slice',[.33,.35,.1],0xd99448,0,0,0);
 for(let i=0;i<3;i++)box(root,'cord-'+i,[1,.055,.055],color,0,.09,0,.25);
 for(const [i,x,z] of [[0,-1.7,1.8],[1,-1.7,3.2]])mesh(root,'peg-'+i,new T.CylinderGeometry(.12,.12,.12,5),color,x,.1,z);
 mesh(root,'reach-ring',pent(1,true),color,-1.7,.025,3.2,.2);
 const sparks=pivot(root,'short-sparks',2.5,.65,1);
 // Five broad triangular spark rays, ten triangles total.
 for(let i=0;i<5;i++){
  const g=new T.BufferGeometry(),a=i*2*Math.PI/5;
  g.setAttribute('position',new T.Float32BufferAttribute([0,0,0,Math.cos(a)*.7,.3,Math.sin(a)*.7,Math.cos(a+.25)*.4,.15,Math.sin(a+.25)*.4],3));g.computeVertexNormals();
  mesh(sparks,'spark-'+i,g,0xf25745,0,0,0,1.5);
 }
 return root;
}
const clamp=x=>Math.max(0,Math.min(1,x)),ease=x=>x*x*(3-2*x);
const spring=t=>Math.exp(-8*t)*Math.sin(24*t);
export function posePowerStations(root,{active,age}){
 root.visible=!(active==='death'&&age>=.3);
 const moving=active==='move',working=['attack','gather','generate'].includes(active);
 const phase=age/.6,step=Math.floor(phase),p=clamp((phase-step)/.72),hop=4*p*(1-p);
 const wrap=working?ease(clamp(age/.5)):moving?ease(clamp((step+ease(p))*.35)):0;
 const u=root.getObjectByName('cord-unit');u.position.set(-1.7+wrap*2,moving?.32*hop:0,3.55);
 const body=root.getObjectByName('unit-body');body.position.y=moving?.06*spring((phase%1)*.6):.018*spring(age%1.2);body.rotation.x=moving?-.15*hop:working?-.12*spring(age):0;
 root.getObjectByName('unit-feet').position.y=moving?.07*hop:0;
 root.getObjectByName('unit-toast').position.y=.84+.07*spring(age%1.2)+(working?.22*spring(age):0);
 for(const name of ['extension-a','extension-b','relay-a','relay-b'])root.getObjectByName(name+'-cap').rotation.z=(working?.13:.025)*spring(age%1.2);
 const points=[new T.Vector3(-3,.09,.5),new T.Vector3(-1.7,.09,1.8),new T.Vector3(-1.7,.09,3.2),new T.Vector3(u.position.x,.09,u.position.z)];
 let used=0;
 for(let i=0;i<3;i++){
  const a=points[i],b=points[i+1],d=b.clone().sub(a),m=root.getObjectByName('cord-'+i);
  used+=d.length();m.position.copy(a).add(b).multiplyScalar(.5);m.scale.set(d.length(),1,1);m.rotation.y=-Math.atan2(d.z,d.x);
 }
 // Remaining cord length after the fixed bends; ring is centred at the last peg.
 root.getObjectByName('reach-ring').scale.setScalar(Math.max(.2,6-used));
 root.userData.cordLengthUsed=used;
 root.getObjectByName('short-rock').position.z=working?1+.8*(1-ease(clamp(age/.18))):1.8;
 const sparks=root.getObjectByName('short-sparks');sparks.visible=working&&age>=.18&&age<.7;sparks.rotation.y=age*4;
 sparks.scale.setScalar(.7+.3*Math.abs(spring(age)));
 root.getObjectByName('short-line').material.emissiveIntensity=working&&age<.7?(Math.floor(age*30)%2)*.4:0;
 root.position.set(0,0,0);
}
