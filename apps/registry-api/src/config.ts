import { walletFromPrivateKey } from "@octraid/octra-rpc";

function require_env(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional_env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: parseInt(optional_env("PORT", "3000"), 10),
  rpcUrl: optional_env("OCTRA_RPC_URL", "https://octra.network"),
  databaseUrl: optional_env("DATABASE_URL", "file:./octraid.db").replace("file:", ""),
  registryPrivateKey: optional_env("REGISTRY_PRIVATE_KEY", ""),
  registryAddress: optional_env("REGISTRY_ADDRESS", ""),
  identityCircleId: optional_env("IDENTITY_CIRCLE_ID", ""),
  reputationCircleId: optional_env("REPUTATION_CIRCLE_ID", ""),
  mandateCircleId: optional_env("MANDATE_CIRCLE_ID", ""),
  // JWT signing secret derived from registry private key (HMAC-SHA256)
  jwtSecret: optional_env("JWT_SECRET", "octraid-dev-secret-change-in-production"),
  // Attestation validity window in seconds
  attestationTtlSeconds: 3600,
};

export type Config = typeof config;
