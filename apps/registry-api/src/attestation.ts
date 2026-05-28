import { SignJWT, jwtVerify } from "jose";
import { config } from "./config";

function getSecret(): Uint8Array {
  return new TextEncoder().encode(config.jwtSecret);
}

export interface ThresholdAttestation {
  agentId: string;
  threshold: number;
  aboveThreshold: boolean;
  tier: string;
  commitment: string;
  attestedAt: number;
  expiresAt: number;
}

export async function signThresholdAttestation(
  agentId: string,
  threshold: number,
  aboveThreshold: boolean,
  tier: string,
  commitment: string,
): Promise<{ attestation: ThresholdAttestation; token: string }> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + config.attestationTtlSeconds;

  const attestation: ThresholdAttestation = {
    agentId,
    threshold,
    aboveThreshold,
    tier,
    commitment,
    attestedAt: now,
    expiresAt,
  };

  const token = await new SignJWT({ ...attestation, type: "threshold_attestation" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setIssuer("octraid-registry")
    .sign(getSecret());

  return { attestation, token };
}

export interface MandateAttestation {
  agentId: string;
  scopeHash: string;
  valid: boolean;
  mandateId: string | null;
  expiresAt: number | null;
  remainingBudget: number | null;
  attestedAt: number;
  tokenExpiresAt: number;
}

export async function signMandateAttestation(
  agentId: string,
  scopeHash: string,
  valid: boolean,
  mandateId: string | null,
  expiresAt: number | null,
  remainingBudget: number | null,
): Promise<{ attestation: MandateAttestation; token: string }> {
  const now = Math.floor(Date.now() / 1000);
  const tokenExpiresAt = now + config.attestationTtlSeconds;

  const attestation: MandateAttestation = {
    agentId,
    scopeHash,
    valid,
    mandateId,
    expiresAt,
    remainingBudget,
    attestedAt: now,
    tokenExpiresAt,
  };

  const token = await new SignJWT({ ...attestation, type: "mandate_attestation" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(tokenExpiresAt)
    .setIssuer("octraid-registry")
    .sign(getSecret());

  return { attestation, token };
}

export async function verifyAttestation(token: string): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(token, getSecret(), { issuer: "octraid-registry" });
  return payload as Record<string, unknown>;
}
