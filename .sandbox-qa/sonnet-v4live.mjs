process.env.DRIFTFALL_MAP = 'v4';
const { createLiveMatch } = await import('../env/live.mjs');
const { createTerritoryMatch } = await import('../env/sim-territory.mjs');
const d = createLiveMatch({ seed: 7, human: 0, ai: { name: 'x', act: () => [] }, maxTicks: 100 });
console.log('live territory?', !!d.state.territory, d.state.width, d.state.height);
try { const t = createTerritoryMatch(7); console.log('territory match', !!t.territory, t.width, t.height, t.territory.map.reaches?.length); } catch (e) { console.log('ERR', e.message); }
