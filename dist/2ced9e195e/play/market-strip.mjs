// The Trading House price strip (TERRITORY.md section 12): one chip per tradable resource with its sell price and a
// trend arrow. Pure: sim state in, HTML out. Owner: sonnet (Playable Client). Read-only; trade buttons come later.
import { observeMarket } from '../env/market.mjs';

const ARROW = { 1: '▲', 0: '–', [-1]: '▼' };
const TREND = { 1: 'rising', 0: 'steady', [-1]: 'falling' };

export function marketStrip(state, side) {
  if (!state?.market) return '';
  const m = observeMarket(state, side);
  const chips = Object.entries(m.resources).map(([res, r]) =>
    `<span class="mk ${TREND[r.dir]}" title="${res}: sells for ${r.price.toFixed(1)} Shards, buys for ${r.buy.toFixed(1)}. You hold ${Math.floor(r.held)}.">`
    + `${res} <b>${r.price.toFixed(1)}</b> ${ARROW[r.dir]}</span>`).join('');
  const note = m.house ? '' : ' <i class="dim">Build a Trading House to trade.</i>';
  return `<div class="market"><b>Trading House</b>${note}<div class="chips">${chips}</div></div>`;
}
