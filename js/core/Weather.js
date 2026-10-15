/** Weather table + gradual transitions + lightning. */
export const WEATHER = {
  clear: { vis: 1.0, snd: 1.0, speed: 1.0, label: '' },
  rain:  { vis: 0.8, snd: 0.7, speed: 0.95, label: 'HUJAN' },
  fog:   { vis: 0.45, snd: 0.9, speed: 1.0, fogMul: 2.2, label: 'KABUT' },
  storm: { vis: 0.65, snd: 0.55, speed: 0.9, lightning: true, label: 'BADAI' },
};

const NEXT = {
  clear: ['rain', 'fog'],
  rain: ['clear', 'storm'],
  fog: ['clear', 'rain'],
  storm: ['rain'],
};

export function pickNextWeather(current) {
  const opts = NEXT[current] || ['clear'];
  return opts[Math.floor(Math.random() * opts.length)];
}

export function weatherMul(w) {
  return Math.max(0.6, WEATHER[w]?.snd ?? 1);
}

export function weatherVis(w) {
  return WEATHER[w]?.vis ?? 1;
}

export function weatherSpeed(w) {
  return WEATHER[w]?.speed ?? 1;
}

/**
 * Call each frame from host/solo authority.
 * Returns { flashed: boolean, hearingMask: number } for lightning side-effects.
 */
export class WeatherController {
  constructor() {
    this.hearingMaskUntil = 0;
    this._flashUntil = 0;
  }

  update(dt, now, world, renderer, audio) {
    world.weatherTimer = (world.weatherTimer || 0) + dt;
    if (world.weatherTimer >= (world.weatherNextChange || 50)) {
      world.weatherTimer = 0;
      world.weatherNextChange = 40 + Math.random() * 40;
      world.weather = pickNextWeather(world.weather || 'clear');
    }

    const W = WEATHER[world.weather] || WEATHER.clear;
    let flashed = false;

    // Lightning
    if (W.lightning && Math.random() < dt / 18) {
      flashed = true;
      this._flashUntil = now + 0.09;
      this.hearingMaskUntil = now + 3;
      if (renderer?.flashSky) renderer.flashSky(90);
      // brief white overlay
      const el = document.getElementById('lightning-flash');
      if (el) {
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 90);
      }
    }

    // Apply rain particles for rain/storm
    const raining = world.weather === 'rain' || world.weather === 'storm';
    if (renderer?.setRain) renderer.setRain(raining);
    if (audio?.setRain) audio.setRain(raining);

    // Fog multiplier
    if (renderer?.scene?.fog && W.fogMul) {
      // applied relative in lighting pass; stash for consumer
      world._fogMul = W.fogMul;
    } else {
      world._fogMul = 1;
    }

    const label = document.getElementById('weather-label');
    if (label) label.textContent = W.label || '';

    return {
      flashed,
      hearingMask: now < this.hearingMaskUntil ? 0.4 : 1,
      mods: W,
    };
  }
}
