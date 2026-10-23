// The Drift banner and countdown (TERRITORY.md section 4). Pure helpers over the schedule from env/drift.mjs.
// Owner: haiku (Classic play UI). The app mounts the strings; minimap pins come from driftMarkers.
// Times are whole seconds: the banner counts down from 30 s and never shows 0 before the event lands.

export const TPS = 24;
export const BANNER_TICKS = 5 * TPS; // a landed event stays on the banner for 5 s

export const DRIFT_LABEL = Object.freeze({
  bloom: 'Bloom', 'dry-out': 'Dry-out', flood: 'Flood', quake: 'Quake', squall: 'Squall', fall: 'The Fall',
});

const ROLE_NAME = Object.freeze({
  main: 'Main', natural: 'Natural', flank: 'Flank', mesa: 'Mesa', pocket: 'Pocket', rich: 'Rich Reach',
  vent: 'Vent Reach', outer: 'Outer Reach', centre: 'Centre',
});

/** Where an event lands, from the viewer's side: "your Natural", "their Mesa", "the Centre". */
export function describeTarget(t, side) {
  if (!t) return '';
  if (t.side === 'centre') return 'the Centre';
  const name = ROLE_NAME[t.role] ?? String(t.role);
  return `${t.side === side ? 'your' : 'their'} ${name}`;
}

// Where an event lands, all targets joined: "their Natural and your Mesa".
const where = (ev, side) => ev.targets.map((t) => describeTarget(t, side)).join(' and ');

/**
 * The banner to show at `tick`, or null. An incoming event (announced, not yet landed) wins; the earliest one shows.
 * Otherwise a landed event shows for BANNER_TICKS. { phase: 'incoming'|'now', kind, id, tick, title, secondsLeft }.
 */
export function driftBanner(events, tick, side) {
  const incoming = events
    .filter((ev) => tick >= ev.announceTick && tick < ev.tick)
    .sort((a, b) => a.tick - b.tick)[0];
  if (incoming) {
    const secondsLeft = Math.ceil((incoming.tick - tick) / TPS);
    const title = `${DRIFT_LABEL[incoming.kind]} in ${secondsLeft} s${incoming.targets.length ? `: ${where(incoming, side)}` : ''}`;
    return { phase: 'incoming', kind: incoming.kind, id: incoming.id, tick: incoming.tick, title, secondsLeft };
  }
  const landed = events
    .filter((ev) => tick >= ev.tick && tick < ev.tick + BANNER_TICKS)
    .sort((a, b) => b.tick - a.tick)[0];
  if (landed) {
    const title = `${DRIFT_LABEL[landed.kind]}${landed.targets.length ? `: ${where(landed, side)}` : ''}`;
    return { phase: 'now', kind: landed.kind, id: landed.id, tick: landed.tick, title, secondsLeft: null };
  }
  return null;
}

/**
 * Timed events in force (Floods and Squalls), each with whole seconds left. Untimed events (Blooms, Quakes, Falls)
 * are not listed.
 */
export function activeCountdowns(events, tick, side) {
  return events
    .filter((ev) => ev.expireTick !== null && tick >= ev.tick && tick < ev.expireTick)
    .map((ev) => ({
      id: ev.id,
      kind: ev.kind,
      label: DRIFT_LABEL[ev.kind],
      where: ev.targets.length ? where(ev, side) : '',
      secondsLeft: Math.ceil((ev.expireTick - tick) / TPS),
    }));
}

/**
 * Minimap pins for targeted events that are incoming (announced) or landed in the last BANNER_TICKS.
 * `locate(target)` gives {x, y} in tiles for a (side, role, index) target, or null when the map cannot place it.
 * Squalls have no target pin: their band is drawn from squallBand() in env/drift.mjs.
 */
export function driftMarkers(events, tick, locate) {
  const out = [];
  for (const ev of events) {
    const live = (tick >= ev.announceTick && tick < ev.tick) || (tick >= ev.tick && tick < ev.tick + BANNER_TICKS);
    if (!live || !ev.targets.length) continue;
    for (const t of ev.targets) {
      const p = locate(t);
      if (p) out.push({ id: ev.id, kind: ev.kind, x: p.x, y: p.y });
    }
  }
  return out;
}
