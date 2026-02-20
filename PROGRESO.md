# Resumen del estado actual

## 🔹 Backend
- El backend está implementado como Cloudflare Worker.
- Se usa D1 como base de datos local y en producción.
- El endpoint `/nonce` y `/submit` están implementados.
- Se agregó verificación de firma por wallet usando viem.
- Los tests han sido ajustados para funcionar con la base D1 local.

## 🔹 Tests
- Los tests pasan localmente.
- Se corrigieron problemas de SQL para D1 local.
- Se usa la librería viem en tests para firma/verify.

## 🔹 Desarrollo local
- Para correr local:
  - `npm install`
  - `wrangler d1 execute solitaire_db --local --file schema.sql`
  - `npm test`
  - `npm run dev` (levanta el Worker)

## 🔹 Frontend
- El frontend es estático (HTML/CSS/JS).
- Se sirve con Live Server o cualquier servidor estático.

## 🟡 Próximos pasos
- Probar el flujo completo: `/nonce` → firmar con wallet → `/submit`.
- Añadir hardening:
  - invalidación de nonces viejos
  - CORS allowlist en producción
  - rate limiting por IP/wallet
- Continuar con integración del contrato NFT y deploy cuando esté listo.


///Revisá el archivo PROGRESO.md y decime en qué estado estamos, qué hace cada parte del proyecto hoy y qué sugiere como siguiente paso.
