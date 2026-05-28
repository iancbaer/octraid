import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "crypto";
import { getDb } from "../db";
import { reputation as rep, mandate as mand } from "../circles";
import { signThresholdAttestation, signMandateAttestation, verifyAttestation } from "../attestation";
import { SignJWT } from "jose";
import { config } from "../config";

export const handshakeRouter = Router();

function generateChallengeId(): string {
  return "ch_" + randomBytes(16).toString("hex");
}

function generateNonce(): string {
  return randomBytes(32).toString("base64url");
}

function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

// POST /v1/handshake/initiate
// Agent A starts a trust handshake by declaring itself and what scope it needs
handshakeRouter.post("/initiate", async (req, res) => {
  const body = z.object({
    agentIdA: z.string().startsWith("agt_"),
    requestedScopeHash: z.string(),
    timestamp: z.number(),
  }).safeParse(req.body);

  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const { agentIdA, requestedScopeHash, timestamp } = body.data;

  // Reject stale requests (>5 minute window)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return res.status(400).json({ error: "Stale timestamp" });
  }

  const challengeId = generateChallengeId();
  const nonce = generateNonce();
  const expiresAt = now + 600; // challenge valid for 10 minutes

  getDb().prepare(`
    INSERT INTO handshakes (challenge_id, agent_id_a, requested_scope_hash, nonce, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(challengeId, agentIdA, requestedScopeHash, nonce, expiresAt);

  return res.status(201).json({ challengeId, nonce });
});

// POST /v1/handshake/respond
// Agent B responds with its attestations
handshakeRouter.post("/respond", async (req, res) => {
  const body = z.object({
    challengeId: z.string().startsWith("ch_"),
    agentIdB: z.string().startsWith("agt_"),
    signedNonce: z.string(), // Agent B's signature over the nonce (proves identity)
    reputationAttestation: z.string().optional(), // JWT from prove-threshold
    mandateAttestation: z.string().optional(),    // JWT from verify-mandate
  }).safeParse(req.body);

  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const { challengeId, agentIdB, reputationAttestation, mandateAttestation } = body.data;

  const handshake = getDb()
    .prepare("SELECT * FROM handshakes WHERE challenge_id = ? AND status = 'pending'")
    .get(challengeId) as Record<string, unknown> | undefined;

  if (!handshake) return res.status(404).json({ error: "Challenge not found or already used" });

  const now = Math.floor(Date.now() / 1000);
  if (now > (handshake.expires_at as number)) {
    return res.status(400).json({ error: "Challenge expired" });
  }

  // Verify reputation attestation if provided
  let reputationValid = false;
  if (reputationAttestation) {
    try {
      const payload = await verifyAttestation(reputationAttestation);
      reputationValid = (payload.agentId === agentIdB) && (payload.aboveThreshold === true);
    } catch { /* invalid or expired attestation */ }
  }

  // Verify mandate attestation if provided
  let mandateValid = false;
  if (mandateAttestation) {
    try {
      const payload = await verifyAttestation(mandateAttestation);
      mandateValid = (payload.agentId === agentIdB)
        && (payload.scopeHash === handshake.requested_scope_hash)
        && (payload.valid === true);
    } catch { /* invalid or expired attestation */ }
  }

  getDb().prepare(`
    UPDATE handshakes SET agent_id_b = ?, status = 'responded' WHERE challenge_id = ?
  `).run(agentIdB, challengeId);

  return res.json({ challengeId, reputationValid, mandateValid });
});

// POST /v1/handshake/verify
// Either party queries the final trust decision and receives a session token
handshakeRouter.post("/verify", async (req, res) => {
  const body = z.object({ challengeId: z.string().startsWith("ch_") }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const handshake = getDb()
    .prepare("SELECT * FROM handshakes WHERE challenge_id = ?")
    .get(body.data.challengeId) as Record<string, unknown> | undefined;

  if (!handshake) return res.status(404).json({ error: "Challenge not found" });
  if (handshake.status === "verified" && handshake.session_token) {
    return res.json({ trusted: true, sessionToken: handshake.session_token, expiresAt: handshake.expires_at });
  }
  if (handshake.status !== "responded") {
    return res.json({ trusted: false, reason: "Handshake not yet responded to" });
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionToken = generateSessionToken();
  const sessionExpiresAt = now + 3600; // 1 hour

  getDb().prepare(`
    UPDATE handshakes SET status = 'verified', session_token = ?, expires_at = ? WHERE challenge_id = ?
  `).run(sessionToken, sessionExpiresAt, handshake.challenge_id as string);

  return res.json({ trusted: true, sessionToken, expiresAt: sessionExpiresAt });
});

// POST /v1/handshake/validate — verify a session token is still valid
handshakeRouter.post("/validate", async (req, res) => {
  const body = z.object({ sessionToken: z.string() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const session = getDb()
    .prepare("SELECT * FROM handshakes WHERE session_token = ? AND status = 'verified'")
    .get(body.data.sessionToken) as Record<string, unknown> | undefined;

  if (!session) return res.json({ valid: false });

  const now = Math.floor(Date.now() / 1000);
  const valid = now < (session.expires_at as number);

  return res.json({
    valid,
    agentIdA: session.agent_id_a,
    agentIdB: session.agent_id_b,
    expiresAt: session.expires_at,
  });
});
