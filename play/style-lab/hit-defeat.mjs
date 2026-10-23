import * as T from 'three';
// Four rigid pivots; face markings and temporary facets ride the chassis pivot.
export function buildHitDefeat(look,team){
 const u=new T.Group();u.userData.blocky=true;u.userData.team=team;
 const mat=c=>new T.MeshStandardMaterial({color:c,flatShading:true,roughness:look==='Y2K GLOSS'?.2:.8});
 const cream=mat(0xf2d7a6),dark=mat(0x303844),gold=mat(0xd99448),paint=mat(team==='orange'?0xff8540:0x32d9e8);
 const mesh=(parent,name,geo,m,p)=>{const o=new T.Mesh(geo,m);o.name=name;o.position.set(...p);parent.add(o);return o;};
 const box=(parent,name,m,p,s)=>mesh(parent,name,new T.BoxGeometry(...s),m,p);
 const body=new T.Group();body.name='react-body';u.add(body);
 box(body,'chassis',cream,[0,.8,0],[1,1.1,.75]);
 box(body,'react-panel',dark,[0,.85,.39],[.8,.4,.025]);
 box(body,'react-team',paint,[0,1.38,0],[.8,.08,.6]);
 for(const name of ['normal-eyes','alarmed-eyes','x-eyes']){
  const eyes=new T.Group();eyes.name=name;body.add(eyes);
  for(const x of [-.22,.22]){
   if(name==='x-eyes')for(const a of [-Math.PI/4,Math.PI/4])mesh(eyes,'cross',new T.PlaneGeometry(.23,.045),paint,[x,.87,.42]).rotation.z=a;
   else if(name==='alarmed-eyes')mesh(eyes,'alarm',new T.CylinderGeometry(.12,.12,.025,5).rotateX(Math.PI/2),paint,[x,.88,.42]);
   else mesh(eyes,'eye',new T.PlaneGeometry(.19,.075),paint,[x,.88,.42]);
  }
 }
 box(body,'react-flash',mat(0xffffff),[0,.8,.01],[1.04,1.14,.8]);
 const debris=new T.Group();debris.name='react-debris';body.add(debris);
 for(let i=0;i<5;i++)mesh(debris,'facet-'+i,new T.CylinderGeometry(.32,.32,.06,5),cream,[0,.8,0]);
 box(u,'react-feet',dark,[0,.12,0],[.85,.24,.65]);
 const toast=new T.Group();toast.name='react-toast';u.add(toast);
 box(toast,'slice',gold,[0,0,0],[.58,.65,.12]);box(toast,'butter',cream,[0,0,.075],[.35,.35,.03]);
 // A single angular spring silhouette, no smooth coil or tiny moving joints.
 const spring=new T.Group();spring.name='react-spring';u.add(spring);
 for(let i=0;i<3;i++)box(spring,'spring-run',dark,[0,i*.12,0],[.32,.055,.08]).rotation.z=i%2?-.4:.4;
 return u;
}
export function poseHitDefeat(u,{active,age,homeX=0}){
 const get=n=>u.getObjectByName(n),dead=active==='death',hit=active==='hit',clear=dead&&age>=.7;
 u.visible=!clear;u.position.set(homeX,0,0);u.rotation.set(0,0,0);u.scale.set(1,1,1);
 const body=get('react-body'),toast=get('react-toast'),spring=get('react-spring');body.rotation.set(0,0,0);
 toast.position.set(0,1.55+.035*Math.exp(-2*(age%1))*Math.sin(age*16),0);toast.rotation.set(0,0,0);
 spring.position.set(0,1.2,0);spring.rotation.set(0,0,0);spring.visible=dead&&!clear;
 for(const n of ['chassis','react-panel','react-team'])get(n).visible=!(dead&&age>=.12);
 get('normal-eyes').visible=!dead&&!(hit&&age<.3);get('alarmed-eyes').visible=hit&&age<.3;get('x-eyes').visible=dead&&age<.12;
 get('react-flash').visible=hit&&age<.075;
 get('react-debris').visible=dead&&age>=.12&&age<.55;
 get('react-feet').visible=!dead||age<.12;toast.visible=!clear;
 if(hit&&age<.4){const p=Math.min(1,age/.32);u.position.z=-.36*(p*p*(3-2*p));u.position.y=.28*4*p*(1-p);body.rotation.x=.25*Math.exp(-age*12)*Math.sin(age*30);toast.position.y+=.2*Math.exp(-age*8)*Math.sin(age*22);}
 if(active==='move'){
  const c=age/.6,p=Math.min(1,(c%1)/.72),hop=4*p*(1-p);
  u.position.x+=.3*(Math.floor(c)+p*p*(3-2*p));u.position.y=.3*hop;
  u.scale.set(1+.04*Math.cos(p*2*Math.PI),1-.08*Math.cos(p*2*Math.PI),1);body.rotation.x=-.1*hop;toast.position.y+=.09*Math.sin(p*Math.PI*2);
 }
 if(dead){
  const p=Math.max(0,Math.min(1,(age-.12)/.38));
  spring.position.set(.35*p,1.2+1.3*4*p*(1-p)-p,.2*p);spring.rotation.z=p*6;
  get('react-debris').children.forEach((o,i)=>{const a=i*Math.PI*2/5;o.position.set(Math.cos(a)*p*.9,.8+Math.sin(p*Math.PI)*.6-p*.65,Math.sin(a)*p*.9);o.rotation.set(p*3,a,p*4);});
  toast.position.set(-.6*p,1.55*(1-p)+.07*p+.6*Math.sin(p*Math.PI),.4*p);toast.rotation.x=Math.PI/2*p;
 }
 u.userData.cameraShake=0;
}
