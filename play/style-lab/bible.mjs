import * as T from 'three';
export const bibleKinds=['crumb','popper','zapper','four-slice','power-strip'];
// All decoration is attached to its rigid parent; only root children are pivots.
export function buildBible(kind,look,team){
  const root=new T.Group();root.name=kind;root.userData.bible=true;
  const mat=c=>new T.MeshPhysicalMaterial({color:c,flatShading:true,roughness:look==='Y2K GLOSS'?.3:.85,clearcoat:look==='Y2K GLOSS'?1:0});
  const cream=mat(0xf2d7a6),dark=mat(0x303844),gold=mat(0xd99448),red=mat(0xf25745),paint=mat(team==='orange'?0xff8540:0x32d9e8),eyes=mat(0xf7f4eb);
  const mesh=(parent,name,geo,m,pos,scale=[1,1,1])=>{const o=new T.Mesh(geo,m);o.name=name;o.position.set(...pos);o.scale.set(...scale);parent.add(o);return o;};
  const prism=(w,h,d)=>{const s=new T.Shape();s.moveTo(-w/2,-h/2);s.lineTo(w/2,-h/2);s.lineTo(w/2,h*.22);s.lineTo(0,h/2);s.lineTo(-w/2,h*.22);s.closePath();const g=new T.ExtrudeGeometry(s,{depth:d,bevelEnabled:false,steps:1});g.translate(0,0,-d/2);g.userData.facets=5;return g;};
  const box=(w,h,d)=>new T.BoxGeometry(w,h,d);
  const heavy=kind==='four-slice',strip=kind==='power-strip',zap=kind==='zapper';
  const w=strip?3:heavy?1.85:kind==='popper'?1.18:zap?.85:.78,h=strip?.65:heavy?1.55:zap?1.05:kind==='popper'?.95:.72;
  const body=mesh(root,'body',prism(w,h,.8),cream,[0,h/2+.22,0]);
  mesh(body,'shoulder',prism(.36,.32,.06),paint,[w*.36,h*.12,.44]);
  const face=mesh(zap?root:body,'faceplate',box(w*.64,.3,.035),dark,zap?[0,h*.6,.43]:[0,0,.43]);
  for(const side of [-1,1]){
    const s=new T.Shape();s.moveTo(-.11,-.045);s.lineTo(.11,-.045);s.lineTo(.08,.045);s.lineTo(-.08,.045);s.closePath();
    const eye=mesh(face,side<0?'eye-left':'eye-right',new T.ShapeGeometry(s),eyes,[side*w*.16,0,.025]);eye.geometry.userData.flatPanel=true;eye.userData.normalEye=eye.geometry;eye.userData.alarmedEye=prism(.2,.24,.005);
  }
  const brow=mesh(['popper','four-slice'].includes(kind)?root:face,'brow',prism(w*.56,.14,.06),dark,['popper','four-slice'].includes(kind)?[0,h*.66+.24,.47]:[0,.21,.04]);
  for(let i=0;i<(heavy?2:strip?3:1);i++)mesh(body,`slot${i}`,box(w/(heavy?2:strip?3:1)*.78,.055,.56),dark.clone(),[(i-((heavy?2:strip?3:1)-1)/2)*w/(heavy?2:strip?3:1),h*.5+.015,0]);
  for(const side of [-1,1])mesh(root,side<0?'foot-left':'foot-right',new T.CylinderGeometry(.2,.24,.2,5),dark,[side*w*.32,.1,0]);
  if(zap){for(let i=0;i<2;i++){
    const emitter=mesh(root,`coil${i}`,new T.CylinderGeometry(.19,.24,.6,5),dark,[(i-.5)*.65,h+.37,0]);
    mesh(emitter,`heater${i}`,new T.CylinderGeometry(.2,.2,.12,5),red,[0,.25,0]);
  }}else for(let i=0;i<(heavy?2:1);i++)mesh(root,`toast${i}`,prism(heavy?.67:strip?.6:w*.7,kind==='popper'?.65:.4,.26),gold,[(i-(heavy?1:0)/2)*.87,h+.28,0]);
  root.userData.height=h;root.userData.brow=brow;return root;
}
export function poseBible(u,{active,age,phase,moving,shot,expression}){
  const h=u.userData.height,flight=Math.min(1,phase/.8),air=moving&&phase<.8;
  u.scale.set(1,1,1);u.rotation.set(air?-.22:active==='attack'?.12:expression==='proud'?.1:Math.round(Math.sin(age*3)*2)*.012,0,0);
  u.position.y=air?.32*4*flight*(1-flight):0;
  const land=moving&&phase>=.8?Math.max(0,1-(phase-.8)/.2):0;
  u.userData.expression=expression;
  for(const side of ['left','right']){const foot=u.getObjectByName('foot-'+side);foot.position.y=air?.23:.1;foot.rotation.x=air?-.4:0;}
  const attack=active==='attack'&&shot>=.1&&shot<.22;
  u.traverse(o=>{
    if(o.name.startsWith('toast')){o.material.color.setHex(0xd99448);o.scale.copy(o.userData.scale);o.position.copy(o.userData.home);o.position.y+=land*.3+(attack?.9:0)+(expression==='alarmed'?.22:0);o.rotation.x=attack?-.35:0;}
    if(o.name.startsWith('coil')){o.position.copy(o.userData.home);o.position.z-=attack?.2:0;o.rotation.x=attack?-.3:0;}
    if(o.name.startsWith('heater')){o.material.emissive.setHex(0xf25745);o.material.emissiveIntensity=active==='attack'&&shot<.2?shot*12:0;}
    if(o.name.startsWith('eye-')){const side=o.name==='eye-left'?-1:1;o.geometry=expression==='alarmed'?o.userData.alarmedEye:o.userData.normalEye;for(const child of o.children)if(child.userData.ink)child.geometry=o.geometry;o.scale.set(1,expression==='proud'?1.5:1,1);o.rotation.z=expression==='determined'?side*-.22:0;}
    if(o.name.startsWith('slot')){o.material.emissive.setHex(0xf25745);o.material.emissiveIntensity=expression==='angry'?.8:0;}
  });
  const brow=u.userData.brow;brow.position.y=brow.userData.home.y+(expression==='proud'?.09:expression==='angry'?-.06:0);brow.rotation.z=expression==='angry'?.18:0;
  if(u.name==='power-strip'){u.rotation.x=0;u.position.y=active==='idle'?Math.max(0,Math.sin(age*3))*.015:u.position.y;}
}
