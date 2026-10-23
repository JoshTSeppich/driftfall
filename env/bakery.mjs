// Driftfall — the Toaster-Wars kitchen (TERRITORY.md sections 17 and 18). Owner: sonnet. Pure and deterministic.
//
// Wheat (Shards, hauled by Crumbs) -> Mill -> flour; Well -> water; Toaster building: flour + water + power -> toast.
// Toast is the ammo (env/ammo.mjs): the toast stack IS the Power Strip's slice store. Three buildings, one chain, and
// every link is something the enemy can see and raid:
//   Mill      grinds wheatPerFlour Shards into one flour every millSeconds (while the pantry has room)
//   Well      draws one water every wellSeconds; it must stand within wellReach of water (the river), or the map has none
//   Toaster   needs power (a lit network within reach of the building); every toasterSeconds it turns 1 flour + 1 water
//             into slicesPerBake slices of toast
//   Strip     the pilot light: while the stack is under pilotFloor it bakes one slice every pilotSeconds by itself, so a
//             side that lost its kitchen can always crawl back (no softlock, COMBAT.md section 2)
//
//   enableBakery(state)    creates state.bakery (idempotent); needs enableToast + enableAmmo first
//   stepBakery(state)      once a tick, after stepPower
//   observeBakery(state, side) -> { flour, water, toast, mills, wells, toasters, dry: [...] } | null
//   BAKERY                 the numbers
import { STATS } from "./stats.mjs";
import { distance, emit } from "./state.mjs";
import { isToastOn } from "./toast.mjs";
import { addStock, stockOf, isAmmoOn } from "./ammo.mjs";

const tps = () => STATS.clock.ticksPerSecond;
const sec = (s) => Math.round(s * tps());

export const BAKERY = Object.freeze({
  wheatPerFlour: 10, // Shards ground into one flour
  millTicks: sec(8),
  wellTicks: sec(6),
  toasterTicks: sec(5),
  slicesPerBake: 2, // one flour + one water makes two slices of toast
  pantryCap: 6, // flour or water waiting for a Toaster, per side
  wellReach: 4, // a Well must stand this close to a water tile or a map spring
  springEvery: 2, // a spring well draws every second beat
  pilotTicks: sec(20),
  pilotFloor: 4,
  startStack: 8, // slices in the Power Strip's stack at tick 0
});

export function enableBakery(state, opts = {}) {
  if (!state.bakery) {
    state.bakery = { next: {}, pilotAt: [0, 0], water: state.waterSet || null, springs: state.springs || [] };
    if (isToastOn(state) && Number.isInteger(opts.startStack ?? BAKERY.startStack)) {
      state.toast.stack[0] = state.toast.stack[1] = opts.startStack ?? BAKERY.startStack;
    }
  }
  return state.bakery;
}

const pantryOf = (state, side) => state.toast.pantry[side];

// Where a Well stands decides its water (maps/WHEATFIELD.md): by the creek or river it is fast ('creek'), by a map spring
// tile (the home well) it is slow ('spring'), anywhere else it is dry (null). A map with no water at all lets a Well work
// anywhere, so the classic maps still play.
function waterAt(state, s) {
  const B = state.bakery;
  const hasWater = B.water && B.water.size > 0;
  const hasSprings = B.springs && B.springs.length > 0;
  if (!hasWater && !hasSprings) return "creek";
  const r = BAKERY.wellReach;
  if (hasWater) {
    for (let y = s.y - r; y <= s.y + r; y++) for (let x = s.x - r; x <= s.x + r; x++) if (B.water.has(`${x},${y}`)) return "creek";
  }
  if (hasSprings && B.springs.some(([x, y]) => Math.max(Math.abs(x - s.x), Math.abs(y - s.y)) <= r)) return "spring";
  return null;
}

// A building is powered when a lit power point of its owner covers it (the Strip, an Outlet, a box or a generator).
export function structurePowered(state, s) {
  const P = state.power;
  if (!P) return true;
  const view = P.view;
  if (!view) return true;
  return view.points.some((p) => p.owner === s.owner && distance(p, s) <= Math.max(p.range, 1) && (view.netOf.get(p.id)?.lit ?? false));
}

export function stepBakery(state) {
  const B = state.bakery;
  if (!B || !isToastOn(state) || !isAmmoOn(state)) return;
  const tick = state.tick;
  const due = (s, every) => {
    const at = B.next[s.id] ?? (B.next[s.id] = tick + every);
    if (tick < at) return false;
    B.next[s.id] = tick + every;
    return true;
  };
  for (const s of state.structures) {
    if (!s.complete || s.hp <= 0) continue;
    const pantry = pantryOf(state, s.owner);
    if (s.kind === "mill" && due(s, BAKERY.millTicks)) {
      if (pantry.flour < BAKERY.pantryCap && state.shards[s.owner] >= BAKERY.wheatPerFlour) {
        state.shards[s.owner] -= BAKERY.wheatPerFlour;
        pantry.flour += 1;
        emit(state, { e: "mill", player: s.owner, id: s.id, wheat: BAKERY.wheatPerFlour, flour: pantry.flour });
      }
    } else if (s.kind === "well" && due(s, BAKERY.wellTicks)) {
      const source = waterAt(state, s);
      s.dry = !source;
      s.spring = source === "spring";
      // A spring well is slow: it only draws on every second beat.
      s.beat = (s.beat || 0) + 1;
      if (source && (source === "creek" || s.beat % BAKERY.springEvery === 0) && pantry.water < BAKERY.pantryCap) {
        pantry.water += 1;
        emit(state, { e: "well", player: s.owner, id: s.id, water: pantry.water });
      }
    } else if (s.kind === "toaster" && due(s, BAKERY.toasterTicks)) {
      s.unpowered = !structurePowered(state, s);
      if (!s.unpowered && pantry.flour >= 1 && pantry.water >= 1) {
        pantry.flour -= 1;
        pantry.water -= 1;
        addStock(state, s.owner, BAKERY.slicesPerBake);
        emit(state, { e: "bake", player: s.owner, id: s.id, slices: BAKERY.slicesPerBake, stack: stockOf(state, s.owner) });
      }
    }
  }
  for (const side of [0, 1]) {
    const strip = state.structures.find((s) => s.kind === "core" && s.owner === side && s.hp > 0);
    if (!strip || tick < B.pilotAt[side]) continue;
    B.pilotAt[side] = tick + BAKERY.pilotTicks;
    if (stockOf(state, side) < BAKERY.pilotFloor) {
      addStock(state, side, 1);
      emit(state, { e: "bake", player: side, id: strip.id, slices: 1, stack: stockOf(state, side), pilot: true });
    }
  }
  for (const id of Object.keys(B.next)) if (!state.structures.some((s) => String(s.id) === id)) delete B.next[id];
}

export function observeBakery(state, side) {
  if (!state.bakery || !isToastOn(state)) return null;
  const mine = (kind) => state.structures.filter((s) => s.owner === side && s.kind === kind && s.complete);
  const p = pantryOf(state, side);
  return {
    flour: p.flour, water: p.water, toast: stockOf(state, side),
    mills: mine("mill").length, wells: mine("well").length, toasters: mine("toaster").length,
    dry: mine("well").filter((s) => s.dry).map((s) => s.id),
    unpowered: mine("toaster").filter((s) => s.unpowered).map((s) => s.id),
  };
}
