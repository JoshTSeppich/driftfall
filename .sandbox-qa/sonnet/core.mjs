const ROOT = '/Users/joshuaseppich/dev/rts';
const live = await import(ROOT + '/env/live.mjs');
const ai = await import(ROOT + '/' + (process.argv[2] || 'players/sonnet/bot.mjs'));
const d = live.createLiveMatch({ seed: 7, human: 0, ai, difficulty: 'normal', tps: 24, now: () => 0, setTimer: () => 0, clearTimer: () => {} });
await d.ready();
for (let i = 0; i < 3000 && !d.state.result; i++) {
  await d.tick();
  const s = d.state;
  if (i % 40 === 0 || s.result) {
    const c = s.structures.find((x) => x.kind === 'core' && x.owner === 0);
    const mine = s.units.filter((u) => u.owner === 0).length;
    const en = s.units.filter((u) => u.owner === 1);
    console.log(s.tick, 'core0', c && c.hp, 'mine', mine, 'enemy', en.length, 'map', s.width, s.height, en[0] && [en[0].kind, en[0].x.toFixed(0), en[0].y.toFixed(0)].join(','), c && [c.x, c.y].join(','));
  }
}
console.log(JSON.stringify(d.state.result));
