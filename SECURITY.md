# Security notes (LONGWAY)

## Deployed in this build
- RTDB: `pickChoice` / `pickAct` — only the owner may write their `$uid` child; host may wipe the parent to `null` (clearPick).
- RTDB billboard video URL must be under `longway-284bd.firebasestorage.app`.
- Storage path: `billboard/{room}/{uid}/{file}` — writer must match `uid`; JPEG/PNG/WebP/MP4 only; max 4 MB.
- Hosting: basic security headers (nosniff, referrer, frame).

## Still required before public release
1. **Firebase App Check** + restrict API key HTTP referrers.
2. **Do not rely on Storage** if on Spark / cost-sensitive — use RTDB data-URL JPEG only (already supported for images).
3. **Room cleanup** Cloud Function on `meta/createdAt` (rooms never auto-delete).
4. **Rejoin after refresh**: `onDisconnect` removes player; non-members cannot read started rooms. Needs `members/$uid` or `connected` flag (not implemented).
5. **Client-authoritative** health/position — accept for private co-op only.
6. **Replace NC/IP assets** — see CREDITS.md.

## Intentionally not using `numChildren()` in rules
Some CLI validators on this project rejected `numChildren`. Player cap remains client-side (`MAX_PLAYERS`).
