import * as T from 'three';
import {TERRAIN_PALETTE as P} from './terrain-kit.mjs';

// Square metre tiles; the one bevel on the plateau is a deliberate 45-degree cut.
export function buildGridTerrain(look,team){
 const root=new T.Group(),tiles=new T.Group();tiles.name='grid-tiles';root.add(tiles);
 const mesh=(name,g,color,x=0,y=0,z=0,parent=root)=>{
  const m=new T.Mesh(g,new T.MeshBasicMaterial({color,side:T.DoubleSide}));m.name=name;m.position.set(x,y,z);parent.add(m);return m;
 };
 const box=(name,w,h,d,c,x,y,z,parent=root)=>mesh(name,new T.BoxGeometry(w,h,d),c,x,y,z,parent);
 const panel=(name,points,c,y)=>{
  const shape=new T.Shape(points.map(([x,z])=>new T.Vector2(x,-z)));
  const g=new T.ShapeGeometry(shape);g.userData.flatPanel=true;
  const m=mesh(name,g,c,0,y);m.rotation.x=-Math.PI/2;return m;
 };
 for(let z=-4;z<4;z++)for(let x=-5;x<5;x++){
  const water=x===3||(x>=2&&z>=0&&z<=2);
  const t=mesh('tile',new T.PlaneGeometry(1,1),water?P.shallow:P.ground,x+.5,-.025,z+.5,tiles);t.rotation.x=-Math.PI/2;
 }
 // Thin seams show the square grid without turning the land into a glowing board.
 const lines=[];
 for(let x=-5;x<=5;x++)lines.push(x,-.02,-4,x,-.02,4);
 for(let z=-4;z<=4;z++)lines.push(-5,-.02,z,5,-.02,z);
 const grid=new T.LineSegments(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(lines,3)),new T.LineBasicMaterial({color:P.cliff,transparent:true,opacity:.45}));root.add(grid);
 const outline=[[-5,-4],[0,-4],[1,-3],[1,-1],[0,-1],[-5,-1]];
 const s=new T.Shape(outline.map(([x,z])=>new T.Vector2(x,-z)));
 const cliff=new T.ExtrudeGeometry(s,{depth:1,bevelEnabled:false,steps:1});cliff.rotateX(-Math.PI/2);
 mesh('grid-cliff',cliff,P.cliff);
 panel('high-ground',outline,P.high,1.005);
 box('rectangular-base',4,.02,2,P.high,-2,1.02,-2.5);
 // Broad two-tile ramp, with its high edge exactly flush to the plateau.
 const ramp=new T.BufferGeometry();
 ramp.setAttribute('position',new T.Float32BufferAttribute([-2,1,-1,0,1,-1,-2,0,1,0,0,1,-2,0,-1,0,0,-1],3));
 ramp.setIndex([0,2,1,1,2,3,0,4,2,1,3,5,0,1,4,1,5,4]);ramp.computeVertexNormals();
 mesh('wide-wedge-ramp',ramp,P.ramp);
 box('wheat-line',4,.04,1,P.wheat,-2,1.045,-3.5);
 // Five broad blades per bundle, all bundles merged into one static mesh.
 const wheat=new T.Group();wheat.name='wheat-bundles';root.add(wheat);
 for(let x=-4.5;x<-.4;x++)for(let i=0;i<5;i++){
  const a=i*Math.PI*2/5;
  mesh('wheat-blade',new T.ConeGeometry(.075,.35,5),P.wheat,x+Math.cos(a)*.16,1.24,-3.5+Math.sin(a)*.16,wheat);
 }
 box('river',.66,.015,8,P.deep,3.5,.002,0);
 box('pond',2,.015,3,P.deep,3,.004,1.5);
 // Four rigid pieces, each with its own pivot. The foundation stays planted.
 const pump=new T.Group();pump.name='pump';pump.position.set(3.5,.04,1.5);root.add(pump);
 box('foundation',.9,.12,.9,0x303844,0,.06,0,pump);
 box('housing',.65,.65,.6,0xf2d7a6,0,.45,0,pump);
 const handle=new T.Group();handle.name='handle';handle.position.set(0,.82,0);pump.add(handle);
 box('handle-bar',1,.12,.16,team==='orange'?P.orange:P.cyan,.25,0,0,handle);
 mesh('spout',new T.CylinderGeometry(.13,.13,.65,5).rotateX(Math.PI/2),0x303844,0,.5,.5,pump);
 return root;
}
export function poseGridTerrain(root,{active,age,elapsed,spring}){
 root.userData.motion??={};const state=root.userData.motion,n=Math.max(1,Math.ceil(elapsed/.008));
 const working=active==='pump'||active==='gather'||active==='attack';
 const target=Math.sin(age*(working?15:4))*(working?.45:.035);
 for(let i=0;i<n;i++)spring(state,'handle',target,elapsed/n,200,18);
 root.getObjectByName('handle').rotation.z=state.handle||0;
 // A stationary machine does not travel on Move; its sprung handle still idles.
 root.getObjectByName('housing').position.y=.45+Math.abs(state.handle||0)*.035;
}
