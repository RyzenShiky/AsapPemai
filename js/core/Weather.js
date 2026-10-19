/** Tabel cuaca + transisi bertahap + petir. */
export const WEATHER = {
  clear:   { vis: 1.00, snd: 1.00, speed: 1.00, fogMul: 1.0, label: '' },
  cloudy:  { vis: 0.95, snd: 1.00, speed: 1.00, fogMul: 1.2, label: 'MENDUNG' },
  drizzle: { vis: 0.90, snd: 0.85, speed: 1.00, fogMul: 1.3, rain: true, label: 'GERIMIS' },
  rain:    { vis: 0.80, snd: 0.70, speed: 0.95, fogMul: 1.5, rain: true, label: 'HUJAN' },
  storm:   { vis: 0.65, snd: 0.55, speed: 0.90, fogMul: 1.8, rain: true, lightning: 18, label: 'BADAI' },
  thunder: { vis: 0.80, snd: 0.60, speed: 1.00, fogMul: 1.4, lightning: 26, label: 'PETIR KERING' },
  wind:    { vis: 0.95, snd: 0.50, speed: 0.95, fogMul: 1.0, label: 'ANGIN KENCANG' },
  mist:    { vis: 0.70, snd: 0.95, speed: 1.00, fogMul: 1.8, label: 'BERKABUT TIPIS' },
  fog:     { vis: 0.45, snd: 0.90, speed: 1.00, fogMul: 2.2, label: 'KABUT' },
  dense:   { vis: 0.28, snd: 0.80, speed: 0.95, fogMul: 3.2, label: 'KABUT TEBAL' },
};

const NEXT = {
  clear:   { cloudy: 3, mist: 2, wind: 2 },
  cloudy:  { clear: 3, drizzle: 3, mist: 2, wind: 1, thunder: 1 },
  drizzle: { cloudy: 2, rain: 3, clear: 1, mist: 1 },
  rain:    { drizzle: 3, storm: 2, cloudy: 2 },
  storm:   { rain: 3, thunder: 1, wind: 2 },
  thunder: { cloudy: 2, storm: 2, rain: 1 },
  wind:    { clear: 2, cloudy: 2, thunder: 1, storm: 1 },
  mist:    { fog: 3, clear: 2, cloudy: 1, drizzle: 1 },
  fog:     { dense: 2, mist: 2, clear: 1, drizzle: 1 },
  dense:   { fog: 4, mist: 1 },
};

const NIGHT_BIAS = { mist: 1.6, fog: 2, dense: 2, storm: 1.4, thunder: 1.4, clear: 0.6 };
const DURATION = { dense: [25, 45], storm: [30, 55], thunder: [25, 45], default: [40, 80] };

export function pickNextWeather(current, night = false) {
  const opts = Object.entries(NEXT[current] || { clear: 1 });
  const weights = opts.map(([k, w]) => w * (night ? NIGHT_BIAS[k] ?? 1 : 1));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < opts.length; i++) {
    r -= weights[i];
    if (r <= 0) return opts[i][0];
  }
  return opts[opts.length - 1][0];
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

export class WeatherController {
  constructor() {
    this.hearingMaskUntil = 0;
    this._flashUntil = 0;
  }

  update(dt, now, world, renderer, audio, { follow = false } = {}) {
    if (!follow) {
      world.weatherTimer = (world.weatherTimer || 0) + dt;
      if (world.weatherTimer >= (world.weatherNextChange || 50)) {
        const cur = world.weather || 'clear';
        world.weatherTimer = 0;
        world.weather = pickNextWeather(cur, (world.timeOfDay ?? 0) >= 0.42);
        const [lo, hi] = DURATION[world.weather] || DURATION.default;
        world.weatherNextChange = lo + Math.random() * (hi - lo);
      }
    }

    const W = WEATHER[world.weather] || WEATHER.clear;
    let flashed = false;

    if (W.lightning && Math.random() < dt / W.lightning) {
      flashed = true;
      this._flashUntil = now + 0.09;
      this.hearingMaskUntil = now + 3;
      if (renderer?.flashSky) renderer.flashSky(90);
      const el = document.getElementById('lightning-flash');
      if (el) {
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 90);
      }
    }

    const raining = !!W.rain;
    if (renderer?.setRain) renderer.setRain(raining);
    if (audio?.setRain) audio.setRain(raining);

    world._fogMul = renderer?.scene?.fog ? W.fogMul ?? 1 : 1;

    const label = document.getElementById('weather-label');
    if (label) label.textContent = W.label || '';

    return {
      flashed,
      hearingMask: now < this.hearingMaskUntil ? 0.4 : 1,
      mods: W,
    };
  }
}
