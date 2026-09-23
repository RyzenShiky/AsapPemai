const KEY = 'longway_profile_v1';

export function loadProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* */ }
  return {
    uid: null,
    displayName: 'Guest_' + Math.random().toString(36).slice(2, 6).toUpperCase(),
    avatarColor: '#446688',
    provider: 'guest',
  };
}

export function saveProfile(p) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function ensureUid(profile) {
  if (!profile.uid) {
    profile.uid = 'g_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    saveProfile(profile);
  }
  return profile.uid;
}
