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


## 3D Model Credits

- **Horror Skunx Retexterd Siren Head [UPDATED]** by [Horror BigGameRR Green Screens](https://sketchfab.com/HorrorBigGameRR) — [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) — [Sketchfab](https://sketchfab.com/3d-models/horror-skunx-retexterd-siren-head-updated-bf94583b404349d8bfcd12010ef3522e)
- **The Boiled One: Horror Game - Boiled One** by [MG Rips](https://sketchfab.com/MG_GameRips) — [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/) — [Sketchfab](https://sketchfab.com/3d-models/the-boiled-one-horror-game-boiled-one-64ce66c413fe4e5e92a48e8e02a83590)

**Important:** Boiled One is **non-commercial**. Do not monetize (ads, paid donations, sales) while this model is in the game. Siren Head is a character by Trevor Henderson; Sketchfab CC does not remove character-IP risk. Prefer clearly original assets for a public/commercial release.
