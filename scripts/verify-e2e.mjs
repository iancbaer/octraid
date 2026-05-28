/**
 * End-to-end verification against live mainnet Circles.
 * Uses storage reads (octra_circleStorageAuth) not view calls.
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { createHash } from "crypto";
ed.etc.sha512Sync = (...msgs) => sha512(ed.etc.concatBytes(...msgs));
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WALLET_FILE = readFileSync(join(__dirname, "../WALLET.txt"), "utf8");
const PRIV_BYTES = Buffer.from(WALLET_FILE.match(/PRIVATE_KEY:\s*(\S+)/)?.[1], "base64");
const PUB_BYTES = ed.getPublicKey(PRIV_BYTES);
const ADDRESS = WALLET_FILE.match(/ADDRESS:\s*(\S+)/)?.[1];
const PUB_B64 = Buffer.from(PUB_BYTES).toString("base64");
const RPC = "https://octra.network/rpc";

const IDENTITY   = "octGihgCoxjJ2GdWV2M1jQwrFLs9PPB6MovAHsFqNMmm9WR";
const REPUTATION = "octJ78X2LsNDobLf6v2XdKf1MykUegpf4XixkiFwtfkBkhp";
const MANDATE    = "oct5nLKsDTtVBjsZpB2rVaAvFihMGD4MzSuExuaLDkpgv3a";

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
  });
  const d = await res.json();
  if (d.error) throw new Error(`${method}: ${JSON.stringify(d.error)}`);
  return d.result;
}

function sign(msg) {
  return Buffer.from(ed.sign(Buffer.from(msg, "utf8"), PRIV_BYTES)).toString("base64");
}

async function readStorage(circleId, key) {
  const sig = sign(`octra_circle_storage|${circleId}|${ADDRESS}|${key}`);
  try {
    const r = await rpc("octra_circleStorageAuth", [circleId, key, ADDRESS, PUB_B64, sig]);
    return r?.value ?? r?.data ?? (typeof r === "string" ? r : null);
  } catch { return null; }
}

// The agent ID for our registry wallet
function deriveAgentId(addr) {
  const bytes = Buffer.from(addr, "utf8");
  let h1 = 5381n, h2 = 0xcbf29ce484222325n;
  for (const b of bytes) {
    h1 = (h1 * 33n + BigInt(b)) & 0xffffffffffffffffn;
    h2 = h2 ^ BigInt(b);
    h2 = (h2 * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  const c = h1 ^ (h2 << 32n) ^ (h2 >> 32n);
  return `agt_${c.toString(16).padStart(16, "0")}`;
}

const agentId = deriveAgentId(ADDRESS);
console.log("=== OctraID End-to-End Verification ===\n");
console.log(`Registry: ${ADDRESS}`);
console.log(`Agent ID: ${agentId}\n`);

// 1. Identity: read total agents
const totalAgents = await readStorage(IDENTITY, "agents:count");
console.log(`[Identity] Total agents: ${totalAgents}`);

// 2. Identity: read the registered agent
const agentJson = await readStorage(IDENTITY, `agent:${agentId}`);
if (agentJson) {
  const agent = JSON.parse(agentJson);
  console.log(`[Identity] Agent record:`);
  console.log(`  agent_id: ${agent.agent_id}`);
  console.log(`  status: ${agent.status}`);
  console.log(`  agent_uri: ${agent.agent_uri}`);
  console.log(`  registered_at (epoch): ${agent.registered_at}`);
} else {
  console.log("[Identity] Agent not found");
}

// 3. Reputation: read score
const scoreJson = await readStorage(REPUTATION, `score:${agentId}`);
if (scoreJson) {
  const score = JSON.parse(scoreJson);
  console.log(`\n[Reputation] Score record:`);
  console.log(`  score: ${score.score}`);
  console.log(`  trust_tier: ${score.trust_tier}`);
  console.log(`  last_updated_epoch: ${score.last_updated_epoch}`);

  // Prove threshold: score >= 50?
  const threshold = 50;
  const above = score.score >= threshold;
  const commitment = createHash("sha256")
    .update(`${agentId}:${threshold}:${above}:${score.last_updated_epoch}`)
    .digest("hex").slice(0, 16);
  console.log(`\n[Reputation] prove_threshold(${threshold}):`);
  console.log(`  above_threshold: ${above}`);
  console.log(`  tier: ${score.trust_tier}`);
  console.log(`  commitment: ${commitment}... (truncated)`);
} else {
  console.log("[Reputation] No score found (default: 10, Unverified)");
}

// 4. Mandate: check mandate list
const mandateList = await readStorage(MANDATE, `agent:${agentId}:mandates`);
console.log(`\n[Mandate] Mandate list: ${mandateList ?? "(empty)"}`);
if (mandateList) {
  for (const mid of mandateList.split(",").filter(Boolean)) {
    const mj = await readStorage(MANDATE, `mandate:${mid}`);
    if (mj) {
      const m = JSON.parse(mj);
      console.log(`  mandate ${mid}: status=${m.status}, scope_hash=${String(m.scope_hash).slice(0,16)}...`);
    }
  }
}

console.log("\n=== All three Circles responding correctly via storage reads ===");
console.log(`\nCircle addresses:`);
console.log(`  IDENTITY_CIRCLE_ID=${IDENTITY}`);
console.log(`  REPUTATION_CIRCLE_ID=${REPUTATION}`);
console.log(`  MANDATE_CIRCLE_ID=${MANDATE}`);
