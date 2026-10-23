// Match log (spec section 12). Pure data helpers: no clock, no randomness.

const EVENT_FIELDS = {
  spawn: [],
  move: ['id', 'x', 'y'],
  hit: ['id', 'by', 'dmg', 'hp'],
  die: ['id'],
  mine: ['id', 'x', 'y', 'amount', 'left'],
  deliver: ['id', 'amount', 'shards'],
  spend: ['player', 'amount', 'shards'],
  progress: ['id', 'progress', 'hp'],
  done: ['id'],
  queue: ['id', 'queue'],
  order: ['id', 'order'],
  blocked: ['id'],
  reject: ['player', 'command', 'reason'],
  late: ['player'],
  error: ['player', 'message'],
  forfeit: ['player', 'reason'],
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function createLog({ seed, players, stats, initial }) {
  return {
    format: 'driftfall-log',
    version: 1,
    seed,
    players: [players?.[0], players?.[1]],
    stats,
    initial,
    ticks: [],
    result: null,
    timing: [],
  };
}

export function appendTick(log, { tick, commands, events }, timing) {
  log.ticks.push({
    tick,
    commands: [commands?.[0] ?? [], commands?.[1] ?? []],
    events: events ?? [],
  });
  log.timing.push([timing?.[0] ?? 0, timing?.[1] ?? 0]);
  return log;
}

export function finishLog(log, result) {
  log.result = result;
  return log;
}

export function comparable(log) {
  const copy = { ...log };
  delete copy.timing;
  return copy;
}

function checkEvent(ev, where, problems) {
  if (!isObj(ev)) {
    problems.push(`${where} is not an object.`);
    return;
  }
  if (typeof ev.e !== 'string') {
    problems.push(`${where} has no event name (e).`);
    return;
  }
  const fields = EVENT_FIELDS[ev.e];
  if (!fields) {
    problems.push(`${where} has an unknown event kind "${ev.e}".`);
    return;
  }
  if (ev.e === 'spawn') {
    if (!isObj(ev.unit) && !isObj(ev.structure)) {
      problems.push(`${where} (spawn) needs a unit or a structure record.`);
    }
    return;
  }
  for (const f of fields) {
    if (!(f in ev)) problems.push(`${where} (${ev.e}) is missing "${f}".`);
  }
}

export function validateLog(log) {
  const problems = [];
  if (!isObj(log)) return ['The log is not an object.'];

  if (log.format !== 'driftfall-log') problems.push('The format must be "driftfall-log".');
  if (log.version !== 1) problems.push('The version must be 1.');
  if (!('seed' in log) || log.seed === undefined || log.seed === null) problems.push('The seed is missing.');
  if (!Array.isArray(log.players) || log.players.length !== 2 || !log.players.every((p) => typeof p === 'string')) {
    problems.push('Players must be a list of two names.');
  }
  if (!isObj(log.stats)) problems.push('The stats table is missing.');
  if (!isObj(log.initial)) problems.push('The initial state is missing.');
  else {
    for (const k of ['width', 'height', 'rocks', 'crystals', 'shards', 'units', 'structures']) {
      if (!(k in log.initial)) problems.push(`The initial state is missing "${k}".`);
    }
  }

  const ticksOk = Array.isArray(log.ticks);
  if (!ticksOk) problems.push('Ticks must be a list.');
  else {
    let prev = null;
    log.ticks.forEach((t, i) => {
      const where = `Tick entry ${i}`;
      if (!isObj(t)) {
        problems.push(`${where} is not an object.`);
        return;
      }
      if (!isInt(t.tick)) problems.push(`${where} has no whole-number tick.`);
      else {
        if (prev !== null && t.tick !== prev + 1) {
          problems.push(`${where} has tick ${t.tick} but the one before was ${prev}; ticks must count up by one.`);
        }
        prev = t.tick;
      }
      if (!Array.isArray(t.commands) || t.commands.length !== 2 || !t.commands.every(Array.isArray)) {
        problems.push(`${where} must have commands as two lists, one per side.`);
      }
      if (!Array.isArray(t.events)) problems.push(`${where} must have an events list.`);
      else t.events.forEach((ev, j) => checkEvent(ev, `${where} event ${j}`, problems));
    });
  }

  if (!Array.isArray(log.timing)) problems.push('Timing must be a top-level list.');
  else {
    if (ticksOk && log.timing.length !== log.ticks.length) {
      problems.push(`Timing has ${log.timing.length} entries but there are ${log.ticks.length} ticks.`);
    }
    log.timing.forEach((p, i) => {
      if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => isNum(n) && n >= 0)) {
        problems.push(`Timing entry ${i} must be a pair of non-negative numbers.`);
      }
    });
  }

  const r = log.result;
  if (r === null || r === undefined) problems.push('The log has no result (it was not finished).');
  else if (!isObj(r)) problems.push('The result is not an object.');
  else {
    if (!(r.winner === 0 || r.winner === 1 || r.winner === null)) problems.push('Result winner must be 0, 1 or null.');
    if (typeof r.reason !== 'string' || !r.reason) problems.push('Result needs a reason.');
    if (!isInt(r.tick)) problems.push('Result needs a whole-number tick.');
    if (!Array.isArray(r.value) || r.value.length !== 2 || !r.value.every(isNum)) {
      problems.push('Result value must be a pair of numbers.');
    }
  }

  return problems;
}
