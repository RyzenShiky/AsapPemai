# LONGWAY

3D multiplayer horror game in the browser (Three.js + Firebase).

## Features
- 4 night-only monsters (shadow, smily, boiled, siren)
- Roads, street lamps (deterministic, no network sync)
- Multiplayer up to 6 players, shared clock (`t0`)
- Pickups, vehicles, hide spots, weather (rain/fog/storm)

## Auth
Anonymous auth is **required** for multiplayer (rules gate on `auth.uid`).
Enable Anonymous + Google in Firebase Console → Authentication.
Add your hosting domain under Authorized domains.

## Deploy rules
```bash
firebase deploy --only database
firebase deploy --only storage
# CORS for billboard media:
gsutil cors set cors.json gs://longway-284bd.firebasestorage.app
```

## Night test shortcut
Open with `?t=0.78` to jump into night (host sets `t0` offset).

## Cache
`vercel.json` sets `no-cache` on JS/CSS/HTML so modules stay in sync after deploy.

## Assets
Prefer compressed GLBs (meshopt + webp). `monster.glb` removed (unused).
