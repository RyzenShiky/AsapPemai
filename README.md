# LONGWAY — HTML5 + CSS Modular + JS + Firebase Multiplayer

## Fixes in this build
1. **CHASE** — suspicion ≥ 70 + recent sound (or ≥ 90) enters CHASE
2. **Win/Lose** — monster attacks at close range; die at 0 HP; survive 5 min to escape
3. **Footsteps audible** — `playFootstep()` called with spatial HRTF
4. **Collision** — trees & rocks block player/monster; ground height matches terrain
5. **Continue** — localStorage save/load; Continue enabled when save exists
6. **2 monsters** — both patrol/hunt independently

## Multiplayer (host authority)
- Host runs `Monster.js` AI, writes `/rooms/{code}/monster`
- All clients write own `/players/{uid}`
- All clients listen & render
- Host migration if host disconnects (`onDisconnect`)

## Run
```bash
python -m http.server 8080
```

## Firebase Rules
Publish `database.rules.json` in Firebase Console → Realtime Database → Rules.

## Controls
WASD · Shift run · Ctrl/C crouch · click canvas for mouse
