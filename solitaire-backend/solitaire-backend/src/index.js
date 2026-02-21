import { verifyMessage } from "ethers/hash";

const API_VERSION = "2026-02-20";
const SIGNING_APP_NAME = "NFT Solitario";
const SIGNING_DOMAIN = "nft-solitario";
const NONCE_TTL_MS = 5 * 60 * 1000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function badRequest(msg, status = 400) {
  return json({ ok: false, error: msg }, status);
}

function getClientIP(request) {
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf) return cf;
  const xff = request.headers.get("X-Forwarded-For");
  if (xff) return xff.split(",")[0].trim();
  return "0.0.0.0";
}

function isHexWallet(w) {
  return /^0x[a-fA-F0-9]{40}$/.test(w);
}

function isHexSig(sig) {
  return /^0x[0-9a-fA-F]{130}$/.test(sig);
}

function nowMs() {
  return Date.now();
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
}

function buildScoreSignMessage({ appName, domain, day, score, moves, timeSeconds, nonce, mode }) {
  const lines = [
    `${appName} Score Submission`,
    `Domain: ${domain}`,
    `Day: ${day}`,
    `Score: ${score}`,
    `Moves: ${moves}`,
    `TimeSeconds: ${timeSeconds}`,
    `Nonce: ${nonce}`,
  ];
  if (mode) lines.push(`Mode: ${mode}`);
  return lines.join("\n");
}

function scoreMultiplierForMode(mode) {
  if (mode === "easy") return 0.65;
  return 1;
}

function computeExpectedWinningScore({ moves, timeSeconds, mode }) {
  const base = 1800;
  const foundationBonus = 52 * 35;
  const winBonus = 1200;
  const raw = base - timeSeconds - (moves * 2) + foundationBonus + winBonus;
  const scaled = raw * scoreMultiplierForMode(mode);
  return Math.max(0, scaled | 0);
}

async function checkAndBumpRateLimit(env, { key, max, windowMs }) {
  const now = nowMs();
  const windowStart = now - (now % windowMs);

  const row = await env.DB.prepare(
    "SELECT window_start, count FROM rate_limits WHERE key = ?"
  ).bind(key).first();

  if (!row || row.window_start !== windowStart) {
    await env.DB.prepare(
      "INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) " +
      "ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1"
    ).bind(key, windowStart).run();
    return { allowed: true, remaining: max - 1, resetMs: windowStart + windowMs };
  }

  const count = Number(row.count || 0);
  if (count >= max) {
    return { allowed: false, remaining: 0, resetMs: windowStart + windowMs };
  }

  await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?")
    .bind(key).run();

  return { allowed: true, remaining: max - (count + 1), resetMs: windowStart + windowMs };
}

async function applyRateLimits(env, request, walletLowerOrNull) {
  const ip = getClientIP(request);
  const windowMs = 10 * 60 * 1000;

  const ipKey = `ip:${ip}`;
  const ipRes = await checkAndBumpRateLimit(env, { key: ipKey, max: 30, windowMs });
  if (!ipRes.allowed) return { ok: false, scope: "ip", ...ipRes };

  if (walletLowerOrNull) {
    const wKey = `wallet:${walletLowerOrNull}`;
    const wRes = await checkAndBumpRateLimit(env, { key: wKey, max: 10, windowMs });
    if (!wRes.allowed) return { ok: false, scope: "wallet", ...wRes };
  }

  return { ok: true };
}

function clampInt(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function getCurrentUtcMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function getMonthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  const start = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const end = `${String(nextY).padStart(4, "0")}-${String(nextM).padStart(2, "0")}-01`;
  return { start, end };
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (request.method === "GET" && path === "/health") {
        return json({
          ok: true,
          version: API_VERSION,
          signing: { app_name: SIGNING_APP_NAME, domain: SIGNING_DOMAIN },
        });
      }

      if (request.method === "POST" && path === "/nonce") {
        const body = await readJson(request);
        if (!body) return badRequest("Invalid JSON body");

        const walletRaw = String(body.wallet || "").trim();
        const wallet = walletRaw.toLowerCase();
        if (!isHexWallet(wallet)) return badRequest("Invalid wallet");

        const nonce = randomHex(16);
        const ipHashHex = await sha256Hex(getClientIP(request));
        const expiresAtMs = nowMs() + NONCE_TTL_MS;

        await env.DB.prepare(
          `INSERT INTO auth_nonces (wallet, nonce, ip_hash, expires_at_ms, used_at_ms)
           VALUES (?, ?, ?, ?, NULL)`
        ).bind(wallet, nonce, ipHashHex, expiresAtMs).run();

        return json({
          ok: true,
          wallet,
          nonce,
          expires_at_ms: expiresAtMs,
          expires_in_seconds: Math.floor(NONCE_TTL_MS / 1000),
          signing: { app_name: SIGNING_APP_NAME, domain: SIGNING_DOMAIN },
        });
      }

      if (request.method === "GET" && path === "/top") {
        const month = (url.searchParams.get("month") || getCurrentUtcMonth()).trim();
        const range = getMonthRange(month);
        if (!range) return badRequest("Invalid month (YYYY-MM)");
        const limit = clampInt(Number(url.searchParams.get("limit") || 10), 1, 50);

        const q = await env.DB.prepare(
          `WITH monthly_best AS (
             SELECT
               wallet, day, score, moves, time_seconds,
               ROW_NUMBER() OVER (
                 PARTITION BY wallet
                 ORDER BY score DESC, time_seconds ASC, moves ASC, day DESC
               ) AS rn
             FROM scores
             WHERE day >= ? AND day < ?
           )
           SELECT wallet, day, score, moves, time_seconds
           FROM monthly_best
           WHERE rn = 1
           ORDER BY score DESC, time_seconds ASC, moves ASC, day DESC
           LIMIT ?`
        ).bind(range.start, range.end, limit).all();

        return json({ ok: true, month, rows: q.results || [] });
      }

      if (request.method === "GET" && path === "/me") {
        const walletRaw = (url.searchParams.get("wallet") || "").trim();
        if (!walletRaw) return badRequest("Missing wallet");
        const wallet = walletRaw.toLowerCase();
        if (!isHexWallet(wallet)) return badRequest("Invalid wallet");

        const day = (url.searchParams.get("day") || "").trim();
        if (day) {
          const row = await env.DB.prepare(
            `SELECT wallet, day, score, moves, time_seconds
             FROM scores
             WHERE wallet = ? AND day = ?`
          ).bind(wallet, day).first();
          return json({ ok: true, row: row || null });
        }

        const row = await env.DB.prepare(
          `SELECT wallet, day, score, moves, time_seconds
           FROM scores
           WHERE wallet = ?
           ORDER BY day DESC
           LIMIT 1`
        ).bind(wallet).first();

        return json({ ok: true, row: row || null });
      }

      if (request.method === "GET" && path === "/recent") {
        const walletRaw = (url.searchParams.get("wallet") || "").trim();
        if (!walletRaw) return badRequest("Missing wallet");
        const wallet = walletRaw.toLowerCase();
        if (!isHexWallet(wallet)) return badRequest("Invalid wallet");
        const limit = clampInt(Number(url.searchParams.get("limit") || 10), 1, 50);

        const q = await env.DB.prepare(
          `SELECT score, moves, time_seconds, created_at
           FROM score_runs
           WHERE lower(wallet) = ?
           ORDER BY created_at DESC
           LIMIT ?`
        ).bind(wallet, limit).all();

        return json({ ok: true, rows: q.results || [] });
      }

      if (request.method === "POST" && path === "/submit") {
        const body = await readJson(request);
        if (!body) return badRequest("Invalid JSON body");

        const walletRaw = String(body.wallet || "").trim();
        const wallet = walletRaw.toLowerCase();
        if (!isHexWallet(wallet)) return badRequest("Invalid wallet");

        const day = String(body.day || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return badRequest("Invalid day (YYYY-MM-DD)");
        const mode = String(body.mode || "normal").trim().toLowerCase();
        if (mode !== "normal" && mode !== "easy") return badRequest("Invalid mode");

        const score = clampInt(Number(body.score || 0), 0, 1_000_000_000);
        const moves = clampInt(Number(body.moves || 0), 0, 1_000_000_000);
        const timeSeconds = clampInt(Number(body.time_seconds || 0), 0, 1_000_000_000);
        const nonce = String(body.nonce || "").trim();
        const signature = String(body.signature || "").trim();

        if (!nonce) return badRequest("Missing nonce");
        if (!isHexSig(signature)) return badRequest("Invalid signature format");
        if (moves < 40) return badRequest("Implausible run: moves too low", 422);
        if (timeSeconds < 30) return badRequest("Implausible run: time too low", 422);
        if (timeSeconds < Math.floor(moves * 0.35)) {
          return badRequest("Implausible run: too fast for moves", 422);
        }

        const expectedScore = computeExpectedWinningScore({ moves, timeSeconds, mode });
        if (score !== expectedScore) {
          return badRequest("Invalid score proof", 401);
        }

        const rl = await applyRateLimits(env, request, wallet);
        if (!rl.ok) {
          const resetInSec = Math.max(1, Math.ceil((rl.resetMs - nowMs()) / 1000));
          return json(
            { ok: false, error: `Rate limit (${rl.scope}). Espera ${resetInSec}s y proba de nuevo.` },
            429,
            { "Retry-After": String(resetInSec) }
          );
        }

        const ipHashHex = await sha256Hex(getClientIP(request));
        const now = nowMs();

        const nonceRow = await env.DB.prepare(
          `SELECT wallet, nonce, ip_hash, expires_at_ms, used_at_ms
           FROM auth_nonces
           WHERE wallet = ? AND nonce = ?`
        ).bind(wallet, nonce).first();

        if (!nonceRow) return badRequest("Invalid nonce", 401);
        if (String(nonceRow.ip_hash || "") !== ipHashHex) return badRequest("Invalid nonce scope", 401);
        if (nonceRow.used_at_ms !== null && Number(nonceRow.used_at_ms) > 0) return badRequest("Nonce already used", 401);
        if (Number(nonceRow.expires_at_ms || 0) < now) return badRequest("Nonce expired", 401);

        const signMessage = buildScoreSignMessage({
          appName: SIGNING_APP_NAME,
          domain: SIGNING_DOMAIN,
          day,
          score,
          moves,
          timeSeconds,
          nonce,
          mode,
        });

        let recovered = "";
        try {
          recovered = verifyMessage(signMessage, signature).toLowerCase();
        } catch {
          return badRequest("Invalid signature", 401);
        }
        if (recovered !== wallet) return badRequest("Invalid signature", 401);

        const nonceConsume = await env.DB.prepare(
          `UPDATE auth_nonces
           SET used_at_ms = ?
           WHERE wallet = ? AND nonce = ? AND used_at_ms IS NULL AND expires_at_ms >= ? AND ip_hash = ?`
        ).bind(now, wallet, nonce, now, ipHashHex).run();

        const consumed = !!(nonceConsume?.meta && typeof nonceConsume.meta.changes === "number" && nonceConsume.meta.changes > 0);
        if (!consumed) return badRequest("Nonce already used or expired", 401);

        await env.DB.prepare(
          `INSERT INTO score_runs (wallet, day, score, moves, time_seconds, ip_hash)
           SELECT ?, ?, ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1
             FROM score_runs
             WHERE wallet = ?
               AND day = ?
               AND score = ?
               AND moves = ?
               AND time_seconds = ?
               AND created_at >= datetime('now', '-30 minutes')
           )`
        ).bind(
          wallet, day, score, moves, timeSeconds, ipHashHex,
          wallet, day, score, moves, timeSeconds
        ).run();

        const up = await env.DB.prepare(
          `INSERT INTO scores (wallet, day, score, moves, time_seconds)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(wallet, day)
           DO UPDATE SET
             score = excluded.score,
             moves = excluded.moves,
             time_seconds = excluded.time_seconds
           WHERE excluded.score > scores.score`
        ).bind(wallet, day, score, moves, timeSeconds).run();

        const updated = !!(up?.meta && typeof up.meta.changes === "number" && up.meta.changes > 0);

        const best = await env.DB.prepare(
          `SELECT score AS best_score FROM scores WHERE wallet = ? AND day = ?`
        ).bind(wallet, day).first();

        return json({
          ok: true,
          updated,
          best_score: best?.best_score ?? score,
          your_score: score,
        });
      }

      return badRequest("Not found", 404);
    } catch (err) {
      return json({ ok: false, error: String(err?.message || err) }, 500);
    }
  },
};

