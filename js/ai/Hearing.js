import { SuspicionSystem } from './Suspicion.js';
import { recordHeard } from './Memory.js';
import { tileSeed, worldToTile } from '../core/WorldConfig.js';
import { sharedBlackboard } from './Blackboard.js';

// Per monster: events already reacted to (event id -> first-heard time).
const heardBy = new WeakMap();
const FORGET_AFTER = 6;

function firstTimeHeard(monster, ev, now) {
  let seen = heardBy.get(monster);
  if (!seen) {
    seen = new Map();
    heardBy.set(monster, seen);
  }
  for (const [k, t] of seen) {
    if (now - t > FORGET_AFTER) seen.delete(k);
  }
  const key = ev.id ?? ev;
  if (seen.has(key)) return false;
  seen.set(key, now);
  return true;
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = (a.y || 0) - (b.y || 0);
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function forestOcclusion(from, to) {
  let density = 0;
  const samples = 5;
  for (let i = 1; i <= samples; i++) {
    const t = i / (samples + 1);
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    const { tx, tz } = worldToTile(x, z);
    density += tileSeed(tx, tz, 7);
  }
  density /= samples;
  return Math.max(0.3, 1 - density * 0.55);
}

export function processHearing(monster, events, now, suspicion, weatherMul = 1) {
  const heard = [];
  for (const ev of events) {
    const dist = distance(monster.position, ev.position);
    if (dist > ev.radius) continue;
    const atten = Math.max(0, 1 - dist / ev.radius);
    const occ = forestOcclusion(ev.position, monster.position);
    const perceived = ev.intensity * atten * occ * weatherMul;
    if (perceived < 0.05) continue;

    heard.push(ev);

    if (!firstTimeHeard(monster, ev, now)) continue;
    suspicion.add(SuspicionSystem.intensityToSuspicion(perceived, atten * occ));
    recordHeard(monster.memory, ev.position, perceived, now);
    monster.memory.suspicion = suspicion.value;
    sharedBlackboard.reportHeard(monster.id || 'm0', ev.position, perceived, now);
  }

  const hint = sharedBlackboard.pollHint(monster.id || 'm0', now);
  if (hint && (!monster.memory.lastHeardTime || now - monster.memory.lastHeardTime > 1.5)) {
    if (hint.intensity > 0.08) {
      suspicion.add(hint.intensity * 12);
      if (!monster.memory.lastHeardPosition) {
        monster.memory.lastHeardPosition = { ...hint.position };
        monster.memory.lastHeardTime = now;
        monster.memory.lastHeardIntensity = hint.intensity;
      }
      monster.memory.suspicion = suspicion.value;
    }
  }
  return heard;
}
