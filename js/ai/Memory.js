export function recordHeard(mem, pos, intensity, now) {
  mem.lastHeardPosition = { ...pos };
  mem.lastHeardTime = now;
  mem.lastHeardIntensity = intensity;
  mem.confidence = Math.min(1, intensity + 0.2);
  mem.searchRadius = 6 + intensity * 10;
}
