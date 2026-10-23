import * as T from 'three';

// Six rigid assemblies; the wish icon is fixed to the thought-bubble pivot.
export function buildMoods(look,team){
  const root=new T.Group();
  const mat=color=>new T.MeshPhysicalMaterial({color,flatShading:true,roughness:look==='Y2K GLOSS'?.2:.85,clearcoat:look==='Y2K GLOSS'?1:0});
  const cream=mat(0xf2d7a6),dark=mat(0x303844),gold=mat(0xd99448),crust=mat(0x805432),paint=mat(team==='orange'?0xff8540:0x32d9e8),jam=mat(0xf25745);
  const pivot=name=>{const p=new T.Group();p.name='mood-'+name;root.add(p);return p;};
  const mesh=(p,g,m,x,y,z,name='')=>{const o=new T.Mesh(g,m);o.position.set(x,y,z);o.name=name;p.add(o);return o;};
  const box=(p,w,h,d,m,x,y,z,name)=>mesh(p,new T.BoxGeometry(w,h,d),m,x,y,z,name);
  const pent=(p,r,h,m,x,y,z,name)=>mesh(p,new T.CylinderGeometry(r,r,h,5),m,x,y,z,name);
  const panel=(p,r,d,m,x,y,z,name)=>{const shape=new T.Shape();for(let i=0;i<5;i++){const a=Math.PI/2+i*Math.PI*2/5;if(i===0)shape.moveTo(r*Math.cos(a),r*Math.sin(a));else shape.lineTo(r*Math.cos(a),r*Math.sin(a));}shape.closePath();const geo=new T.ShapeGeometry(shape);geo.userData.facets=5;m.side=T.DoubleSide;return mesh(p,geo,m,x,y,z,name);};
  const body=pivot('body');pent(body,.61,.65,cream,0,0,0);
  pent(body,.63,.16,paint,0,-.22,0,'team-rim');
  box(body,.8,.26,.06,dark,0,.03,.49,'faceplate');
  for(const [x,name] of [[-.2,'eye-left'],[.2,'eye-right']]){
    const eye=panel(body,.12,.025,paint,x,.045,.535,name);eye.scale.y=.42;
  }
  box(body,.76,.05,.23,dark,0,.35,0,'toast-slot');
  for(const side of ['left','right'])pent(pivot(side+'-foot'),.22,.14,dark,0,.07,0);
  const brow=pivot('brow');box(brow,.78,.095,.09,dark,0,0,0);
  const bubble=pivot('bubble');panel(bubble,.39,.07,cream,0,0,0,'thought-outline');
  // One angular tail, no cloud scallops or tiny particles.
  panel(bubble,.1,.06,cream,-.25,-.36,0,'thought-tail');
  const toast=panel(bubble,.245,.04,crust,0,0,.06,'wish-toast');toast.scale.y=1.1;
  panel(bubble,.2,.03,gold,0,0,.09,'wish-plain');
  box(bubble,.17,.12,.025,cream,-.045,.05,.12,'wish-butter');
  panel(bubble,.105,.025,jam,.065,-.055,.13,'wish-jam');
  const garnish=panel(bubble,.09,.025,paint,.06,.15,.14,'wish-garnish');garnish.scale.x=.5;
  const sign=pivot('sign');pent(sign,.045,.65,crust,0,.25,0);
  box(sign,.65,.4,.07,cream,0,.7,0,'picket-board');
  // Broad charcoal equals glyph: a serious demand for equal toast rations.
  for(const y of [.65,.76])box(sign,.4,.045,.025,dark,0,y,.055);
  sign.visible=false;
  return root;
}

export function poseMoods(root,{active,age,elapsed,spring,homeX,wish}){
  const s=root.userData.motion??={},moving=active==='move',happy=active==='happy',strike=active==='strike',grumpy=active==='grumpy'||strike;
  const cycle=age*2,phase=cycle%1,f=Math.min(1,phase/.8),hopping=moving||happy;
  const hop=hopping?(happy?.4:.26)*4*f*(1-f):0;
  for(let i=0,n=Math.max(1,Math.ceil(elapsed/.008));i<n;i++){
    const dt=elapsed/n;
    spring(s,'bubble',Math.sin(age*4)*.035+(happy?.06:0),dt,220,12);
    spring(s,'brow',grumpy?.24:happy?-.15:0,dt,400,17);
    spring(s,'sign',strike?.85:0,dt,350,15);
    spring(s,'rock',strike?Math.sin(age*7)*.045:Math.sin(age*4)*.018,dt,260,16);
  }
  root.position.set(homeX+(moving?(Math.floor(cycle)+1-(1-f)**3)*.38:0),hop,1.2);
  const stretch=hopping?1+.08*Math.sin(f*Math.PI*2):1;
  root.scale.set(1/Math.sqrt(stretch),stretch,1/Math.sqrt(stretch));
  const body=root.getObjectByName('mood-body');body.position.set(0,.53,0);body.rotation.z=s.rock||0;body.rotation.x=hopping?-.1:0;
  for(const [side,x] of [['left',-.33],['right',.33]])root.getObjectByName('mood-'+side+'-foot').position.set(x,0,0);
  const brow=root.getObjectByName('mood-brow');brow.position.set(0,.71+(happy?.05:0),.53);brow.rotation.z=s.brow||0;
  for(const name of ['eye-left','eye-right']){const eye=root.getObjectByName(name);eye.rotation.z=(name==='eye-left'?1:-1)*(grumpy?-.35:happy?.15:0);}
  const bubble=root.getObjectByName('mood-bubble');bubble.position.set(.53,1.55+(s.bubble||0),.05);bubble.rotation.z=-(s.bubbleVelocity||0)*.06;
  const sign=root.getObjectByName('mood-sign');sign.visible=strike;sign.position.set(-.78,s.sign||0,.05);sign.rotation.z=strike?-.16+(s.signVelocity||0)*.04:0;
  root.getObjectByName('wish-butter').visible=wish==='buttered'||wish==='gourmet';
  root.getObjectByName('wish-jam').visible=wish==='jam'||wish==='gourmet';
  root.getObjectByName('wish-garnish').visible=wish==='gourmet';
  root.userData.wish=wish;root.visible=active!=='death';
}
