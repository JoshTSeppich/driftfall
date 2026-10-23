import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createLab, LOOKS } from './lab.mjs';
export function boot() {
  const canvas=document.querySelector('canvas');
  const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=T.ACESFilmicToneMapping;renderer.info.autoReset=false;
  let glossy=false, composer;
  const lab=createLab({renderer:{render(scene,camera){renderer.info.reset();if(glossy)composer.render();else renderer.render(scene,camera);}}});
  lab.setShape(document.querySelector('#shape').value);
  const pmrem=new T.PMREMGenerator(renderer), room=new RoomEnvironment(), env=pmrem.fromScene(room,.04);room.dispose();pmrem.dispose();
  composer=new EffectComposer(renderer);composer.addPass(new RenderPass(lab.scene,lab.camera));
  const bloom=new UnrealBloomPass(new T.Vector2(innerWidth,innerHeight),.28,.45,1.1);composer.addPass(bloom);composer.addPass(new OutputPass());
  // Preserve the CSS dusk sky through the render target in gloss mode.
  const controls=new OrbitControls(lab.camera,canvas);controls.target.set(0,.6,0);controls.enableDamping=true;controls.minDistance=2;controls.maxDistance=28;controls.maxPolarAngle=Math.PI*.48;
  let team='cyan',stress=false,auto=true,lastDemo=-10,step=0,last=performance.now(),frames=0,fps=0;
  const status=document.querySelector('#action');
  function pickLook(i){glossy=i===2;lab.setLook(LOOKS[i]);lab.scene.environment=glossy?env.texture:null;resize();document.querySelectorAll('[data-look]').forEach((b,j)=>b.setAttribute('aria-pressed',String(i===j)));}
  function action(name){lab.trigger(name);status.textContent=name.toUpperCase();}
  document.querySelectorAll('[data-look]').forEach((b,i)=>b.onclick=()=>pickLook(i));
  document.querySelector('#shape').onchange=e=>{lab.setShape(e.target.value);if(e.target.value==='terrain-kit'){controls.target.set(0,0,0);lab.camera.position.set(11,15,17);}resize();};
  document.querySelector('#terrain-inspection').onchange=e=>{const stage=document.querySelector('#stage');stage.classList.toggle('terrain720',e.target.value==='720');stage.classList.toggle('terrainthumb',e.target.value==='thumb');resize();};
  document.querySelector('#expression').onchange=e=>lab.setExpression(e.target.value);
  document.querySelector('#production').onchange=e=>{document.querySelector('#stage').classList.toggle('production',e.target.checked);resize();};
  document.querySelector('#dam').onchange=e=>lab.setDam(e.target.checked);
  const actionBox=document.querySelector('#actions');for(const name of lab.actions){const b=document.createElement('button');b.textContent=name.replace('-', ' ');b.onclick=()=>{auto=false;document.querySelector('#auto').setAttribute('aria-pressed','false');action(name);};actionBox.append(b);}
  document.querySelector('#team').onclick=()=>{team=team==='cyan'?'orange':'cyan';lab.setTeam(team);resize();document.querySelector('#team').textContent=`Team: ${team}`;};
  document.querySelector('#stress').onclick=()=>{stress=!stress;lab.setStress(stress);document.querySelector('#stress').setAttribute('aria-pressed',String(stress));};
  document.querySelector('#auto').onclick=()=>{auto=!auto;lastDemo=-10;document.querySelector('#auto').setAttribute('aria-pressed',String(auto));};
  addEventListener('keydown',e=>{if(['1','2','3'].includes(e.key))pickLook(Number(e.key)-1);});
  function resize(){const w=canvas.clientWidth,h=canvas.clientHeight;if(document.querySelector('#production').checked){const u=lab.units[0];const box=new T.Box3().setFromObject(u),center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3());controls.target.copy(center);lab.camera.position.copy(center).add(new T.Vector3(0,1,1.5).normalize().multiplyScalar(Math.max(size.x,size.y,size.z)*2.2));}renderer.setPixelRatio(document.querySelector('#production').checked||document.querySelector('#terrain-inspection').value!=='normal'?1:Math.min(devicePixelRatio,1.5));renderer.setSize(w,h,false);composer.setSize(w,h);lab.resize(w,h);}
  addEventListener('resize',resize);pickLook(1);
  const sequence=['trade','press','convey','drill','produce','claim','detect','drop','push-rock','cut-cord','replug','hide','repair','spawn','idle','move','stop','siege','attack','hit','gather','deliver','grind','pump','churn','generate','harvest','rank-up','shimmer','construction','death'];
  function frame(ms){requestAnimationFrame(frame);const t=ms/1000;
    if(auto&&t-lastDemo>(sequence[(step-1+sequence.length)%sequence.length]==='cut-cord'?12:sequence[(step-1+sequence.length)%sequence.length]==='gather'?4:1.5)){action(sequence[step++%sequence.length]);lastDemo=t;}
    controls.update();lab.update(t);frames++;
    if(ms-last>=500){fps=Math.round(frames*1000/(ms-last));document.querySelector('#fps').textContent=`${fps} FPS · ${stress?200:lab.units.length} units · ${renderer.info.render.calls} draws · ${renderer.info.render.triangles.toLocaleString()} triangles`;frames=0;last=ms;}
  }
  requestAnimationFrame(frame);
}
if(typeof document!=='undefined') {try{boot();}catch(error){document.querySelector('#action').textContent=`Could not start WebGL: ${error.message}`;console.error(error);}}
