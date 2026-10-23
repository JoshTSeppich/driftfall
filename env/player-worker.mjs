// Sandboxed child-process wrapper around one player module (spec section 11).
//
// The referee forks this file with Node's permission model on (`--permission`, read access to this file and the
// player file only: no writes, no child processes, no worker threads, no addons) and an empty environment. It
// first sends `{ type: 'init', path, side, seed, stats }` over IPC.
// It loads the player module from `path`, calls `createPlayer({ side, seed, stats })` and then answers every
// `{ type: 'observe', tick, observation }` message with `{ type: 'commands', tick, commands }` or, when `act`
// throws (or returns something that cannot be sent back), `{ type: 'commands', tick, error }`.
//
// Nothing here measures time: the referee does that from the outside, so a player that spins forever is simply
// never answered and the referee terminates this thread.

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

const send = (msg) => process.send(msg);

async function load(workerData) {
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
    send({ type: 'commands', tick, error: describe(err) });
    return;
  }
  try {
    send({ type: 'commands', tick, commands });
  } catch (err) {
    // e.g. the commands hold a function or some other value that structured clone cannot carry
    send({ type: 'commands', tick, error: 'commands could not be sent: ' + describe(err) });
  }
}

// Serialise requests so a slow `act` from one tick can never interleave with the next one.
let chain = Promise.resolve();

process.on('message', (msg) => {
  if (!msg) return;
  if (msg.type === 'init') {
    load(msg).then(
      (name) => send({ type: 'ready', name }),
      (err) => send({ type: 'load-error', message: describe(err) }),
    );
  } else if (msg.type === 'observe') {
    chain = chain.then(() => answer(msg));
  }
});
process.on('disconnect', () => process.exit(0));
