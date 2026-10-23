// Cord power, as the player sees it (TERRITORY.md section 20). Owner: sonnet. Pure: no DOM, no canvas.
//
//   powerView(state, side, selection) -> { cords, glows, rings, sparks, dark }
//     cords:  faint charcoal lines from each of your plugged units to its anchor; bright when the unit is selected
//     glows:  your power points with their reach and whether the network is lit (the soft ground glow)
//     rings:  pentagon cord-limit rings for selected plugged units (vertices in tiles)
//     sparks: cut cords still visible (where the raider stood), age 0..1
//     dark:   your battery and powered-down units (red blink on battery, dark eyes on down)
//   drawPowerOverlay(ov, state, side, selection, project, tp) lives in play/territory-wire.mjs.
import { POWER, buildLines, lineKey } from '../env/power.mjs';

const TAU_STEP = (2 * Math.PI) / 5;

/** The five vertices of a pentagon of circumradius r around (x, y), in tiles. */
export function pentagon(x, y, r) {
  const pts = [];
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + k * TAU_STEP;
    pts.push({ x: x + r * Math.cos(a), y: y + r * Math.sin(a) });
  }
  return pts;
}

export function powerView(state, side, selection = []) {
  const out = { cords: [], glows: [], rings: [], sparks: [], dark: [] };
  const P = state.power;
  if (!P) return out;
  const view = P.view;
  const points = view ? view.points : [];
  const netOf = view ? view.netOf : new Map();
  const picked = new Set(selection);

  for (const p of points) {
    if (p.owner !== side || p.range <= 0) continue;
    const net = netOf.get(p.id);
    out.glows.push({ id: p.id, x: p.x, y: p.y, range: p.range, kind: p.kind, lit: !!(net && net.lit) });
  }

  for (const u of state.units) {
    if (u.owner !== side || u.hp <= 0 || !u.power) continue;
    const st = u.power;
    if (st.state === 'plugged') {
      const anchor = points.find((p) => p.id === st.anchor);
      if (!anchor) continue;
      const bright = picked.has(u.id) || !!u.order; // selected, or taking a move order: the cord lights up
      out.cords.push({ id: u.id, x0: u.x, y0: u.y, x1: anchor.x, y1: anchor.y, bright });
      if (bright) out.rings.push({ id: u.id, vertices: pentagon(u.x, u.y, POWER.cord[u.kind] ?? 8) });
    } else {
      out.dark.push({ id: u.id, x: u.x, y: u.y, state: st.state });
    }
  }

  for (const c of P.cuts || []) {
    const age = Math.min(1, (state.tick - c.tick) / POWER.sparkTicks);
    out.sparks.push({ id: c.id, x: c.x, y: c.y, age });
  }
  return out;
}

// Stations, fences and pegs (POWER-NETWORK.md sections 9 and 11, step 5). Pure data for the overlay to draw:
//   posts:    every station of both sides { id, owner, kind, x, y, lit, tall } (low charcoal posts; pylons are tall)
//   wires:    ground fences of both sides { owner, from, to, state: 'live' | 'dark' } (thick glowing rail / dim rail)
//   overhead: high lines { owner, from, to } (thin dashed beam over the ground, never a wall, with a ground shadow)
//   fenced:   tile keys "x,y" of your fenced land (team-tint pentagon pattern)
//   pegs:     the corners your plugged cords bend round { id, x, y } (peg dots), at most 3 per cord
export function fenceView(state, side) {
  const out = { posts: [], wires: [], overhead: [], fenced: [], pegs: [] };
  const P = state.power;
  if (!P) return out;
  const graph = buildLines(state);
  for (const s of graph.stations) out.posts.push({ id: s.id, owner: s.owner, kind: s.kind, x: s.x, y: s.y, lit: graph.lit.has(s.id), tall: s.kind === 'pylon' });
  const on = P.fenceLinks || new Set();
  for (const l of graph.lines) {
    if (l.type === 'high') out.overhead.push({ owner: l.owner, from: { x: l.a.x, y: l.a.y }, to: { x: l.b.x, y: l.b.y } });
    else if (on.has(lineKey(l.a.id, l.b.id))) {
      out.wires.push({ owner: l.owner, from: { x: l.a.x, y: l.a.y }, to: { x: l.b.x, y: l.b.y }, state: graph.lit.has(l.a.id) ? 'live' : 'dark' });
    }
  }
  const fenced = P.enclosure && P.enclosure.fenced[side];
  if (fenced) out.fenced = [...fenced].sort();
  for (const u of state.units) {
    if (u.owner !== side || u.hp <= 0 || !u.power || !u.power.cord) continue;
    for (const p of u.power.cord.pts.slice(1)) out.pegs.push({ id: u.id, x: p.x, y: p.y });
  }
  return out;
}
