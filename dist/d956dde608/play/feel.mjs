// Feel for the play client (owner: haiku). Which sounds a tick makes, and a small hit flash and camera shake.
// Pure: time comes in as `now` (ms) and nothing uses Math.random, so the same match always feels the same.
// The sound names must exist in assets/audio/MANIFEST.json (play/feel.test.mjs checks that).
import { chooseSounds, limitSounds, makeLookup } from '../viewer3d/audio.mjs';

export const FLASH_MS = 160;      // a hit ring lasts this long
export const SHAKE_MS = 200;      // a camera shake settles in this long
export const SHAKE_TILES = 0.15;  // the biggest shake, in tiles (about 4 px on screen)
export const SHAKE_RANGE = 10;    // a fight this close to the camera shakes it
export const AUDIBLE_RANGE = 12;  // enemy sounds only play this close to the camera (ours always play)
const PRICE_MOVE = 0.02;          // a price must move 2% to make a sound

const dist = (pos, focus) => (focus ? Math.hypot(pos.x - focus.x, pos.y - focus.y) : undefined);

// Our things always make sound; other sides' only when they are close enough to the camera to see.
function audible(pos, side, focus) {
  if (pos.owner === side) return true;
  const d = dist(pos, focus);
  return d === undefined || d <= AUDIBLE_RANGE;
}

// Sound cues for one tick's sim events. `lookup(id)` finds an entity by id (see makeLookup), `focus` is the camera.
export function cuesForTick(events, lookup, side, focus) {
  const cues = [];
  for (const ev of events || []) {
    if (ev.e === 'drift-announce') cues.push({ name: 'drift_warning', kind: 'alert' });
  }
  for (const c of chooseSounds(events, lookup)) {
    if (c.name === 'building_finished' || c.name === 'building_placed' || c.name === 'alert_under_attack') {
      if (c.pos.owner !== side) continue;
    }
    if (!audible(c.pos, side, focus)) continue;
    cues.push({ name: c.name, kind: c.kind, dist: dist(c.pos, focus) });
  }
  return cues;
}

// Price sounds from two snapshots of { resource: price }. Only the net direction makes a sound, once per tick.
export function priceCues(prev, next, move = PRICE_MOVE) {
  if (!prev || !next) return [];
  let up = 0;
  let down = 0;
  for (const key of Object.keys(next)) {
    const before = prev[key];
    if (!(before > 0) || !(next[key] >= 0)) continue;
    const rel = (next[key] - before) / before;
    if (rel >= move) up += 1;
    else if (rel <= -move) down += 1;
  }
  if (up > down) return [{ name: 'price_up', kind: 'blip' }];
  if (down > up) return [{ name: 'price_down', kind: 'blip' }];
  return [];
}

// True when the picked units are not empty and differ from the last picked key (ids joined by commas).
export function selectionChanged(prevKey, ids) {
  return ids.length > 0 && ids.join(',') !== prevKey;
}

// The feedback loop for the play client. Call tick() once per sim tick; flashes(now) and shake(now) are read each frame.
// `player` is anything with play(list) (play/sound-player.mjs). Sounds are capped per tick by limitSounds.
export function createFeedback({ player = null, side = 0 } = {}) {
  let prev = null;
  let selKey = '';
  let prices = null;
  let flashList = [];
  let shakeList = [];

  function feel(events, lookup, focus, now) {
    for (const ev of events || []) {
      if (ev.e !== 'hit' && ev.e !== 'die') continue;
      const target = ev.e === 'hit' ? lookup(ev.id) : (lookup(ev.id) || ev.entity || null);
      if (!target || !audible(target, side, focus)) continue;
      flashList.push({ x: target.x, y: target.y, t: now, big: ev.e === 'die' });
      const d = dist(target, focus);
      if (d === undefined || d <= SHAKE_RANGE) shakeList.push({ t: now, strength: ev.e === 'die' ? 1 : 0.6 });
    }
  }

  return {
    // events: the sim's raw events for this tick. snap: the observed state. focus: { x, y } in tiles, the camera.
    // selection: picked unit ids. commands: orders the player sent this tick. prices: optional { resource: price }.
    tick({ events = [], snap, focus = null, now = 0, selection = [], commands = [], prices: nextPrices = null }) {
      const lookup = makeLookup(prev, snap);
      prev = snap;
      const cues = cuesForTick(events, lookup, side, focus);
      if (commands.length) cues.push({ name: 'unit_move_ack', kind: 'blip' });
      if (selectionChanged(selKey, selection)) cues.push({ name: 'unit_select', kind: 'blip' });
      selKey = selection.join(',');
      cues.push(...priceCues(prices, nextPrices));
      if (nextPrices) prices = nextPrices;
      if (player) player.play(limitSounds(cues, { perName: 2, max: 8 }));
      feel(events, lookup, focus, now);
      return cues;
    },

    // Rings still on screen at `now`: { x, y, age (0..1), big }.
    flashes(now) {
      flashList = flashList.filter((f) => now - f.t < FLASH_MS);
      return flashList.filter((f) => now >= f.t).map((f) => ({ x: f.x, y: f.y, age: (now - f.t) / FLASH_MS, big: f.big }));
    },

    // The camera offset in tiles at `now`. It is the strongest shake still running, eased out, and {0, 0} when none.
    shake(now) {
      shakeList = shakeList.filter((s) => now - s.t < SHAKE_MS);
      let best = null;
      for (const s of shakeList) {
        if (now < s.t) continue;
        const age = (now - s.t) / SHAKE_MS;
        const amp = s.strength * (1 - age) * (1 - age);
        if (!best || amp > best.amp) best = { amp, age };
      }
      if (!best) return { x: 0, y: 0 };
      return {
        x: SHAKE_TILES * best.amp * Math.sin(best.age * 31.4),
        y: SHAKE_TILES * best.amp * Math.cos(best.age * 23.7),
      };
    },
  };
}
