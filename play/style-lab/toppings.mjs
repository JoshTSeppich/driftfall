import * as T from 'three';

// Six rigid ingredients: neutral resources, with silhouette rather than labels.
export function buildToppings(look){
  const root=new T.Group();
  const mat=color=>new T.MeshPhysicalMaterial({color,flatShading:true,roughness:look==='Y2K GLOSS'?.22:.85,clearcoat:look==='Y2K GLOSS'?1:0});
  const cream=mat(0xf2d7a6),gold=mat(0xd99448),dark=mat(0x303844),butter=mat(0xe6c56c),jam=mat(0xa95863),nut=mat(0x805432),salt=mat(0xcad3cd);
  const part=name=>{const p=new T.Group();p.name='topping-'+name;root.add(p);return p;};
  const mesh=(p,g,m,x,y,z)=>{const o=new T.Mesh(g,m);o.position.set(x,y,z);p.add(o);return o;};
  const box=(p,w,h,d,m,x=0,y=h/2,z=0)=>mesh(p,new T.BoxGeometry(w,h,d),m,x,y,z);
  const pent=(p,r,h,m,y=h/2,top=r)=>mesh(p,new T.CylinderGeometry(top,r,h,5),m,0,y,0);
  const pat=part('butter');pent(pat,.39,.07,cream);box(pat,.48,.19,.35,butter,0,.165);
  const jelly=part('jam');pent(jelly,.29,.48,jam);pent(jelly,.32,.1,dark,.53);box(jelly,.27,.19,.04,cream,0,.25,.25);
  const honey=part('honey');pent(honey,.34,.42,gold,.21,.23);pent(honey,.25,.13,nut,.485);box(honey,.16,.2,.04,cream,0,.23,.28);
  const crystal=part('salt');pent(crystal,.28,.65,salt,.325,0);pent(crystal,.18,.33,cream,.165,0).position.x=.24;
  const sugar=part('sugar');box(sugar,.43,.43,.43,cream);box(sugar,.25,.25,.25,salt,.2,.125,.19);
  const spread=part('nut-butter');pent(spread,.34,.36,nut);pent(spread,.36,.12,cream,.42);box(spread,.37,.15,.04,gold,0,.2,.3);
  return root;
}

export function poseToppings(root,{active,age,elapsed,spring,homeX}){
  const state=root.userData.motion??={},moving=active==='move',market=active==='trade';
  const cycle=age*2,f=Math.min(1,(cycle%1)/.8),hop=moving?.27*4*f*(1-f):0;
  root.position.set(homeX+(moving?(Math.floor(cycle)+1-(1-f)**3)*.38:0),hop,1.2);
  const stretch=moving?1+.08*Math.sin(f*Math.PI*2):1;
  root.scale.set(1/Math.sqrt(stretch),stretch,1/Math.sqrt(stretch));
  root.children.forEach((p,i)=>{
    const collecting=active==='gather'||active==='deliver';
    const t=age-i*.075,pop=collecting&&t>0&&t<.5?.7*Math.sin(t/.5*Math.PI):0;
    const target=pop+Math.sin(age*5+i)*.018;
    for(let n=0,steps=Math.max(1,Math.ceil(elapsed/.008));n<steps;n++){
      const dt=elapsed/steps;
      spring(state,'lift'+i,target,dt,320,15);
      spring(state,'rock'+i,market?-.22:Math.sin(age*4+i)*.04,dt,240,14);
      spring(state,'depth'+i,market?0:(i<3?-.5:.55),dt,260,18);
    }
    p.position.set(market?(i-2.5)*.83:(i%3-1)*1.05,Math.max(0,state['lift'+i]||0),state['depth'+i]||0);
    p.rotation.x=state['rock'+i]||0;
  });
  root.userData.presentation=market?'market':'pickups';root.visible=active!=='death';
}
