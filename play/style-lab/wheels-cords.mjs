import * as T from 'three';
import {WHEELS as W,CORD as C,PALETTE} from '../toaster-spec.mjs';
// One cable mesh: ten angular coil spans, three ground spans; five facets throughout.
export function addWheelsCord(root,chassis,team){
 const [w,h,d]=chassis.size,r=h*W.diameterOfBodyH/2;
 const gear=new T.Group();gear.name='running-gear';root.add(gear);
 if(root.name!=='bagel')for(let i=0;i<W.count;i++){
  const sign=i%2?1:-1,width=w*W.widthOfBodyW;
  const wheel=new T.Mesh(new T.CylinderGeometry(r,r,width,W.sides,1,true).rotateZ(Math.PI/2),new T.MeshPhysicalMaterial({color:PALETTE[W.tyre],flatShading:true,roughness:.8,side:T.DoubleSide}));
  wheel.name='wheel-'+i;wheel.position.set(sign*(w/2+w*W.outsideSides-width/2),r,(i<2?1:-1)*d*(.5-W.frontInset));gear.add(wheel);
  const hub=new T.Mesh(new T.CircleGeometry(r*W.hubOfDiameter,5).rotateY(sign*Math.PI/2),new T.MeshBasicMaterial({color:PALETTE[W.hub]}));hub.position.x=sign*width/2;wheel.add(hub);
 }
 const cord=new T.Mesh(new T.TubeGeometry(new T.LineCurve3(new T.Vector3(),new T.Vector3(0,0,-2)),12,C.radius,5,false),new T.MeshStandardMaterial({color:PALETTE[team],emissive:PALETTE[team],emissiveIntensity:C.colourEmissive,flatShading:true}));cord.name='power-cord';gear.add(cord);
 const plug=new T.Mesh(new T.BoxGeometry(...C.plug.size),new T.MeshStandardMaterial({color:PALETTE.charcoal}));plug.name='cord-plug';gear.add(plug);
 for(let i=0;i<3;i++){const bead=new T.Mesh(new T.PlaneGeometry(C.radius*2.3,C.pulseLength).rotateX(-Math.PI/2),new T.MeshBasicMaterial({color:PALETTE[team],toneMapped:false}));bead.name='energy-bead-'+i;gear.add(bead);}
 root.userData.wheelCord={w,h,d,r,lift:root.name==='bagel'?0:2*r*W.lift};poseWheelsCord(root,{active:'idle',age:0});
}
export function poseWheelsCord(root,{active,age}){
 const {h,d,r,lift}=root.userData.wheelCord,moving=active==='move';
 const travel=moving?Math.min(age*C.pulseSpeed,C.coilLength*6):0,tension=travel/(C.coilLength*6);root.userData.cordTension=tension;
 root.position.x+=travel;root.position.y=lift+(moving?.018*(1-Math.cos(travel/r*5)):.008*Math.sin(age*5));
 root.scale.set(1,1+(moving?.015*Math.sin(age*18):.006*Math.sin(age*5)),1);root.rotation.set(moving?-.025:0,0,0);
 const gear=root.getObjectByName('running-gear');gear.position.y=-root.position.y;
 for(let i=0;i<W.count;i++){const wheel=root.getObjectByName('wheel-'+i);if(wheel)wheel.rotation.x=travel/r;}
 const taut=Math.max(0,(tension-C.tautAt)/(1-C.tautAt));
 const points=[],exitY=lift+h*C.exitHeightOfBodyH,back=-d/2;
 for(let i=0;i<=10;i++){const f=i/10,a=f*C.coilTurns*Math.PI*2,coil=C.coilRadius*(1-taut)*(1+.08*Math.sin(age*9));points.push(new T.Vector3(Math.sin(a)*coil,exitY+Math.cos(a)*coil,back-f*C.coilLength*(1+taut)));}
 points.push(new T.Vector3(-travel*.35, C.radius,back-1),new T.Vector3(-travel*.7+(1-taut)*.4,C.radius,back-1.6),new T.Vector3(-travel,C.radius,back-2));
 if(taut>0){const start=points[0].clone(),end=points.at(-1).clone();points.forEach((p,i)=>p.lerp(start.clone().lerp(end,i/(points.length-1)),taut));}
 const curve=new T.CurvePath();for(let i=1;i<points.length;i++)curve.add(new T.LineCurve3(points[i-1],points[i]));
 const cord=root.getObjectByName('power-cord');const positions=cord.geometry.attributes.position,normals=cord.geometry.attributes.normal;
 const up=new T.Vector3(0,1,0),rotation=new T.Quaternion(),normal=new T.Vector3();
 for(let i=0;i<=12;i++){const t=i/12,centre=curve.getPoint(t),tangent=curve.getTangent(Math.min(.99999,Math.max(.00001,t)));rotation.setFromUnitVectors(up,tangent);
  for(let j=0;j<=5;j++){const a=j/5*Math.PI*2;normal.set(Math.cos(a),0,Math.sin(a)).applyQuaternion(rotation);const n=i*6+j;positions.setXYZ(n,centre.x+normal.x*C.radius,centre.y+normal.y*C.radius,centre.z+normal.z*C.radius);normals.setXYZ(n,normal.x,normal.y,normal.z);}}
 positions.needsUpdate=true;normals.needsUpdate=true;cord.geometry.computeBoundingSphere();
 cord.material.emissiveIntensity=C.colourEmissive+(taut>0?1+Math.abs(Math.sin(age*18))*2:0);
 root.getObjectByName('cord-plug').position.copy(points.at(-1));
 const length=curve.getLength();for(let i=0;i<3;i++){const bead=root.getObjectByName('energy-bead-'+i),distance=((age*C.pulseSpeed+i*C.pulseSpacing)%length);bead.position.copy(curve.getPoint(1-distance/length));}
}
