import * as T from 'three';

// One bank display: a command strip and five independently sprung rigid slices.
// A slice represents up to 100 Toast in this studio preview, not a sim rule.
export function buildToastStacks(look,team){
  const root=new T.Group();
  const mat=color=>new T.MeshPhysicalMaterial({color,flatShading:true,roughness:look==='Y2K GLOSS'?.2:.85,clearcoat:look==='Y2K GLOSS'?1:0});
  const cream=mat(0xf2d7a6),dark=mat(0x303844),crust=mat(0x805432),gold=mat(0xd99448),paint=mat(team==='orange'?0xff8540:0x32d9e8);
  const pivot=name=>{const p=new T.Group();p.name=name;root.add(p);return p;};
  const mesh=(p,g,m,x,y,z,name='')=>{const o=new T.Mesh(g,m);o.position.set(x,y,z);o.name=name;p.add(o);return o;};
  const box=(p,w,h,d,m,x,y,z,name)=>mesh(p,new T.BoxGeometry(w,h,d),m,x,y,z,name);
  const strip=pivot('bank-strip');
  box(strip,1.1,.4,1.8,cream,0,.28,0);
  box(strip,1.15,.14,1.85,paint,0,.16,0,'bank-rim');
  for(const z of [-.5,.35]){
    mesh(strip,new T.CylinderGeometry(.3,.3,.04,5),dark,0,.5,z);
    box(strip,.08,.025,.2,cream,-.1,.53,z);box(strip,.08,.025,.2,cream,.1,.53,z);
  }
  box(strip,.75,.17,.04,dark,0,.32,.92,'faceplate');
  for(const x of [-.19,.19]){const eye=box(strip,.22,.045,.025,paint,x,.34,.95);eye.rotation.z=x<0?-.2:.2;}
  box(strip,.7,.03,.16,dark,0,.51,-.1,'toast-slot');
  for(let i=0;i<5;i++){
    const slice=pivot('bank-slice-'+i);
    mesh(slice,new T.CylinderGeometry(.66,.66,.2,5),crust,0,0,0);
    mesh(slice,new T.CylinderGeometry(.56,.56,.025,5),gold,0,.112,0);
  }
  return root;
}
export function poseToastStacks(root,{active,age,elapsed,spring,homeX,toast}){
  const s=root.userData.motion??={},count=Math.ceil(toast/100),moving=active==='move',phase=age*2%1,f=Math.min(1,phase/.8);
  root.position.set(homeX+(moving?(Math.floor(age*2)+1-(1-f)**3)*.36:0),moving?.23*4*f*(1-f):0,1.2);
  const stretch=moving?1+.06*Math.sin(f*Math.PI*2):1;
  root.scale.set(1/Math.sqrt(stretch),stretch,1/Math.sqrt(stretch));
  const strip=root.getObjectByName('bank-strip');strip.position.x=-.8;
  for(let i=0;i<5;i++){
    const p=root.getObjectByName('bank-slice-'+i),visible=i<count;
    if(visible&&!p.userData.present){s['slice'+i]=.55+i*.24;s['slice'+i+'Velocity']=1.6;}
    p.userData.present=visible;p.visible=visible;
    for(let j=0,n=Math.max(1,Math.ceil(elapsed/.008));j<n;j++)spring(s,'slice'+i,.17+i*.24+Math.sin(age*5-i*.5)*.012,elapsed/n,340,15);
    p.position.set(.9,s['slice'+i]??(.17+i*.24),0);
    p.rotation.z=Math.sin(age*4-i*.4)*.025+(s['slice'+i+'Velocity']||0)*.035;
    p.rotation.y=i%2?.12:-.12;
  }
  root.visible=active!=='death'||age<.3;
}
