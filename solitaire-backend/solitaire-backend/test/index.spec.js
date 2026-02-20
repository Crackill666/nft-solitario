import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const TEST_IP = "1.2.3.4";

function buildScoreSignMessage({ appName, domain, day, score, moves, timeSeconds, nonce }) {
  return [
    `${appName} Score Submission`,
    `Domain: ${domain}`,
    `Day: ${day}`,
    `Score: ${score}`,
    `Moves: ${moves}`,
    `TimeSeconds: ${timeSeconds}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

function computeExpectedWinningScore({ moves, timeSeconds }) {
  const base = 1800;
  const foundationBonus = 52 * 35;
  const winBonus = 1200;
  const raw = base - timeSeconds - (moves * 2) + foundationBonus + winBonus;
  return Math.max(0, raw | 0);
}

function newAccount() {
  return privateKeyToAccount(generatePrivateKey());
}

async function initDb() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS scores (
      wallet TEXT NOT NULL,
      day TEXT NOT NULL,
      score INTEGER NOT NULL,
      moves INTEGER NOT NULL,
      time_seconds INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (wallet, day)
    )`,
    `CREATE TABLE IF NOT EXISTS score_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      day TEXT NOT NULL,
      score INTEGER NOT NULL,
      moves INTEGER NOT NULL,
      time_seconds INTEGER NOT NULL,
      ip_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS auth_nonces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      nonce TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      used_at_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(wallet, nonce)
    )`,
    "DELETE FROM scores",
    "DELETE FROM score_runs",
    "DELETE FROM rate_limits",
    "DELETE FROM auth_nonces",
  ];

  for (const sql of stmts) {
    await env.DB.prepare(sql).run();
  }
}

async function requestNonce(wallet) {
  const res = await SELF.fetch("http://example.com/nonce", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": TEST_IP },
    body: JSON.stringify({ wallet }),
  });
  const data = await res.json();
  return { res, data };
}

describe("nonce + signed submit", () => {
  beforeEach(async () => {
    await initDb();
  });

  it("issues nonce for valid wallet", async () => {
    const account = newAccount();
    const { res, data } = await requestNonce(account.address);

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(typeof data.nonce).toBe("string");
    expect(data.nonce.length).toBeGreaterThan(10);
    expect(data.expires_in_seconds).toBeGreaterThan(0);
  });

  it("rejects invalid wallet on /nonce", async () => {
    const { res, data } = await requestNonce("invalid-wallet");
    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
  });

  it("accepts /submit with valid signature and rejects nonce reuse", async () => {
    const account = newAccount();
    const day = "2026-02-20";
    const moves = 55;
    const timeSeconds = 300;
    const score = computeExpectedWinningScore({ moves, timeSeconds });

    const nonceResp = await requestNonce(account.address);
    const nonce = nonceResp.data.nonce;

    const message = buildScoreSignMessage({
      appName: "NFT Solitario",
      domain: "nft-solitario",
      day,
      score,
      moves,
      timeSeconds,
      nonce,
    });
    const signature = await account.signMessage({ message });

    const submitRes = await SELF.fetch("http://example.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": TEST_IP },
      body: JSON.stringify({
        wallet: account.address,
        day,
        score,
        moves,
        time_seconds: timeSeconds,
        nonce,
        signature,
      }),
    });
    const submitData = await submitRes.json();

    expect(submitRes.status).toBe(200);
    expect(submitData.ok).toBe(true);
    expect(submitData.best_score).toBe(score);

    const replayRes = await SELF.fetch("http://example.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": TEST_IP },
      body: JSON.stringify({
        wallet: account.address,
        day,
        score: score + 1,
        moves,
        time_seconds: timeSeconds,
        nonce,
        signature,
      }),
    });
    const replayData = await replayRes.json();

    expect(replayRes.status).toBe(401);
    expect(replayData.ok).toBe(false);
  });

  it("rejects invalid signature", async () => {
    const account = newAccount();
    const attacker = newAccount();
    const day = "2026-02-20";
    const moves = 70;
    const timeSeconds = 450;
    const score = computeExpectedWinningScore({ moves, timeSeconds });

    const nonceResp = await requestNonce(account.address);
    const nonce = nonceResp.data.nonce;

    const forgedMessage = buildScoreSignMessage({
      appName: "NFT Solitario",
      domain: "nft-solitario",
      day,
      score,
      moves,
      timeSeconds,
      nonce,
    });
    const forgedSignature = await attacker.signMessage({ message: forgedMessage });

    const res = await SELF.fetch("http://example.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": TEST_IP },
      body: JSON.stringify({
        wallet: account.address,
        day,
        score,
        moves,
        time_seconds: timeSeconds,
        nonce,
        signature: forgedSignature,
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(String(data.error || "")).toMatch(/Invalid signature/i);
  });

  it("rejects invalid score proof", async () => {
    const account = newAccount();
    const day = "2026-02-20";
    const moves = 60;
    const timeSeconds = 500;
    const score = 999999;

    const nonceResp = await requestNonce(account.address);
    const nonce = nonceResp.data.nonce;

    const message = buildScoreSignMessage({
      appName: "NFT Solitario",
      domain: "nft-solitario",
      day,
      score,
      moves,
      timeSeconds,
      nonce,
    });
    const signature = await account.signMessage({ message });

    const res = await SELF.fetch("http://example.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": TEST_IP },
      body: JSON.stringify({
        wallet: account.address,
        day,
        score,
        moves,
        time_seconds: timeSeconds,
        nonce,
        signature,
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(String(data.error || "")).toMatch(/score proof/i);
  });

  it("rejects implausible speed vs moves", async () => {
    const account = newAccount();
    const day = "2026-02-20";
    const moves = 100;
    const timeSeconds = 20;
    const score = computeExpectedWinningScore({ moves, timeSeconds });

    const nonceResp = await requestNonce(account.address);
    const nonce = nonceResp.data.nonce;

    const message = buildScoreSignMessage({
      appName: "NFT Solitario",
      domain: "nft-solitario",
      day,
      score,
      moves,
      timeSeconds,
      nonce,
    });
    const signature = await account.signMessage({ message });

    const res = await SELF.fetch("http://example.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": TEST_IP },
      body: JSON.stringify({
        wallet: account.address,
        day,
        score,
        moves,
        time_seconds: timeSeconds,
        nonce,
        signature,
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data.ok).toBe(false);
    expect(String(data.error || "")).toMatch(/Implausible run/i);
  });

  it("rejects expired nonce", async () => {
    const account = newAccount();
    const day = "2026-02-20";
    const moves = 50;
    const timeSeconds = 280;
    const score = computeExpectedWinningScore({ moves, timeSeconds });

    const nonceResp = await requestNonce(account.address);
    const nonce = nonceResp.data.nonce;

    await env.DB.prepare(
      "UPDATE auth_nonces SET expires_at_ms = ? WHERE wallet = ? AND nonce = ?"
    ).bind(Date.now() - 1000, account.address.toLowerCase(), nonce).run();

    const message = buildScoreSignMessage({
      appName: "NFT Solitario",
      domain: "nft-solitario",
      day,
      score,
      moves,
      timeSeconds,
      nonce,
    });
    const signature = await account.signMessage({ message });

    const res = await SELF.fetch("http://example.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": TEST_IP },
      body: JSON.stringify({
        wallet: account.address,
        day,
        score,
        moves,
        time_seconds: timeSeconds,
        nonce,
        signature,
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(String(data.error || "")).toMatch(/expired/i);
  });
});
