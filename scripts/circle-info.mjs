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

const IDENTITY = "octGihgCoxjJ2GdWV2M1jQwrFLs9PPB6MovAHsFqNMmm9WR";

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
  });
  return res.json();
}

function sign(msg) {
  return Buffer.from(ed.sign(Buffer.from(msg, "utf8"), PRIV_BYTES)).toString("base64");
}

// circle_info (no auth)
console.log("=== circle_info (no auth) ===");
const info = await rpc("circle_info", [IDENTITY]);
console.log(JSON.stringify(info, null, 2));

// octra_circleInfoAuth
console.log("\n=== octra_circleInfoAuth ===");
const sig = sign(`octra_circle_info|${IDENTITY}|${ADDRESS}`);
const authInfo = await rpc("octra_circleInfoAuth", [IDENTITY, ADDRESS, PUB_B64, sig]);
console.log(JSON.stringify(authInfo, null, 2));

// octra_circleProgramInfo
console.log("\n=== octra_circleProgramInfo ===");
const progInfo = await rpc("octra_circleProgramInfo", [IDENTITY]);
console.log(JSON.stringify(progInfo, null, 2));

// octra_circleProgramInfoAuth
console.log("\n=== octra_circleProgramInfoAuth ===");
const progSig = sign(`octra_circle_program_info|${IDENTITY}|${ADDRESS}`);
const progAuthInfo = await rpc("octra_circleProgramInfoAuth", [IDENTITY, ADDRESS, PUB_B64, progSig]);
console.log(JSON.stringify(progAuthInfo, null, 2));

// Try storage dump
console.log("\n=== octra_circleStorageDumpAuth ===");
const storeSig = sign(`octra_circle_storage_dump|${IDENTITY}|${ADDRESS}`);
const storeInfo = await rpc("octra_circleStorageDumpAuth", [IDENTITY, ADDRESS, PUB_B64, storeSig]);
console.log(JSON.stringify(storeInfo, null, 2));
