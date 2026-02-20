# Estado del proyecto (actualizado: 2026-02-20)

## Backend
- API en Cloudflare Worker (`solitaire-backend`).
- Base de datos en Cloudflare D1 (`solitaire_db`) sincronizada con `schema.sql`.
- Endpoints activos:
  - `POST /nonce`
  - `POST /submit`
  - `GET /top`
  - `GET /me`
  - `GET /recent`
  - `GET /health`

## Anticheat (estado actual)
- Nonce por wallet con expiración.
- Nonce de un solo uso (anti-replay).
- Firma obligatoria de payload (`wallet + day + score + moves + time + nonce`).
- Scope de nonce por IP hash.
- Rate limit por IP y por wallet.
- Validación de score en backend (no se confía el score del cliente):
  - Fórmula exigida: `score = max(0, 4820 - time_seconds - 2*moves)`.
- Validaciones de plausibilidad:
  - `moves >= 40`
  - `time_seconds >= 30`
  - `time_seconds >= floor(moves * 0.35)`

## Frontend
- Archivo principal renombrado a `index.html`.
- El envío de score firma con wallet y manda `/submit`.
- Ajustado `checkWin()` para calcular score final consistente con backend antes de enviar.
- `API_BASE` actual:
  - `https://solitaire-backend.solitaire-pol.workers.dev`

## Tests y validación
- Tests backend: `7/7` pasando localmente.
- Se validó en producción:
  - score falso -> rechazado (`401 Invalid score proof`)
  - score válido -> aceptado (`200 ok`)
  - replay mismo nonce/firma -> rechazado (`401 Nonce already used`)

## Script útil agregado
- Archivo: `solitaire-backend/solitaire-backend/scripts/submit-test-score.js`
- Comando npm: `npm run test:submit`
- Permite:
  - generar payload válido automático,
  - probar replay (`--replay`),
  - forzar valores (`--score`, `--moves`, `--time`, `--day`, `--api`).

## Comandos de referencia
- Tests:
  - `npm test -- --run`
- Envío válido automático:
  - `npm run test:submit -- --api https://solitaire-backend.solitaire-pol.workers.dev`
- Prueba replay:
  - `npm run test:submit -- --api https://solitaire-backend.solitaire-pol.workers.dev --replay`
- Prueba score falso:
  - `npm run test:submit -- --api https://solitaire-backend.solitaire-pol.workers.dev --score 999999 --moves 80 --time 500`

## Pendientes para próxima sesión
1. Cerrar CORS en producción (allowlist de dominios reales; sacar `*`).
2. Publicar frontend en GitHub Pages (repo + Pages activo + URL para testers).
3. Definir monitoreo básico de intentos rechazados (`invalid signature`, `invalid score proof`, rate limit).
4. Evaluar fase 2 anticheat (partida/challenge emitida por servidor para mayor garantía de run real).
