// Smoke: does the current sim run on the v4 map?
process.env.DRIFTFALL_MAP = 'v4';
const { createInitialState } = await import('../env/state.mjs');
const sim = await import('../env/sim.mjs');
const st = createInitialState(7);
console.log('size', st.width, 'rocks', st.rocks.length, 'crystals', st.crystals.length, 'units', st.units.length);
const t = performance.now();
for (let i = 0; i < 48; i++) sim.step(st, [[], []]);
console.log('48 ticks', (performance.now() - t).toFixed(1), 'ms', 'exports', Object.keys(sim).join(','));
