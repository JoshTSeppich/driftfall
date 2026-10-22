// Worker-thread wrapper around one player module (spec section 11).
//
// The referee starts this file with `new Worker(..., { workerData: { path, side, seed, stats } })`.
// It loads the player module from `path`, calls `createPlayer({ side, seed, stats })` and then answers every
// `{ type: 'observe', tick, observation }` message with `{ type: 'commands', tick, commands }` or, when `act`
// throws (or returns something that cannot be sent back), `{ type: 'commands', tick, error }`.
//
// Nothing here measures time: the referee does that from the outside, so a player that spins forever is simply
// never answered and the referee terminates this thread.

import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const describe = (err) => {
  if (err instanceof Error) return err.message || err.name || 'error';
  try {
    return String(err);
  } catch {
    return 'non-string error';
  }
};

let player = null;

async function load() {
  const { path: modulePath, side, seed, stats } = workerData;
  const url = path.isAbsolute(modulePath) ? pathToFileURL(modulePath).href : pathToFileURL(path.resolve(modulePath)).href;
  const mod = await import(url);
  if (typeof mod.createPlayer !== 'function') throw new Error('player module does not export createPlayer');
  const made = await mod.createPlayer({ side, seed, stats });
  if (!made || typeof made.act !== 'function') throw new Error('createPlayer did not return an object with an act function');
  player = made;
  const name = typeof made.name === 'string' && made.name.length ? made.name : path.basename(modulePath);
  return name;
}

async function answer(msg) {
  const { tick, observation } = msg;
  let commands;
  try {
    commands = await player.act(observation);
  } catch (err) {
    parentPort.postMessage({ type: 'commands', tick, error: describe(err) });
    return;
  }
  try {
    parentPort.postMessage({ type: 'commands', tick, commands });
  } catch (err) {
    // e.g. the commands hold a function or some other value that structured clone cannot carry
    parentPort.postMessage({ type: 'commands', tick, error: 'commands could not be sent: ' + describe(err) });
  }
}

// Serialise requests so a slow `act` from one tick can never interleave with the next one.
let chain = Promise.resolve();

parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'observe') return;
  chain = chain.then(() => answer(msg));
});

load().then(
  (name) => parentPort.postMessage({ type: 'ready', name }),
  (err) => parentPort.postMessage({ type: 'load-error', message: describe(err) }),
);
