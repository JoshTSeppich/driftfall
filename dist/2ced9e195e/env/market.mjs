// Market: the Trading House of TERRITORY.md section 12. Pure module, OFF until enableMarket(state) is called.
//
// Every number comes from STATS.market and STATS.resources. Shards are the currency and are never traded; the other
// seven resources (Flux, Alloy and the rare five) are bought and sold for Shards.
//
//   Scarcity   clamp(sqrt(target / (held + stock + 1)), scarcityMin, scarcityMax), held = both banks together.
//   Sell price base * scarcity, minus your own dip: each unit you sell takes ownSaleDip (1%) off YOUR price for the
//              next one, and every sold unit's dip fades linearly to nothing over dipRecoverSeconds (60 s).
//   Buy price  the undipped sell price plus buySpread (25%); you can only buy what sits in the market's stock.
//   Stock      units sold sit in state.market.stock and drain drainPerSecond (2%) each second. Moving a unit between a
//              bank and the stock keeps the total, so a trade itself moves only the seller's dip; the drain is what
//              makes a resource scarcer again.
//
// Shared contract (what other files call):
//   enableMarket(state)                     creates state.market (idempotent); needs enableChain for the banks
//   scarcity(state, res)  sellPrice(state, side, res)  buyPrice(state, res)   per-unit prices, no mutation
//   quoteSell(state, side, res, n) -> {shards, unit, after}     what selling n would pay, no mutation
//   sell(state, side, res, n) / buy(state, side, res, n) -> {ok, shards, ...} or {ok:false, reason}
//   marketCommand(state, side, {type:'sell'|'buy', resource, amount}) -> the same result
//   stepMarket(state)                       call once a tick: drains the stock and samples history each second
//   observeMarket(state, side) -> {house, resources:{res:{price, buy, dir, history, stock, held, scarcity}}}
// Reject reasons: bad-resource, not-tradable, bad-amount, no-house, short-bank, short-stock, short-shards,
// unknown-command, no-market.
import { STATS } from "./stats.mjs";
import { bankAmount, creditResource, RESOURCES } from "./economy.mjs";

export const MARKET_TPS = 24;
export const HISTORY_SECONDS = 120;
const DIR_LOOKBACK = 5;      // seconds back that the arrow compares against
const DIR_EPSILON = 0.01;    // a move under 1% shows no arrow
const PRICE_FLOOR = 0.1;     // your own dip never takes the price below a tenth

export const TRADABLE = Object.freeze(RESOURCES.filter((r) => STATS.resources[r] && STATS.resources[r].tradable !== false && !STATS.resources[r].currency));

const rules = () => STATS.market;

export function enableMarket(state) {
  if (!state.market) {
    const stock = {};
    const history = [{}, {}];
    for (const r of TRADABLE) { stock[r] = 0; history[0][r] = []; history[1][r] = []; }
    state.market = { stock, lots: [{}, {}], history };
    for (const r of TRADABLE) state.market.lots[0][r] = [], state.market.lots[1][r] = [];
  }
  return state.market;
}

function held(state, res) {
  return bankAmount(state, 0, res) + bankAmount(state, 1, res);
}

export function scarcity(state, res) {
  const m = rules();
  const target = STATS.resources[res].target;
  const total = held(state, res) + (state.market ? state.market.stock[res] || 0 : 0);
  return Math.min(m.scarcityMax, Math.max(m.scarcityMin, Math.sqrt(target / (total + 1))));
}

// The side's dip right now (a fraction), summed over its recent sales and faded by age.
function dipOf(state, side, res) {
  if (!state.market) return 0;
  const span = rules().dipRecoverSeconds * MARKET_TPS;
  let dip = 0;
  for (const lot of state.market.lots[side][res]) {
    const age = state.tick - lot.tick;
    if (age < span) dip += rules().ownSaleDip * lot.units * (1 - Math.max(0, age) / span);
  }
  return dip;
}

const unitPrice = (base, dip) => base * Math.max(PRICE_FLOOR, 1 - dip);

export function sellPrice(state, side, res) {
  return unitPrice(STATS.resources[res].basePrice * scarcity(state, res), dipOf(state, side, res));
}

export function buyPrice(state, res) {
  return STATS.resources[res].basePrice * scarcity(state, res) * (1 + rules().buySpread);
}

function check(state, side, res, n) {
  if (!state.market) return "no-market";
  if (typeof res !== "string" || !Object.hasOwn(STATS.resources, res)) return "bad-resource";
  if (!TRADABLE.includes(res)) return "not-tradable";
  if (!Number.isInteger(n) || n <= 0) return "bad-amount";
  if (!state.structures.some((s) => s.owner === side && s.kind === "house" && s.complete)) return "no-house";
  return null;
}

export function quoteSell(state, side, res, n) {
  const why = check(state, side, res, n);
  if (why) return { ok: false, reason: why };
  const base = STATS.resources[res].basePrice * scarcity(state, res);
  const dip0 = dipOf(state, side, res);
  let total = 0;
  for (let i = 0; i < n; i++) total += unitPrice(base, dip0 + rules().ownSaleDip * i);
  const shards = Math.floor(total);
  return { ok: true, shards, unit: n ? total / n : 0, after: unitPrice(base, dip0 + rules().ownSaleDip * n) };
}

export function sell(state, side, res, n) {
  const q = quoteSell(state, side, res, n);
  if (!q.ok) return q;
  if (bankAmount(state, side, res) < n) return { ok: false, reason: "short-bank" };
  if (!creditResource(state, side, res, -n)) return { ok: false, reason: "short-bank" };
  creditResource(state, side, "shards", q.shards);
  state.market.stock[res] += n;
  state.market.lots[side][res].push({ tick: state.tick, units: n });
  return { ok: true, shards: q.shards, units: n, resource: res };
}

export function buy(state, side, res, n) {
  const why = check(state, side, res, n);
  if (why) return { ok: false, reason: why };
  if (Math.floor(state.market.stock[res] + 1e-9) < n) return { ok: false, reason: "short-stock" };
  const cost = Math.ceil(buyPrice(state, res) * n);
  if (bankAmount(state, side, "shards") < cost) return { ok: false, reason: "short-shards" };
  creditResource(state, side, "shards", -cost);
  creditResource(state, side, res, n);
  state.market.stock[res] -= n;
  return { ok: true, shards: cost, units: n, resource: res };
}

export function marketCommand(state, side, cmd) {
  if (!cmd || (cmd.type !== "sell" && cmd.type !== "buy")) return { ok: false, reason: "unknown-command" };
  return (cmd.type === "sell" ? sell : buy)(state, side, cmd.resource, cmd.amount);
}

// Once per game tick. On each whole second: drain the stock, forget faded sales, sample both sides' sell prices.
export function stepMarket(state) {
  const mk = state.market;
  if (!mk || state.tick % MARKET_TPS !== 0 || state.tick === 0) return;
  const span = rules().dipRecoverSeconds * MARKET_TPS;
  for (const r of TRADABLE) {
    mk.stock[r] *= 1 - rules().drainPerSecond;
    if (mk.stock[r] < 1e-9) mk.stock[r] = 0;
    for (const side of [0, 1]) {
      mk.lots[side][r] = mk.lots[side][r].filter((lot) => state.tick - lot.tick < span);
      const h = mk.history[side][r];
      h.push(sellPrice(state, side, r));
      if (h.length > HISTORY_SECONDS) h.shift();
    }
  }
}

export function observeMarket(state, side) {
  const out = { house: false, resources: {} };
  if (!state.market) return out;
  out.house = state.structures.some((s) => s.owner === side && s.kind === "house" && s.complete);
  for (const r of TRADABLE) {
    const h = state.market.history[side][r];
    let dir = 0;
    if (h.length >= 2) {
      const then = h[Math.max(0, h.length - 1 - DIR_LOOKBACK)];
      const now = h[h.length - 1];
      if (now > then * (1 + DIR_EPSILON)) dir = 1;
      else if (now < then * (1 - DIR_EPSILON)) dir = -1;
    }
    out.resources[r] = {
      price: sellPrice(state, side, r),
      buy: buyPrice(state, r),
      dir,
      history: h.slice(),
      stock: state.market.stock[r],
      held: bankAmount(state, side, r),
      scarcity: scarcity(state, r),
    };
  }
  return out;
}
