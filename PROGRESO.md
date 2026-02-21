# Estado del proyecto (actualizado: 2026-02-21)

## Backend (Cloudflare Worker + D1)
- Worker: `solitaire-backend`
- DB: `solitaire_db` (D1)
- Endpoints activos:
  - `POST /nonce`
  - `POST /submit`
  - `GET /top`
  - `GET /me`
  - `GET /recent`
  - `GET /health`

## Cambios backend hechos en esta sesion
- Se mantuvo anticheat base:
  - nonce por wallet + expiracion
  - nonce de un solo uso (anti-replay)
  - scope de nonce por IP hash
  - rate limit por IP y wallet
  - validaciones de plausibilidad (`moves`, `time_seconds`)
- Se corrigio validacion de score por modo:
  - `normal`: multiplicador `1.0`
  - `easy`: multiplicador `0.65`
- La firma ahora incluye `Mode` para mantener consistencia cliente/backend.
- Se agrego deduplicacion de `score_runs` (misma wallet/day/score/moves/time en ventana de 30 min).
- Deploy backend realizado en produccion (Worker actualizado).

## Frontend (`index.html`) - estado actual
- Visual:
  - look de mesa verde mas realista
  - fondo del tablero con `assets/cards/mesa.jpg`
  - logo `MN` en header y tambien en dorso de cartas
- Cartas:
  - assets reales SVG locales en `assets/cards/` (52 cartas)
  - ajuste responsive para que no se corten en mobile
- Jugabilidad:
  - movimiento `foundation -> tableau` habilitado (click y drag)
  - `Undo` infinito por historial
  - modos `Normal` y `Facil`
  - en `Facil` se aplica score menor (`0.65x`) y reglas mas permisivas
  - rescate anti-bloqueo activo (rebarajado/revelado segun modo)
- Persistencia movil / MetaMask:
  - guardado de estado en `localStorage`
  - restauracion al volver de app-switch
  - manejo de `pendingWinSubmit` para reintento de envio

## Estado de DB
- Se hizo reset completo de datos (manteniendo esquema) durante esta sesion.
- Luego se validaron envios reales de partidas.

## Tests
- Backend tests locales: `7/7` pasando (`npm test -- --run`).

## Comandos utiles
- Test backend:
  - `npm test -- --run`
- Deploy backend:
  - `npx wrangler deploy`
- Verificar tablas D1 remotas:
  - `npx wrangler d1 execute solitaire_db --remote --command "SELECT COUNT(*) FROM scores;"`

## Pendientes para proxima sesion
1. Verificar que el flujo de firma/reintento en mobile quede 100% estable en todos los navegadores/wallets.
2. Definir estrategia final de dificultad (si mantener rescates en normal o solo en facil).
3. Cerrar CORS en produccion (allowlist real en lugar de `*`).
4. Mejorar UX del estado de envio de score (pendiente/enviado/fallido).
5. Opcional: migrar frontend a Vite para separar codigo y manejo de assets.
