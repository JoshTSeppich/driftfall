import * as T from 'three';

// Three rigid conveyor decks and their three rigid loads: no individual tread rig.
export function buildTrack(look,team){
  const root=new T.Group();
  const mat=c=>new T.MeshPhysicalMaterial({color:c,flatShading:true,roughness:look==='Y2K GLOSS'?.2:.85,clearcoat:look==='Y2K GLOSS'?1:0});
  const cream=mat(0xf2d7a6),dark=mat(0x303844),paint=mat(team==='orange'?0xff8540:0x32d9e8),crystal=mat(0xd99448);
  const box=(p,w,h,d,m,x,y,z)=>{const o=new T.Mesh(new T.BoxGeometry(w,h,d),m);o.position.set(x,y,z);p.add(o);return o;};
  for(const [i,name] of ['straight','corner','junction'].entries()){
    const deck=new T.Group();deck.name='track-'+name;root.add(deck);deck.userData.center=(i-1)*2.1;
    // A straight-through deck, an elbow, and a T splitter; broad rims carry team paint.
    const arms=name==='straight'?[[0,-.5],[0,.5]]:name==='corner'?[[0,-.5],[.5,0]]:[[0,-.5],[-.5,0],[.5,0]];
    box(deck,.8,.22,.8,cream,0,.19,0);
    box(deck,.58,.06,.58,dark,0,.33,0);
    for(const [x,z] of arms){
      const horizontal=x!==0;
      box(deck,horizontal?.9:.8,.22,horizontal?.8:.9,cream,x,.19,z);
      box(deck,horizontal?.9:.56,.06,horizontal?.56:.9,dark,x,.33,z);
      for(const side of [-1,1])box(deck,horizontal?.9:.1,.1,horizontal?.1:.9,paint,x+(horizontal?0:side*.34),.36,z+(horizontal?side*.34:0));
    }
    const load=new T.Group();load.name='slice-'+name;load.userData.center=deck.userData.center;root.add(load);
    const slice=new T.Mesh(new T.CylinderGeometry(.29,.29,.13,5),crystal);slice.name='crystal-'+name;load.add(slice);
    // One broad pentagonal crystal face, no small surface detail.
  }
  return root;
}
export function poseTrack(root,{active,age,elapsed,spring,homeX}){
  const s=root.userData.motion??={},running=['convey','gather','deliver','attack'].includes(active);
  const moving=active==='move',phase=age*2%1,f=Math.min(1,phase/.8);
  for(let i=0,n=Math.max(1,Math.ceil(elapsed/.008));i<n;i++){
    const dt=elapsed/n;
    spring(s,'bob',Math.sin(age*(running?22:4))*(running?.045:.012),dt,420,17);
    spring(s,'tilt',running?Math.sin(age*12)*.1:Math.sin(age*4)*.025,dt,260,16);
  }
  root.position.set(homeX+(moving?(Math.floor(age*2)+1-(1-f)**3)*.4:0),moving?.24*4*f*(1-f):0,1.2);
  root.rotation.set(0,0,0);root.scale.setScalar(1);
  // Indexed loads pause between strokes. At the hidden return boundary the next slice enters.
  const p=(age*(running?1.5:.25))%1,q=Math.min(1,(p%.5)/.38),ease=q*q*(3-2*q),v=p<.5?-.72+.72*ease:.72*ease;
  for(const name of ['straight','corner','junction']){
    const deck=root.getObjectByName('track-'+name),load=root.getObjectByName('slice-'+name),center=deck.userData.center;
    deck.position.set(center,s.bob||0,0);deck.rotation.z=s.tilt||0;
    let x=0,z=v;
    if(name!=='straight'){
      if(p<.5){x=0;z=v;}else{x=v*(name==='junction'&&Math.floor(age*(running?1.5:.25))%2?-1:1);z=0;}
    }
    load.position.set(center+x,.5+(s.bob||0)+Math.sin(q*Math.PI)*.075,z);
    load.rotation.set(0,name==='straight'?0:(p<.5?0:Math.PI/2),s.tilt||0);
    load.visible=p>.025&&p<.975;
  }
  root.visible=active!=='death'||age<.3;
}
