const h = new Map();
export const bus = {
  on(e, f) {
    (h.get(e) || h.set(e, new Set()).get(e)).add(f);
    return () => h.get(e)?.delete(f);
  },
  emit(e, d) {
    h.get(e)?.forEach((f) => {
      try {
        f(d);
      } catch (err) {
        console.warn('bus', e, err);
      }
    });
  },
  clear() {
    h.clear();
  },
};
