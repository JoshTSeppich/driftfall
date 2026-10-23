// Motion numbers for the six Toastinators (TERRITORY.md section 16). Data only: the rig geometry lives in the creature
// specs. Keys are the Toastinator names; ALIASES maps them back to the snake names the brief used, for the old docs.
// Seconds and metres. Strike phases stay in the 80-200 ms band (ART-DIRECTION.md rule 5). Owner: sonnet.

export const MOTION_UNITS = {
  crumb: {
    role: 'worker', gait: 'hop', stride: 0.9, topSpeed: 2.2, hopHeight: 0.22,
    stiffness: 260, damping: 20, shards: 5, fallSeconds: 0.25,
    strike: { windup: 0.09, snap: 0.07, resolve: 0.14 },
    movingParts: ['body', 'slot-a', 'slot-b'],
  },
  popper: {
    role: 'grunt', gait: 'hop', stride: 0.8, topSpeed: 2.4, hopHeight: 0.26,
    stiffness: 240, damping: 16, shards: 5, fallSeconds: 0.25,
    strike: { windup: 0.09, snap: 0.07, resolve: 0.14 },
    movingParts: ['body', 'toast', 'feet'],
  },
  zapper: {
    role: 'lancer', gait: 'hop', stride: 0.85, topSpeed: 2.0, hopHeight: 0.2,
    stiffness: 220, damping: 18, shards: 6, fallSeconds: 0.3,
    strike: { windup: 0.12, snap: 0.07, resolve: 0.14 },
    movingParts: ['body', 'coil-a', 'coil-b', 'feet'],
  },
  'four-slice': {
    role: 'brute', gait: 'stomp', stride: 1.3, topSpeed: 1.4, hopHeight: 0.34,
    stiffness: 160, damping: 22, shards: 12, fallSeconds: 0.35,
    strike: { windup: 0.12, snap: 0.09, resolve: 0.2 },
    movingParts: ['body', 'slot-1', 'slot-2', 'slot-3', 'slot-4', 'feet'],
  },
  bagel: {
    role: 'dart', gait: 'roll', stride: 1.1, topSpeed: 3.2, hopHeight: 0,
    stiffness: 300, damping: 24, shards: 5, fallSeconds: 0.2,
    strike: { windup: 0.08, snap: 0.07, resolve: 0.12 },
    movingParts: ['ring', 'hub', 'spokes'],
  },
  broiler: {
    role: 'howler', gait: 'stomp', stride: 1.0, topSpeed: 1.2, hopHeight: 0.18,
    stiffness: 150, damping: 20, shards: 8, fallSeconds: 0.3,
    strike: { windup: 0.14, snap: 0.09, resolve: 0.18 },
    movingParts: ['box', 'door', 'legs', 'dial'],
  },
};

export const UNIT_KEYS = Object.freeze(Object.keys(MOTION_UNITS));

export const ALIASES = Object.freeze({
  crumb: 'Siphoner',
  popper: 'Fang',
  zapper: 'Spitter',
  'four-slice': 'Constrictor',
  bagel: 'Hisser',
  broiler: 'Boomslang',
});
