import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const scenery=new Set(['terrain-kit','ground-patches','ground','crystal','toppings']);
const buildings=new Set(['toast-stacks','turret','trading-house','press','track','drill','toaster-oven','outlet','mill','pump','churn','generator','power-strip','cords-power']);
// Keep attachment nodes for the animation API; only broad surfaces survive the revision.
const primary=/^(body|toast\d|coil\d|foot-left|foot-right|feet|door|leg-left|leg-right|.*shell|.*lid|wing-.*|lift-.*|roll-top|dial|.*wheel|.*base|.*basket|.*tray)$/;
const face=/face|visor|eye-|shoulder|neutral-band|heater|plug|light|beep-ring|counter-rim|bank-rim/;
const effect=/projectile|bolt|target|flash|slice|crumb|shell|fire|flak\d|siege-toast|flame/;
function emptyGeometry(){const g=new T.BufferGeometry();for(const [name,size] of [['position',3],['normal',3],['uv',2]])g.setAttribute(name,new T.Float32BufferAttribute([],size));return g;}
function block(geometry,flat=false){
  geometry.computeBoundingBox();const b=geometry.boundingBox;
  if(!b||b.isEmpty())return emptyGeometry();
  const size=b.getSize(new T.Vector3()),center=b.getCenter(new T.Vector3());
  const g=new T.BoxGeometry(Math.max(size.x,.005),Math.max(size.y,.005),Math.max(size.z,.005));
  // Paint and toast are flat block faces; structural parts are complete boxes.
  const indices=Array.from(g.index.array);
  g.setIndex(flat?indices.slice(24,30):indices);
  g.clearGroups();g.translate(center.x,center.y,center.z);return g;
}
export function rebuildBlocky(root,kind,team='cyan'){
  root.userData.team=team;
  if(scenery.has(kind))return;
  const left=root.getObjectByName('foot-left')??root.getObjectByName('lift-left')??root.getObjectByName('leg-left'),right=root.getObjectByName('foot-right')??root.getObjectByName('lift-right')??root.getObjectByName('leg-right');
  if(!root.userData.blocky&&left&&right&&left.parent===right.parent){
    const g=new T.BoxGeometry(Math.abs(right.position.x-left.position.x)+.32,.2,.45);
    g.translate((right.position.x-left.position.x)/2,0,0);left.geometry=g;right.geometry=emptyGeometry();
  }
  const body=root.getObjectByName('body');
  if(body?.isMesh){
    body.geometry.computeBoundingBox();const bounds=body.geometry.boundingBox;
    const add=(name,w,h,x,y,z,color)=>{const m=new T.Mesh(new T.BoxGeometry(w,h,.015),new T.MeshPhysicalMaterial({color,flatShading:true,roughness:.85}));m.name=name;m.position.set(x,y,z);body.add(m);};
    const center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3()),z=bounds.max.z+.02;
    if(!root.getObjectByName('faceplate')&&!root.getObjectByName('pilot-visor')&&!root.getObjectByName('blocky-faceplate'))add('blocky-faceplate',size.x*.6,size.y*.3,center.x,center.y,z,0x303844);
    for(const side of [-1,1])if(!root.getObjectByName(side<0?'eye-left':'eye-right'))add(side<0?'eye-left':'eye-right',.09,.07,center.x+side*size.x*.15,center.y,z+.02,0xf7f4eb);
    if(!root.getObjectByName('shoulder')&&!root.getObjectByName('blocky-shoulder'))add('blocky-shoulder',size.x*.22,size.y*.18,center.x+size.x*.35,center.y+size.y*.25,z,root.userData.team==='orange'?0xff8540:0x32d9e8);
  }
  const meshes=[];root.traverse(o=>{if(o.isMesh&&!o.userData.ink)meshes.push(o);});
  const unit=!buildings.has(kind);let remaining=unit?60:800;
  const rank=o=>{
    if(o.name.startsWith('special-'))return 2;
    const first=o.parent?.children.find(c=>c.isMesh&&!c.userData.ink)===o;
    if(!o.name&&first&&/body|lid|spout/.test(o.parent.name))return 0;
    if(!unit)return face.test(o.name)?1:0;
    if(!o.name&&first)return 1;
    return primary.test(o.name)?0:face.test(o.name)?1:effect.test(o.name)||!o.visible||/wish-|thought-|picket-|team-rim|mouth/.test(o.name)?2:3;
  };
  const sorted=[...meshes].sort((a,b)=>rank(a)-rank(b));
  for(const o of sorted){
    const wheel=(kind==='bagel'||root.userData.specialKind==='bagel')&&o.name==='body';
    let g;
    if(wheel){g=new T.CylinderGeometry(.8,.8,.4,5).rotateX(Math.PI/2);g.userData.facets=5;}
    else if((kind==='four-slice'||kind==='attack-four-slice')&&/^toast[01]$/.test(o.name)){
      const a=block(o.geometry,true),b=a.clone();a.scale(.42,1,1);b.scale(.42,1,1);a.translate(-.19,0,0);b.translate(.19,0,0);g=mergeGeometries([a,b]);a.dispose();b.dispose();
    }else g=block(o.geometry,rank(o)>0||/^toast/.test(o.name));
    if(g.index&&(/^(coil[01]|foot-left)$/.test(o.name))){const ids=Array.from(g.index.array);const start=o.name==='foot-left'?12:18;g.setIndex([...ids.slice(0,start),...ids.slice(start+6)]);}
    const cost=g.index?g.index.count/3:g.attributes.position.count/3;
    if(cost>remaining||kind==='attack-specialists'&&['siege-toast','flame','flak0','flak1'].includes(o.name)||unit&&rank(o)===3||kind==='flying-toast'&&o===left||kind==='breadbox'&&o.name==='toast0'){g.dispose();g=emptyGeometry();}
    else remaining-=cost;
    o.geometry=g;o.userData.blockySurface=true;
    if(rank(o)>0||/^toast/.test(o.name))o.material.side=T.DoubleSide;
    if(o.name==='body'){o.material=o.material.clone();o.material.color.setHex(0xf2d7a6);}
    if(o.name.startsWith('eye-')){o.userData.normalEye=g;o.userData.alarmedEye=g;}
  }
  root.userData.blocky=true;
  root.userData.blockyParts=meshes.filter(o=>primary.test(o.name)&&o.geometry.attributes.position.count>0).map(o=>o.name);
}
