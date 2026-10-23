// The flow panel (TERRITORY.md sections 8 and 9): Shards, Flux and Alloy per minute, upkeep, net and the bank.
// Owner: haiku (Classic play UI). Pure: plain numbers in, HTML out. The app passes income, upkeep and bank from
// env/budget.mjs once it is on; before that the numbers are zero and the panel still renders.
import { HEALTH } from '../viewer3d/palette.mjs';

export const WEARY_BELOW = -500; // env/budget.mjs: below this the army is weary (TERRITORY.md section 9)

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** A whole number with a sign on anything non-zero: +120, -40, 0. Ties and halves round away from zero. */
export function fmtSigned(n) {
  const r = Math.round(Math.abs(n)) * Math.sign(n);
  if (r === 0) return '0';
  return r > 0 ? `+${r}` : `${r}`;
}

/**
 * One row per resource: { key, label, income, upkeep, net, negative }. Flux and Alloy rows carry no upkeep
 * beyond what the flow gives; a net below zero is marked negative so the panel can show it red.
 */
export function flowRows({ income = {}, upkeep = {}, bank = 0 } = {}) {
  const row = (key, label) => {
    const inc = income[key] ?? 0;
    const up = upkeep[key] ?? 0;
    const net = inc - up;
    return { key, label, income: inc, upkeep: up, net, negative: net < 0 };
  };
  return [row('shards', 'Shards/min'), row('flux', 'Flux/min'), row('alloy', 'Alloy/min')];
}

/** The panel as HTML. `bank` is the Shards balance; below zero it reads as Debt in red. */
export function renderFlow(flow = {}) {
  const rows = flowRows(flow);
  const lines = rows.map((r) => `<div class="flow-row"><span class="k">${esc(r.label)}</span>`
    + `<span class="in">${fmtSigned(r.income)}</span>`
    + (r.upkeep ? `<span class="up">${fmtSigned(-r.upkeep)}</span>` : '')
    + `<b class="net${r.negative ? ' neg' : ''}"${r.negative ? ` style="color:${HEALTH.bad}"` : ''}>${fmtSigned(r.net)}</b></div>`);
  const bank = flow.bank ?? 0;
  const debt = bank < 0;
  const weary = bank < WEARY_BELOW;
  const bankLine = debt
    ? `<div class="bank debt" style="color:${HEALTH.bad}">Debt ${Math.round(bank)} S</div>`
    : `<div class="bank">${Math.round(bank)} S</div>`;
  return `<div class="flow">${lines.join('')}${bankLine}${weary ? '<div class="weary">Weary: units -25% attack speed</div>' : ''}</div>`;
}
