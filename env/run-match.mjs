#!/usr/bin/env node
// Command-line entry: run one match and write the log.
//
//   node env/run-match.mjs --seed 7 --p0 players/a.mjs --p1 players/b.mjs --out match.json
//
// Optional: --think MS (default from stats), --hard MS, --max-ticks N, --quiet (print only the result line).
// Exit code 0 when the match ran, 1 for a usage problem, 2 when the referee itself failed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { runMatch } from './referee.mjs';

const USAGE = 'usage: node env/run-match.mjs --seed N --p0 <player.mjs> --p1 <player.mjs> [--out match.json] [--think MS] [--hard MS] [--max-ticks N]';

export function parseArgs(argv) {
  const opts = { seed: 1, p0: null, p1: null, out: null, think: null, hard: null, maxTicks: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error('missing value after ' + arg);
      return argv[++i];
    };
    const num = (name) => {
      const n = Number(next());
      if (!Number.isFinite(n)) throw new Error(name + ' must be a number');
      return n;
    };
    switch (arg) {
      case '--seed':
        opts.seed = num('--seed');
        break;
      case '--p0':
        opts.p0 = next();
        break;
      case '--p1':
        opts.p1 = next();
        break;
      case '--out':
        opts.out = next();
        break;
      case '--think':
        opts.think = num('--think');
        break;
      case '--hard':
        opts.hard = num('--hard');
        break;
      case '--max-ticks':
        opts.maxTicks = num('--max-ticks');
        break;
      case '--quiet':
        opts.quiet = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        throw new Error('unknown argument ' + arg);
    }
  }
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    return 1;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  if (!opts.p0 || !opts.p1) {
    console.error('both --p0 and --p1 are required');
    console.error(USAGE);
    return 1;
  }

  const options = { seed: opts.seed, players: [path.resolve(opts.p0), path.resolve(opts.p1)] };
  if (opts.think !== null) options.thinkMs = opts.think;
  if (opts.hard !== null) options.hardMs = opts.hard;
  if (opts.maxTicks !== null) options.maxTicks = opts.maxTicks;

  const started = performance.now();
  const { log, result } = await runMatch(options);
  const elapsed = Math.round(performance.now() - started);

  if (opts.out) {
    const outPath = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(log) + '\n');
  }

  const who = result.winner === null ? 'draw' : `${log.players[result.winner]} (side ${result.winner}) wins`;
  if (!opts.quiet) {
    console.log(`${who} by ${result.reason} at tick ${result.tick}; value ${result.value[0]} vs ${result.value[1]}; ${elapsed} ms` + (opts.out ? `; log written to ${opts.out}` : ''));
  }
  console.log(JSON.stringify(result));
  return 0;
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error('run-match failed:', err && err.stack ? err.stack : err);
      process.exitCode = 2;
    },
  );
}
