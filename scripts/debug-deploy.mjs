/**
 * Debug deploy_circle signature — test with and without message in canonical JSON.
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
ed.etc.sha512Sync = (...msgs) => sha512(ed.etc.concatBytes(...msgs));

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

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
  });
  return res.json();
}

function sign(payload) {
  const sig = ed.sign(Buffer.from(payload, "utf8"), PRIV_BYTES);
  return Buffer.from(sig).toString("base64");
}

function escape_json(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

const balRes = await rpc("octra_balance", [ADDRESS]);
const bal = balRes.result;
const nonce = parseInt(bal.nonce) + 1;
const timestamp = Date.now() / 1000;

const wasmBytes = readFileSync(join(CIRCLES_DIR, "identity_registry.wasm"));
const wasmB64 = wasmBytes.toString("base64");

const computed = await rpc("octra_computeContractAddress", [wasmB64, ADDRESS, nonce]);
const circleId = computed.result?.address ?? computed.result;
console.log("Circle ID:", circleId);

const payload = {
  runtime: "wasm_v1",
  privacy_class: "sealed",
  browser_mode: "native_sealed",
  resource_mode: "sealed_read",
  limits: {
    max_stable_bytes: "33554432",
    max_assets_bytes: "33554432",
    max_inline_value: "65536",
    max_wasm_bytes: "33554432",
  },
  code_b64: wasmB64,
};
const messageStr = JSON.stringify(payload);
console.log("Message length:", messageStr.length);

// Try 1: sign WITH message in canonical JSON (webcli style)
{
  let canonical = `{"from":"${ADDRESS}","to_":"${circleId}","amount":"0","nonce":${nonce},"ou":"200000","timestamp":${timestamp},"op_type":"deploy_circle","message":"${escape_json(messageStr)}"}`;
  const sig = sign(canonical);
  const tx = { from: ADDRESS, to_: circleId, amount: "0", nonce, ou: "200000", timestamp, signature: sig, public_key: PUB_B64, op_type: "deploy_circle", message: messageStr };
  console.log("\nApproach 1 (with message in sig):");
  const r = await rpc("octra_submit", [tx]);
  console.log(JSON.stringify(r).slice(0, 200));
}

// Try 2: sign WITHOUT message in canonical JSON
{
  const canonical = `{"from":"${ADDRESS}","to_":"${circleId}","amount":"0","nonce":${nonce},"ou":"200000","timestamp":${timestamp},"op_type":"deploy_circle"}`;
  const sig = sign(canonical);
  const tx = { from: ADDRESS, to_: circleId, amount: "0", nonce, ou: "200000", timestamp, signature: sig, public_key: PUB_B64, op_type: "deploy_circle", message: messageStr };
  console.log("\nApproach 2 (without message in sig):");
  const r = await rpc("octra_submit", [tx]);
  console.log(JSON.stringify(r).slice(0, 200));
}

// Try 3: sign WITHOUT message, and with wasm_v1 runtime but different ou
{
  const canonical = `{"from":"${ADDRESS}","to_":"${circleId}","amount":"0","nonce":${nonce},"ou":"200000","timestamp":${timestamp},"op_type":"deploy_circle"}`;
  const sig = sign(canonical);
  // Send without code_b64 to see if the error changes
  const smallPayload = { runtime: "wasm_v1", privacy_class: "sealed" };
  const tx = { from: ADDRESS, to_: circleId, amount: "0", nonce, ou: "200000", timestamp, signature: sig, public_key: PUB_B64, op_type: "deploy_circle", message: JSON.stringify(smallPayload) };
  console.log("\nApproach 3 (minimal payload, no code_b64):");
  const r = await rpc("octra_submit", [tx]);
  console.log(JSON.stringify(r).slice(0, 200));
}
