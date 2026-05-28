/**
 * Verify all three Circles are live by calling view methods.
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
ed.etc.sha512Sync = (...msgs) => sha512(ed.etc.concatBytes(...msgs));

import { readFileSync } from "fs";
import { createHash } from "crypto";
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

const IDENTITY_CIRCLE   = "octGihgCoxjJ2GdWV2M1jQwrFLs9PPB6MovAHsFqNMmm9WR";
const REPUTATION_CIRCLE = "octJ78X2LsNDobLf6v2XdKf1MykUegpf4XixkiFwtfkBkhp";
const MANDATE_CIRCLE    = "oct5nLKsDTtVBjsZpB2rVaAvFihMGD4MzSuExuaLDkpgv3a";

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
  });
  return res.json();
}

// Signing format from webcli lib/tx_builder.hpp + main.cpp:
// sign_circle_view_request: subject = method|sha256_hex(params.dump())|include_storage
// full msg = "octra_circle_view|circle_id|addr|subject"
// Signing: "octra_circle_view|circle_id|addr|method|sha256(params.dump())|include_storage"
// params.dump() of a JSON array = JSON.stringify(params)
function signCircleView(circleId, method, params, includeStorage = false) {
  const paramsDump = JSON.stringify(params); // matches nlohmann::json params.dump()
  const paramsHash = createHash("sha256").update(paramsDump).digest("hex");
  const subject = `${method}|${paramsHash}|${includeStorage ? "1" : "0"}`;
  const msg = `octra_circle_view|${circleId}|${ADDRESS}|${subject}`;
  const sig = ed.sign(Buffer.from(msg, "utf8"), PRIV_BYTES);
  return Buffer.from(sig).toString("base64");
}

async function circleView(circleId, method, params = []) {
  const sig = signCircleView(circleId, method, params, false);
  // Pass params as actual JSON array (not JSON string) — matches nlohmann::json const json& params
  const result = await rpc("octra_circleViewAuth", [circleId, method, params, ADDRESS, PUB_B64, sig, false]);
  return result;
}

console.log("=== Verifying OctraID Circles ===\n");

for (const [name, id, method] of [
  ["Identity Registry",   IDENTITY_CIRCLE,   "get_total_agents"],
  ["Reputation Registry", REPUTATION_CIRCLE, "get_event_count"],
  ["Mandate Registry",    MANDATE_CIRCLE,    "get_active_mandate_count"],
]) {
  process.stdout.write(`[${name}] ${id.slice(0, 16)}... → ${method}()`);
  try {
    const r = await circleView(id, method, ["agt_test"]);
    if (r.error) {
      console.log(` → error: ${JSON.stringify(r.error)}`);
    } else {
      console.log(` → ${JSON.stringify(r.result)}`);
    }
  } catch (e) {
    console.log(` → exception: ${e.message}`);
  }
}
