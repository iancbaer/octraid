/**
 * Deploy all three OctraID Circles to Octra mainnet.
 *
 * Circle ID derivation: exact port of circleIdOfDeploy() from webcli/static/circles.html
 *   payloadHash = SHA256("octra:circle_deploy_payload:v1" + 0x00 + u32be(len) + JSON.stringify(payload))
 *   seed = SHA256("octra:circle_deploy_id:v1" + 0x00 + u32be(len(deployer)) + deployer + u32be(8) + u64be(nonce) + u32be(64) + payloadHash_hex)
 *   circleId = "oct" + base58(seed).slice(0, 44)
 *
 * Signing: canonical JSON per webcli lib/tx_builder.hpp (message INCLUDED in signature)
 * Runtime: "wasm_v1" for Rust WASM Circles
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
const PRIV_KEY_B64 = WALLET_FILE.match(/PRIVATE_KEY:\s*(\S+)/)?.[1];
const ADDRESS = WALLET_FILE.match(/ADDRESS:\s*(\S+)/)?.[1];
const PRIV_BYTES = Buffer.from(PRIV_KEY_B64, "base64");
const PUB_BYTES = ed.getPublicKey(PRIV_BYTES);
const PUB_B64 = Buffer.from(PUB_BYTES).toString("base64");
const RPC = "https://octra.network/rpc";
const CIRCLES_DIR = join(__dirname, "../circles/target/wasm32-unknown-unknown/release");

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`${method}: ${JSON.stringify(data.error)}`);
  return data.result;
}

// --- Circle ID derivation (ported from circles.html) ---

function mergeBytes(...parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

function u32be(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function u64be(value) {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  const big = BigInt(value);
  view.setUint32(0, Number((big >> 32n) & 0xffffffffn), false);
  view.setUint32(4, Number(big & 0xffffffffn), false);
  return out;
}

function h256Raw(tag, parts) {
  const prefix = mergeBytes(Buffer.from(tag, "utf8"), new Uint8Array([0]));
  const framed = parts.reduce(
    (acc, part) => mergeBytes(acc, u32be(part.length), part),
    prefix
  );
  return Buffer.from(createHash("sha256").update(framed).digest());
}

function h256Hex(tag, parts) {
  return h256Raw(tag, parts).toString("hex");
}

function base58Encode(bytes) {
  if (bytes.length === 0) return "";
  let num = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let encoded = "";
  while (num > 0n) {
    const rem = num % 58n;
    num = num / 58n;
    encoded = BASE58_ALPHABET[Number(rem)] + encoded;
  }
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) encoded = "1" + encoded;
  return encoded;
}

function circleIdOfDeploy(deployer, nonce, payload) {
  const payloadJson = JSON.stringify(payload);
  const payloadHash = h256Hex("octra:circle_deploy_payload:v1", [Buffer.from(payloadJson, "utf8")]);
  const seed = h256Raw("octra:circle_deploy_id:v1", [
    Buffer.from(deployer, "utf8"),
    u64be(nonce),
    Buffer.from(payloadHash, "utf8"),
  ]);
  const base58 = base58Encode(seed);
  const base58Part = base58.length >= 44 ? base58.slice(0, 44)
    : base58.length === 0 ? "1".repeat(44)
    : (base58.repeat(Math.ceil(44 / base58.length))).slice(0, 44);
  return `oct${base58Part}`;
}

// --- Signing ---

function escape_json(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

function signDeployTx(circleId, nonce, messageStr) {
  const timestamp = Date.now() / 1000;
  const canonical = `{"from":"${ADDRESS}","to_":"${circleId}","amount":"0","nonce":${nonce},"ou":"200000","timestamp":${timestamp},"op_type":"deploy_circle","message":"${escape_json(messageStr)}"}`;
  const sig = ed.sign(Buffer.from(canonical, "utf8"), PRIV_BYTES);
  return {
    from: ADDRESS, to_: circleId, amount: "0", nonce,
    ou: "200000", timestamp,
    signature: Buffer.from(sig).toString("base64"),
    public_key: PUB_B64,
    op_type: "deploy_circle",
    message: messageStr,
  };
}

async function pollTx(txHash, label) {
  process.stdout.write(`  Waiting for ${label}`);
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const tx = await rpc("octra_transaction", [txHash]);
      if (tx?.status === "confirmed" || tx?.confirmed || tx?.block_height) {
        console.log(` ✓`);
        return tx;
      }
      if (tx?.status === "rejected") {
        console.log(` ✗ REJECTED: ${JSON.stringify(tx.error)}`);
        return tx;
      }
    } catch { }
    process.stdout.write(".");
  }
  console.log(" (timeout — may still confirm)");
}

async function deployCircle(name, wasmFile, nonce) {
  const wasmBytes = readFileSync(join(CIRCLES_DIR, wasmFile));
  const wasmB64 = wasmBytes.toString("base64");
  console.log(`\n[${name}]`);
  console.log(`  WASM: ${wasmBytes.length} bytes, nonce: ${nonce}`);

  // Build payload matching exactly what circleIdOfDeploy expects.
  // Key order matters for JSON.stringify — must match buildCircleDeployPayload from circles.html.
  const payload = {
    runtime: "wasm_v1",
    privacy_class: "sealed",
    browser_mode: "native_sealed",
    resource_mode: "sealed_read",
    code_b64: wasmB64,
    policy_hash: null,
    members_root: null,
    export_policy: null,
    limits: {
      max_stable_bytes: "33554432",
      max_assets_bytes: "33554432",
      max_inline_value: "65536",
      max_wasm_bytes: "33554432",
    },
  };

  const circleId = circleIdOfDeploy(ADDRESS, nonce, payload);
  console.log(`  Circle ID: ${circleId}`);

  const messageStr = JSON.stringify(payload);
  console.log(`  Payload size: ${messageStr.length} chars`);

  const tx = signDeployTx(circleId, nonce, messageStr);
  const result = await rpc("octra_submit", [tx]);
  console.log(`  tx_hash: ${result.tx_hash}`);
  console.log(`  ou_cost: ${result.ou_cost}`);

  await pollTx(result.tx_hash, name);
  return circleId;
}

// ─────────────────────────────────────────────────────────────────────────────

console.log("=== OctraID Circle Deployment ===");
console.log(`Registry: ${ADDRESS}\n`);

const bal = await rpc("octra_balance", [ADDRESS]);
console.log(`Balance: ${bal.balance} OCT, nonce: ${bal.nonce}`);

let nonce = parseInt(bal.nonce) + 1;

const identityId   = await deployCircle("Identity Registry",   "identity_registry.wasm",   nonce++);
const reputationId = await deployCircle("Reputation Registry", "reputation_registry.wasm", nonce++);
const mandateId    = await deployCircle("Mandate Registry",    "mandate_registry.wasm",    nonce++);

console.log("\n=== Deployment Complete ===");
console.log(`\nAdd to .env:`);
console.log(`IDENTITY_CIRCLE_ID=${identityId}`);
console.log(`REPUTATION_CIRCLE_ID=${reputationId}`);
console.log(`MANDATE_CIRCLE_ID=${mandateId}`);
console.log(`REGISTRY_ADDRESS=${ADDRESS}`);
