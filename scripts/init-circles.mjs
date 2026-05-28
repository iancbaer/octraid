/**
 * Initialize the three Circles by submitting the first circle_call to each.
 * This establishes the storage snapshot needed for view queries.
 *
 * We call get_total_agents on Identity (view via update to trigger cache creation)
 * and verify the storage cache is established afterwards.
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
ed.etc.sha512Sync = (...msgs) => sha512(ed.etc.concatBytes(...msgs));
import { createHash } from "crypto";
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

function escape_json(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

function signCircleCall(circleId, nonce, method, paramsArray) {
  const paramsJson = JSON.stringify(paramsArray);
  const timestamp = Date.now() / 1000;
  const canonical = `{"from":"${ADDRESS}","to_":"${circleId}","amount":"0","nonce":${nonce},"ou":"1000","timestamp":${timestamp},"op_type":"circle_call","encrypted_data":"${method}","message":"${escape_json(paramsJson)}"}`;
  const sig = ed.sign(Buffer.from(canonical, "utf8"), PRIV_BYTES);
  return {
    from: ADDRESS, to_: circleId, amount: "0", nonce, ou: "1000", timestamp,
    signature: Buffer.from(sig).toString("base64"),
    public_key: PUB_B64,
    op_type: "circle_call",
    encrypted_data: method,
    message: paramsJson,
  };
}

function signCircleView(circleId, method, params) {
  const paramsDump = JSON.stringify(params);
  const paramsHash = createHash("sha256").update(paramsDump).digest("hex");
  const subject = `${method}|${paramsHash}|0`;
  const msg = `octra_circle_view|${circleId}|${ADDRESS}|${subject}`;
  const sig = ed.sign(Buffer.from(msg, "utf8"), PRIV_BYTES);
  return Buffer.from(sig).toString("base64");
}

async function circleView(circleId, method, params = []) {
  const sig = signCircleView(circleId, method, params);
  return rpc("octra_circleViewAuth", [circleId, method, params, ADDRESS, PUB_B64, sig, false]);
}

async function pollTx(txHash) {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const tx = await rpc("octra_transaction", [txHash]);
      if (tx?.status === "confirmed" || tx?.confirmed || tx?.block_height) {
        return tx;
      }
      if (tx?.status === "rejected") throw new Error(`Rejected: ${JSON.stringify(tx.error)}`);
    } catch (e) {
      if (e.message.includes("Rejected")) throw e;
    }
    process.stdout.write(".");
  }
  console.log(" (timeout)");
}

console.log("=== Initializing OctraID Circles ===\n");
console.log(`Registry: ${ADDRESS}`);

const bal = await rpc("octra_balance", [ADDRESS]);
console.log(`Balance: ${bal.balance} OCT, nonce: ${bal.nonce}\n`);

let nonce = parseInt(bal.nonce) + 1;

// Register the registry wallet itself as the first agent
// This proves register() works and creates the storage cache
console.log("[Identity] Registering registry wallet as seed agent...");
const registerTx = signCircleCall(IDENTITY, nonce++, "register", [
  ADDRESS, // agent_address = registry wallet
  ADDRESS, // principal_address = registry wallet (caller must match this)
  "https://octraid.network/registry-agent-card.json",
]);
const regResult = await rpc("octra_submit", [registerTx]);
console.log(`  tx_hash: ${regResult.tx_hash}, ou_cost: ${regResult.ou_cost}`);
process.stdout.write("  Waiting");
await pollTx(regResult.tx_hash);
console.log(" ✓");

// Now test the view
console.log("\n[Identity] Querying get_total_agents...");
try {
  const total = await circleView(IDENTITY, "get_total_agents", []);
  console.log(`  total_agents: ${JSON.stringify(total)}`);
} catch (e) {
  console.log(`  error: ${e.message}`);
}

// Submit a dummy event to Reputation Circle to init its storage
console.log("\n[Reputation] Submitting TransactionCompleted event on registry agent...");
// First need the agent_id for the registered agent
const agentInfo = await circleView(IDENTITY, "get_agent", [ADDRESS]).catch(() => null);
if (agentInfo) {
  console.log(`  agent: ${JSON.stringify(agentInfo).slice(0, 80)}...`);
}

// Derive agent_id the same way the Circle does (djb2+fnv1a of ADDRESS)
function deriveAgentId(addr) {
  const bytes = Buffer.from(addr, "utf8");
  let h1 = 5381n;
  let h2 = 0xcbf29ce484222325n;
  for (const b of bytes) {
    h1 = (h1 * 33n + BigInt(b)) & 0xffffffffffffffffn;
    h2 = h2 ^ BigInt(b);
    h2 = (h2 * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  const combined = h1 ^ (h2 << 32n) ^ (h2 >> 32n);
  return `agt_${combined.toString(16).padStart(16, "0")}`;
}

const agentId = deriveAgentId(ADDRESS);
console.log(`\n[Reputation] Submitting event for ${agentId}...`);
const eventTx = signCircleCall(REPUTATION, nonce++, "submit_event", [
  agentId,
  "TransactionCompleted",
  "",
]);
const eventResult = await rpc("octra_submit", [eventTx]);
console.log(`  tx_hash: ${eventResult.tx_hash}, ou_cost: ${eventResult.ou_cost}`);
process.stdout.write("  Waiting");
await pollTx(eventResult.tx_hash);
console.log(" ✓");

// Init Mandate Circle with a dummy mandate
console.log("\n[Mandate] Issuing test mandate...");
const now = Math.floor(Date.now() / 1000);
const mandateTx = signCircleCall(MANDATE, nonce++, "issue", [
  agentId,            // agent_id
  ADDRESS,            // principal_address (caller must match)
  "0000000000000000000000000000000000000000000000000000000000000000", // scope_hash
  0,                  // max_value (0 = no limit)
  0,                  // total_budget (0 = no limit)
  now,                // valid_from
  now + 86400,        // valid_until
]);
const mandateResult = await rpc("octra_submit", [mandateTx]);
console.log(`  tx_hash: ${mandateResult.tx_hash}, ou_cost: ${mandateResult.ou_cost}`);
process.stdout.write("  Waiting");
await pollTx(mandateResult.tx_hash);
console.log(" ✓");

// Final verification
console.log("\n=== Final Verification ===");
for (const [name, id, method, params] of [
  ["Identity",   IDENTITY,   "get_total_agents",        []],
  ["Reputation", REPUTATION, "get_event_count",         [agentId]],
  ["Mandate",    MANDATE,    "get_active_mandate_count", [agentId]],
]) {
  try {
    const r = await circleView(id, method, params);
    console.log(`[${name}] ${method}(${params.join(",")}) → ${JSON.stringify(r)}`);
  } catch (e) {
    console.log(`[${name}] ${method}() → ERROR: ${e.message.slice(0, 100)}`);
  }
}

console.log("\n=== Circles initialized ===");
console.log(`Seed agent ID: ${agentId}`);
