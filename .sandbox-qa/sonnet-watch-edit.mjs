import fs from 'node:fs';
const p = '/Users/joshuaseppich/dev/rts/play/app.mjs';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); s = s.replace(a, () => b); };
rep("import { createLiveMatch } from '../env/live.mjs';", "import { createLiveMatch, loadAi } from '../env/live.mjs';\nimport { isWatch, createCaster, createTopbar, glide, nextSeed, RESTART_SECONDS } from './watch.mjs';");
rep("//        ?quality=high", "//        ?mode=watch (the built-in AI plays both sides; a caster camera follows the action; next seed 10 s after the end)\n//        ?quality=high");
rep("  const seed = Number(q.get('seed') ?? 7) || 7;", "  const watch = isWatch(q);\n  const seed = Number(q.get('seed') ?? 7) || 7;");
rep("    difficulty: q.get('difficulty') ?? 'easy',\n  });", `    difficulty: q.get('difficulty') ?? (watch ? 'normal' : 'easy'),
  });
  // Watch mode: a second built-in AI plays the "human" side, its commands queued like a player's.
  let watchAi = null;
  if (watch) {
    try { watchAi = await loadAi(aiModule ?? '../players/builtin/ai.mjs', { side, seed, difficulty: q.get('difficulty') ?? 'normal' }); }
    catch (err) { console.warn('[play] watch AI not loaded', err); }
  }
  const caster = watch ? createCaster() : null, topbar = watch ? createTopbar({ tps }) : null;`);
rep("    const cmds = input.tick(snap);\n", `    if (watch) {
      caster.note(state.tick, state, events); topbar.note(state);
      Promise.resolve(watchAi?.act(snap)).then((cmds) => { if (Array.isArray(cmds) && !game.over) driver.queue(cmds); }).catch(() => {});
      return;
    }
    const cmds = input.tick(snap);
`);
rep("driver.on('end', (result) => { game.over = true; showResult(els, result, side);", "driver.on('end', (result) => {\n    game.over = true;\n    if (watch) { showWatchEnd(els, result, seed, q); return; }\n    showResult(els, result, side);");
rep("sounds.play([{ name: stingerFor(result, side) }]); });", "sounds.play([{ name: stingerFor(result, side) }]);\n  });");
rep("lock: q.get('lock') !== 'off' });", "lock: !watch && q.get('lock') !== 'off' });");
rep("      rig.update(dt);\n      applyCamera();", "      if (watch) glide(rig, caster.pick(state.tick), dt); else rig.update(dt);\n      applyCamera();");
rep("      if (hudAcc > 0.1) { hudAcc = 0; updateHud(frame); }", "      if (hudAcc > 0.1) { hudAcc = 0; if (watch) els.top.innerHTML = watchBar(topbar.read(state), state.tick, tps, caster.pick(state.tick)); else updateHud(frame); }");
rep("  toast(els, 'Select your Workers and right-click a Shard to mine. F builds a Forge.');", "  if (watch) { root.classList.add('watch'); toast(els, `Watching the AIs, seed ${seed}`); }\n  else toast(els, 'Select your Workers and right-click a Shard to mine. F builds a Forge.');");
rep("    alert: $('alert'),", "    top: $('top'), alert: $('alert'),");
s += `
// Watch mode ------------------------------------------------------------------------------------------------------
const WATCH_WHY = { fight: 'Battle', base: 'Base under attack', claim: 'Reach in play', drift: 'Drift' };
const WATCH_TEAM = ['#33e0ff', '#ff9a3b'];

function watchBar(v, tick, tps, look) {
  const side = (i) => {
    const t = v.sides[i];
    return \`<span class="ws" style="color:\${WATCH_TEAM[i]}"><b>\${i === 0 ? 'Cyan' : 'Orange'}</b> income \${t.income}/min · army \${t.army}\${v.total ? \` · Reaches \${t.reaches}/\${v.total}\` : ''}</span>\`;
  };
  const secs = Math.floor(tick / tps);
  return \`\${side(0)}<span class="wc">\${Math.floor(secs / 60)}:\${String(secs % 60).padStart(2, '0')}\${look ? \` · \${WATCH_WHY[look.why] ?? ''}\` : ''}</span>\${side(1)}\`;
}

// The next match starts RESTART_SECONDS after this one ends, on the next seed (a reload keeps every other query).
function showWatchEnd(els, result, seed, q) {
  const next = new URLSearchParams(q);
  next.set('mode', 'watch'); next.set('seed', String(nextSeed(seed)));
  const who = result.winner === null || result.winner === undefined ? 'Draw' : \`\${result.winner === 0 ? 'Cyan' : 'Orange'} wins\`;
  let left = RESTART_SECONDS;
  const paint = () => { els.result.hidden = false; els.result.innerHTML = \`<h1>\${who}</h1><p class="dim">Next match (seed \${nextSeed(seed)}) in \${left} s</p>\`; };
  paint();
  const timer = setInterval(() => { left -= 1; if (left <= 0) { clearInterval(timer); location.search = next.toString(); } else paint(); }, 1000);
}
`;
fs.writeFileSync(p, s);
