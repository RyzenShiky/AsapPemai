export const ITEMS = {
  battery: { stack: 5, use: (p) => { p.battery = Math.min(100, (p.battery ?? 100) + 40); } },
  medkit: { stack: 3, use: (p) => { p.health = Math.min(100, (p.health ?? 100) + 40); p.medkits = Math.max(0, (p.medkits || 1) - 1); } },
  water: { stack: 3, use: (p) => { p.thirst = Math.min(100, (p.thirst ?? 100) + 45); } },
  food: { stack: 3, use: (p) => { p.hunger = Math.min(100, (p.hunger ?? 100) + 40); } },
  fuel: { stack: 2, use: (p) => { p.lighterFuel = Math.min(100, (p.lighterFuel ?? 100) + 50); } },
  key: { stack: 5 },
  crowbar: { stack: 1 },
  radio: { stack: 1 },
  parcel: { stack: 1 },
  scrap: { stack: 20 },
  cloth: { stack: 10 },
};

export const MAX_WEIGHT = 12, MAX_SLOTS = 8;
const WEIGHT = {
  battery: 0.5, medkit: 1.5, water: 1, food: 0.8, fuel: 2.5, key: 0.1,
  crowbar: 3, radio: 1.2, parcel: 2, scrap: 0.5, cloth: 0.3,
};
export const weightOf = (t) => WEIGHT[t] ?? 1;
export const invWeight = (inv) => (inv?.items || []).reduce((s, i) => s + weightOf(i.type), 0);
export const canCarry = (inv, t) =>
  (inv?.items?.length || 0) < MAX_SLOTS && invWeight(inv) + weightOf(t) <= MAX_WEIGHT;

export const LOOT = {
  house: [['water', 3], ['food', 3], ['cloth', 2], ['battery', 2], ['scrap', 2], ['fuel', 1]],
  depot: [['fuel', 3], ['scrap', 3], ['battery', 2], ['medkit', 1], ['crowbar', 1], ['food', 1]],
};

export function rollLoot(table, seed) {
  const rows = LOOT[table] || LOOT.house;
  let s = (seed >>> 0) || 1;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 1) >>> 0) / 4294967296;
  const total = rows.reduce((a, r) => a + r[1], 0);
  const out = [];
  for (let i = 0, n = 2 + (rnd() < 0.35 ? 1 : 0); i < n; i++) {
    let r = rnd() * total;
    for (const [t, w] of rows) {
      if ((r -= w) < 0) { out.push(t); break; }
    }
  }
  return out;
}

export const RECIPES = {
  medkit: { in: { cloth: 2, water: 1 }, time: 5 },
  fuel: { in: { scrap: 3 }, time: 4 },
};
export function canCraft(inv, r, id) {
  const cnt = (t) => inv.items.filter((i) => i.type === t).length;
  const inW = Object.entries(r.in).reduce((s, [t, n]) => s + weightOf(t) * n, 0);
  return Object.entries(r.in).every(([t, n]) => cnt(t) >= n)
    && invWeight(inv) - inW + weightOf(id) <= MAX_WEIGHT;
}

export const SHOP = {
  pos: { x: -30, z: -12 },
  stock: { water: [8, 5], food: [10, 5], fuel: [25, 2], cloth: [6, 4] },
  sell: 0.5,
};
export const sellPrice = (t) => Math.floor((SHOP.stock[t]?.[0] ?? 4) * SHOP.sell);

/** Hide-spot quality for inspectSpot. */
export const SPOTS = { locker: 0.7, bed: 0.5, bush: 0.35, room: 0.4 };

export const NO_SELL = new Set(['key', 'parcel', 'radio']);
export const countOf = (inv, t) => (inv?.items || []).reduce((n, i) => n + (i.type === t ? 1 : 0), 0);

export function addItem(p, inv, type, force = false) {
  if (!ITEMS[type] || (!force && !canCarry(inv, type))) return false;
  inv.items.push({ type });
  if (type === 'medkit') p.medkits = (p.medkits || 0) + 1;
  return true;
}

export function removeItems(p, inv, type, n = 1) {
  let left = n;
  for (let i = inv.items.length - 1; i >= 0 && left > 0; i--) {
    if (inv.items[i].type !== type) continue;
    inv.items.splice(i, 1);
    left--;
    if (type === 'medkit') p.medkits = Math.max(0, (p.medkits || 0) - 1);
  }
  return n - left;
}
