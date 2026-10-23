import * as T from 'three';
import {buildBible,poseBible} from './bible.mjs';
export const TERRAIN_PALETTE=Object.freeze({ground:0x52696b,high:0x71878a,cliff:0x303f48,ramp:0x89918a,shallow:0x367d8a,deep:0x244e67,dammed:0x499caa,wheat:0xc9a65e,meadow:0x77977c,socket:0x516a79,rock:0xa0a7a0,neutral:0xcad3cd,cyan:0x32d9e8,orange:0xff8540,fog:0x26353f});
// Renderer-independent scene builders. Coordinates are world-space x/z, heights in y.
// Terrain uses unlit base targets to keep the exact quiet palette under studio lighting.
export function buildTerrain(look,team){
  const root=new T.Group(),land=new T.Group();land.name='landscape';root.add(land);
  const mat=c=>new T.MeshBasicMaterial({color:c,side:T.DoubleSide});
  const mesh=(name,g,c,x=0,y=0,z=0,parent=land)=>{const o=new T.Mesh(g,mat(c));o.name=name;o.position.set(x,y,z);parent.add(o);return o;};
  const box=(name,w,h,d,c,x,y,z)=>mesh(name,new T.BoxGeometry(w,h,d),c,x,y,z);
  const polygon=(name,pts,c,y,opacity=1)=>{const s=new T.Shape();pts.forEach(([x,z],i)=>i?s.lineTo(x,-z):s.moveTo(x,-z));s.closePath();const o=mesh(name,new T.ShapeGeometry(s),c,0,y);o.rotation.x=-Math.PI/2;o.material.transparent=opacity<1;o.material.opacity=opacity;return o;};
  box('base-ground',12,.3,9,TERRAIN_PALETTE.ground,0,-.18,0);
  mesh('cliff-faces',new T.CylinderGeometry(2.5,2.9,1.1,5),TERRAIN_PALETTE.cliff,-3,.5,-1.8).scale.z=.8;
  mesh('high-ground',new T.CylinderGeometry(2.5,2.5,.04,5),TERRAIN_PALETTE.high,-3,1.07,-1.8).scale.z=.8;
  const ramp=polygon('ramp',[[-4,.1],[-2,.1],[-1.8,2.3],[-4.2,2.3]],TERRAIN_PALETTE.ramp,.03);
  const pos=ramp.geometry.attributes.position;for(let i=0;i<pos.count;i++)pos.setZ(i,Math.max(0,(2.3+pos.getY(i))/2.2)*1.04);pos.needsUpdate=true;ramp.geometry.computeVertexNormals();
  const path=[[-.4,-4.5],[.5,-2.6],[.1,-.8],[1.2,1.2],[.6,2.8],[1.5,4.5]];
  const ribbon=(name,width,color,height)=>polygon(name,[...path.map(([x,z])=>[x-width,z]),...path.toReversed().map(([x,z])=>[x+width,z])],color,height);
  ribbon('river-shallow',.8,TERRAIN_PALETTE.shallow,.005);ribbon('river-deep',.48,TERRAIN_PALETTE.deep,.015);
  polygon('dammed-water',[[-.25,-2.6],[.95,-2.6],[.75,-1.1],[-.45,-1.1]],TERRAIN_PALETTE.dammed,.025);
  for(let i=0;i<3;i++)mesh('dam-rock-'+i,new T.CylinderGeometry(.42,.5,.55,5),TERRAIN_PALETTE.cliff,-.5+i*.5,.24,-.65);
  box('spillway',.32,.025,1.35,0xa6ddec,.12,.32,-.3);
  box('wheat',2.2,.025,1.6,TERRAIN_PALETTE.wheat,3,.01,-2.8);
  for(let row=0;row<2;row++)for(let col=0;col<3;col++){
    const tuft=new T.Group();tuft.name='five-stalk-bundle';land.add(tuft);
    for(let i=0;i<5;i++){const a=i*Math.PI*2/5;const o=mesh('wheat-stalk',new T.ConeGeometry(.1,.48,5),TERRAIN_PALETTE.wheat,2.4+col*.6+Math.cos(a)*.12,.25,-3.2+row*.75+Math.sin(a)*.12,tuft);o.rotation.z=Math.cos(a)*.15;}
  }
  box('dairy-meadow',2.5,.025,1.65,TERRAIN_PALETTE.meadow,3.6,.01,2.6);
  for(const [x,z] of [[3,2.3],[4.1,2.8]])box('butter-block',.7,.35,.46,0xf2d7a6,x,.2,z);
  for(const [name,x,z,built] of [['generator-empty',3.7,-.3,false],['generator-built',-4.3,3.3,true]]){
    mesh(name,new T.CylinderGeometry(.68,.78,.18,5),TERRAIN_PALETTE.socket,x,.1,z);
    mesh(name+'-recess',new T.CylinderGeometry(.46,.46,.02,5),0x303844,x,.2,z);
    polygon(name+'-lightning',[[x+.08,z-.36],[x-.25,z+.05],[x-.03,z+.05],[x-.1,z+.36],[x+.25,z-.08],[x+.04,z-.08]],0xa6ddec,.22);
    if(built){mesh('generator-housing',new T.CylinderGeometry(.4,.5,.75,5),0x303844,x,.6,z);mesh('generator-cap',new T.ConeGeometry(.45,.25,5),0x71878a,x,1.1,z);}
  }
  const rock=mesh('movable-rock',new T.CylinderGeometry(.55,.7,.7,5),TERRAIN_PALETTE.rock,1,.38,3.4);rock.userData.pushable=true;
  mesh('rock-light-edge',new T.CylinderGeometry(.55,.55,.025,5),0xcad3cd,1,.74,3.4);
  mesh('rock-shadow',new T.CircleGeometry(.8,5),0x303f48,1,.025,3.4).rotation.x=-Math.PI/2;
  const border=(name,points,color,dashed)=>{
    const verts=[];for(let i=0;i<points.length-1;i++){const a=new T.Vector3(points[i][0],.08,points[i][1]),b=new T.Vector3(points[i+1][0],.08,points[i+1][1]);const n=dashed?10:1;for(let j=0;j<n;j++){verts.push(a.clone().lerp(b,j/n),a.clone().lerp(b,(j+(dashed?.55:1))/n));}}
    const line=new T.LineSegments(new T.BufferGeometry().setFromPoints(verts),new T.LineBasicMaterial({color}));line.name=name;land.add(line);
  };
  border('reach-neutral',[[-5.8,1.4],[-4.7,1],[-1.5,1.4]],TERRAIN_PALETTE.neutral,true);
  border('reach-ours',[[-5.6,4],[-1,4],[-1.5,1.4]],TERRAIN_PALETTE.cyan,false);
  // Enemy has angular teeth as well as a different hue; neutral has dashes.
  border('reach-enemy',[[2,-4],[5.6,-4],[5.6,-1],[5.3,-.8],[5.6,-.6],[5.6,1.5]],TERRAIN_PALETTE.orange,false);
  polygon('fog-explored',[[-6,-4.5],[-2,-4.5],[-2.2,-3.6],[-3.5,-3.1],[-6,-3.3]],TERRAIN_PALETTE.fog,1.15,.55);
  polygon('fog-unexplored',[[2,-4.5],[6,-4.5],[6,-2.8],[5,-3.3],[3,-3.8]],TERRAIN_PALETTE.fog,.06,.97);
  for(const [kind,x,z] of [['crumb',-4.4,.6],['popper',-2,2.8],['zapper',2.8,.7],['four-slice',-2.8,-1.6]]){
    const u=buildBible(kind,look,team);u.position.set(x,kind==='four-slice'?1.1:0,z);u.userData.anchor=u.position.clone();root.add(u);
  }
  return root;
}
export function poseTerrain(root,{active,age,elapsed,spring,expression}){
  root.position.set(0,0,0);root.rotation.set(0,0,0);root.scale.setScalar(1);root.visible=true;
  const state=root.userData.motion;
  for(let i=0;i<Math.max(1,Math.ceil(elapsed/.008));i++)spring(state,'rockPush',active==='push-rock'?1.1:0,elapsed/Math.max(1,Math.ceil(elapsed/.008)),170,23);
  const dx=state.rockPush||0;for(const n of ['movable-rock','rock-light-edge','rock-shadow'])root.getObjectByName(n).position.x=1+dx;
  for(const u of root.children.filter(o=>o.userData.bible)){
    const phase=age*2.5%1,anchor=u.userData.anchor;poseBible(u,{active,age,phase,moving:active==='move',shot:age%1.1,expression});
    u.position.y+=anchor.y;u.position.x=anchor.x+(active==='move'?Math.min(3,Math.floor(age*2.5)+1-(1-Math.min(1,phase/.8))**3)*.13:0);u.position.z=anchor.z;
    u.userData.suspension??={};const n=Math.max(1,Math.ceil(elapsed/.008));
    for(let i=0;i<n;i++)spring(u.userData.suspension,'rattle',active==='attack'&&age%1.1<.2?.14:Math.sin(age*5)*.018,elapsed/n,240,16);
    for(const part of u.children)if(part.name.startsWith('toast')||part.name.startsWith('coil'))part.position.y+=u.userData.suspension.rattle||0;
  }
  root.getObjectByName('spillway').material.color.setHex(0xa6ddec);
}
