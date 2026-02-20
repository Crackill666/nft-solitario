"use strict";

const { Wallet } = require("ethers");

const DEFAULT_APP_NAME = "NFT Solitario";
const DEFAULT_DOMAIN = "nft-solitario";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getTodayUtcDay() {
  return new Date().toISOString().slice(0, 10);
}

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

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const apiBase = String(args.api || process.env.API_BASE || "").trim().replace(/\/+$/, "");
  if (!apiBase) {
    throw new Error(
      "Falta API base. Usa --api https://tu-worker.workers.dev o setea API_BASE."
    );
  }

  const privateKey = String(args.pk || process.env.TEST_PRIVATE_KEY || "").trim();
  const signer = privateKey ? new Wallet(privateKey) : Wallet.createRandom();
  const wallet = signer.address.toLowerCase();

  const day = String(args.day || getTodayUtcDay());
  const moves = Number.isFinite(Number(args.moves)) ? Number(args.moves) : randomInt(55, 220);
  const timeSeconds = Number.isFinite(Number(args.time)) ? Number(args.time) : randomInt(180, 1800);
  const score = Number.isFinite(Number(args.score))
    ? Number(args.score)
    : computeExpectedWinningScore({ moves, timeSeconds });

  console.log("API:", apiBase);
  console.log("Wallet:", wallet);
  console.log("Payload:", { day, score, moves, time_seconds: timeSeconds });

  const nonceReq = await postJson(`${apiBase}/nonce`, { wallet });
  if (!nonceReq.res.ok || nonceReq.data?.ok === false || !nonceReq.data?.nonce) {
    throw new Error(`Error /nonce (${nonceReq.res.status}): ${JSON.stringify(nonceReq.data)}`);
  }

  const nonce = String(nonceReq.data.nonce);
  const appName = String(nonceReq.data?.signing?.app_name || DEFAULT_APP_NAME);
  const domain = String(nonceReq.data?.signing?.domain || DEFAULT_DOMAIN);
  const message = buildScoreSignMessage({
    appName,
    domain,
    day,
    score,
    moves,
    timeSeconds,
    nonce,
  });
  const signature = await signer.signMessage(message);

  const submitPayload = {
    wallet,
    day,
    score,
    moves,
    time_seconds: timeSeconds,
    nonce,
    signature,
  };

  const submitReq = await postJson(`${apiBase}/submit`, submitPayload);
  console.log("Submit status:", submitReq.res.status);
  console.log("Submit body:", submitReq.data);

  if (!submitReq.res.ok || submitReq.data?.ok === false) {
    process.exitCode = 1;
    return;
  }

  if (args.replay) {
    const replayReq = await postJson(`${apiBase}/submit`, submitPayload);
    console.log("Replay status (esperado 401):", replayReq.res.status);
    console.log("Replay body:", replayReq.data);
  }
}

main().catch((err) => {
  console.error("submit-test-score error:", err.message || err);
  process.exit(1);
});
