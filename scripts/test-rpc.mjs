import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WALLET = readFileSync(join(__dirname, "../WALLET.txt"), "utf8");
const PRIV_KEY = WALLET.match(/PRIVATE_KEY:\s*(\S+)/)?.[1];
const ADDRESS = WALLET.match(/ADDRESS:\s*(\S+)/)?.[1];

const RPC = "https://octra.network/rpc";

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: Math.random() }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`${method}: ${JSON.stringify(data.error)}`);
  return data.result;
}

const WASM_PATH = join(__dirname, "../circles/target/wasm32-unknown-unknown/release/identity_registry.wasm");
const wasmBytes = readFileSync(WASM_PATH);
const wasmB64 = wasmBytes.toString("base64");

console.log("Registry address:", ADDRESS);
console.log("WASM size:", wasmBytes.length, "bytes");
console.log("WASM b64 size:", wasmB64.length, "chars");

// Test 1: balance
const bal = await rpc("octra_balance", [ADDRESS]);
console.log("\noctra_balance:", JSON.stringify(bal));

// Test 2: compute circle address
console.log("\nTrying octra_computeContractAddress...");
try {
  const circleId = await rpc("octra_computeContractAddress", [wasmB64, ADDRESS, 1]);
  console.log("circle_id:", circleId);
} catch (e) {
  console.log("octra_computeContractAddress failed:", e.message);

  // Try alternative method names
  for (const method of ["octra_computeCircleAddress", "octra_circleComputeAddress", "octra_getCircleAddress"]) {
    try {
      const r = await rpc(method, [wasmB64, ADDRESS, 1]);
      console.log(`${method} worked:`, r);
    } catch (e2) {
      console.log(`${method}:`, e2.message.slice(0, 80));
    }
  }
}
