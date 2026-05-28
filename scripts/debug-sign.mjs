/**
 * Debug signing by testing a minimal tx against the node.
 * Also compares with the pre_client approach (exclude message from signing).
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

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
  });
  const data = await res.json();
  return data;
}

function sign(payload) {
  const sig = ed.sign(Buffer.from(payload, "utf8"), PRIV_BYTES);
  return Buffer.from(sig).toString("base64");
}

const bal = await rpc("octra_balance", [ADDRESS]);
const nonce = parseInt(bal.result.nonce) + 1;
const timestamp = Date.now() / 1000;

console.log("Address:", ADDRESS);
console.log("Pub key:", PUB_B64);
console.log("Nonce:", nonce);
console.log("Timestamp:", timestamp);

// Approach 1: pre_client style — exclude message, include op_type
// (pre_client doesn't include op_type but let's test with it)
function buildCanonicalV1(to_, amount, ou, opType, encryptedData, message) {
  // Exclude message (pre_client style)
  const obj = { from: ADDRESS, to_, amount, nonce, ou, timestamp };
  if (opType && opType !== "standard") obj.op_type = opType;
  if (encryptedData) obj.encrypted_data = encryptedData;
  // message excluded
  return JSON.stringify(obj);
}

// Approach 2: webcli style — include op_type always, include message
function buildCanonicalV2(to_, amount, ou, opType, encryptedData, message) {
  let s = `{"from":"${ADDRESS}","to_":"${to_}","amount":"${amount}","nonce":${nonce},"ou":"${ou}","timestamp":${timestamp},"op_type":"${opType}"`;
  if (encryptedData) s += `,"encrypted_data":"${encryptedData}"`;
  if (message) s += `,"message":"${escape_json(message)}"`;
  s += "}";
  return s;
}

// Approach 3: webcli style but WITHOUT message in signature
function buildCanonicalV3(to_, amount, ou, opType, encryptedData) {
  let s = `{"from":"${ADDRESS}","to_":"${to_}","amount":"${amount}","nonce":${nonce},"ou":"${ou}","timestamp":${timestamp},"op_type":"${opType}"`;
  if (encryptedData) s += `,"encrypted_data":"${encryptedData}"`;
  s += "}";
  return s;
}

function escape_json(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

// Test with a tiny 0-value tx to the same address, standard op
// This won't actually do anything useful but will tell us if signing works
const to_ = ADDRESS; // send to self
const amount = "0";

for (const [label, canonical, message] of [
  ["V1: pre_client (no message, no op_type)", buildCanonicalV1(to_, amount, "1", "standard", "", ""), undefined],
  ["V2: webcli (no message needed)", buildCanonicalV2(to_, amount, "1", "standard", "", ""), undefined],
  ["V3: webcli sans message in sig", buildCanonicalV3(to_, amount, "1", "standard", ""), undefined],
]) {
  console.log(`\n── ${label}`);
  console.log("Canonical:", canonical.slice(0, 120));
  const sig = sign(canonical);
  const tx = { from: ADDRESS, to_: to_, amount, nonce, ou: "1", timestamp, signature: sig, public_key: PUB_B64 };
  if (message !== undefined) tx.message = message;
  const result = await rpc("octra_submit", [tx]);
  console.log("Result:", JSON.stringify(result).slice(0, 200));
}
