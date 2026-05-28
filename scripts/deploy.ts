/**
 * Deploy all three OctraID Circles to the Octra Network.
 *
 * Usage:
 *   REGISTRY_PRIVATE_KEY=<key> npx tsx scripts/deploy.ts
 *
 * Prerequisites:
 *   1. Fund the registry wallet (address in WALLET.txt) with enough OCT for Circle deployment
 *   2. Install Rust + wasm32-unknown-unknown target
 *   3. Build the Circles: cd circles && cargo build --target wasm32-unknown-unknown --release
 *   4. Run this script
 *
 * After successful deployment, copy the output addresses into .env
 */

import { OctraRpcClient, walletFromPrivateKey } from "@octraid/octra-rpc";
import { readFileSync } from "fs";
import { join } from "path";

const CIRCLES_DIR = join(__dirname, "../circles/target/wasm32-unknown-unknown/release");

async function deploy() {
  const privateKey = process.env.REGISTRY_PRIVATE_KEY;
  if (!privateKey) throw new Error("REGISTRY_PRIVATE_KEY required");

  const wallet = walletFromPrivateKey(privateKey);
  console.log(`Registry address: ${wallet.address}`);

  const client = new OctraRpcClient({
    rpcUrl: process.env.OCTRA_RPC_URL ?? "https://octra.network",
    privateKey,
  });

  const bal = await client.getBalance(wallet.address);
  console.log(`Balance: ${Number(bal.balance) / 1_000_000} OCT`);
  if (bal.balance === 0n) {
    throw new Error("Registry wallet has no balance. Fund it before deploying.");
  }

  // Deploy Identity Registry
  console.log("\nDeploying Identity Registry...");
  const identityWasm = readFileSync(join(CIRCLES_DIR, "identity_registry.wasm"));
  const identityCircleId = await client.deployCircle(identityWasm, []);
  console.log(`  Identity Circle: ${identityCircleId}`);

  // Deploy Reputation Registry
  console.log("Deploying Reputation Registry...");
  const reputationWasm = readFileSync(join(CIRCLES_DIR, "reputation_registry.wasm"));
  const reputationCircleId = await client.deployCircle(reputationWasm, []);
  console.log(`  Reputation Circle: ${reputationCircleId}`);

  // Deploy Mandate Registry
  console.log("Deploying Mandate Registry...");
  const mandateWasm = readFileSync(join(CIRCLES_DIR, "mandate_registry.wasm"));
  const mandateCircleId = await client.deployCircle(mandateWasm, []);
  console.log(`  Mandate Circle: ${mandateCircleId}`);

  console.log("\n=== Deployment complete ===");
  console.log("Add to .env:");
  console.log(`IDENTITY_CIRCLE_ID=${identityCircleId}`);
  console.log(`REPUTATION_CIRCLE_ID=${reputationCircleId}`);
  console.log(`MANDATE_CIRCLE_ID=${mandateCircleId}`);
  console.log(`REGISTRY_ADDRESS=${wallet.address}`);
}

deploy().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
