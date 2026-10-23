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
export function rebuildBlocky(root,kind){
  if(scenery.has(kind))return;
  const left=root.getObjectByName('foot-left')??root.getObjectByName('lift-left'),right=root.getObjectByName('foot-right')??root.getObjectByName('lift-right');
  if(left&&right&&left.parent===right.parent){
    const g=new T.BoxGeometry(Math.abs(right.position.x-left.position.x)+.32,.2,.45);
    g.translate((right.position.x-left.position.x)/2,0,0);left.geometry=g;right.geometry=emptyGeometry();
  }
  const meshes=[];root.traverse(o=>{if(o.isMesh&&!o.userData.ink)meshes.push(o);});
  const unit=!buildings.has(kind);let remaining=unit?60:800;
  const rank=o=>primary.test(o.name)?0:face.test(o.name)?1:effect.test(o.name)||!o.visible?2:3;
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
    if(cost>remaining||unit&&rank(o)===3){g.dispose();g=emptyGeometry();}
    else remaining-=cost;
    o.geometry=g;
    if(o.name==='body'&&kind!=='cold-toast'){o.material=o.material.clone();o.material.color.setHex(0xf2d7a6);}
    if(o.name.startsWith('eye-')){o.userData.normalEye=g;o.userData.alarmedEye=g;}
  }
  root.userData.blocky=true;
  root.userData.blockyParts=meshes.filter(o=>primary.test(o.name)&&o.geometry.attributes.position.count>0).map(o=>o.name);
}
