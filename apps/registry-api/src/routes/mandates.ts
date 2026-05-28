import { Router } from "express";
import { z } from "zod";
import { createHash } from "crypto";
import { getDb } from "../db";
import { mandate as mand } from "../circles";
import { signMandateAttestation } from "../attestation";

export const mandatesRouter = Router();

const IssueBody = z.object({
  agentId: z.string().startsWith("agt_"),
  principalAddress: z.string().regex(/^oct[1-9A-HJ-NP-Za-km-z]{44}$/),
  // scope is the plaintext JSON object — we hash it before sending on-chain
  scope: z.record(z.unknown()),
  maxValueOct: z.number().min(0).default(0),
  totalBudgetOct: z.number().min(0).default(0),
  validForHours: z.number().min(1).max(8760),
});

// POST /v1/mandates/issue
mandatesRouter.post("/issue", async (req, res) => {
  const body = IssueBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const { agentId, principalAddress, scope, maxValueOct, totalBudgetOct, validForHours } = body.data;

  // Hash scope before it touches the chain. Scope contents never leave this server.
  const scopeHash = createHash("sha256").update(JSON.stringify(scope)).digest("hex");
  const now = Math.floor(Date.now() / 1000);
  const validFrom = now;
  const validUntil = now + validForHours * 3600;

  // Epochs: we use unix timestamps as proxy epoch values.
  // When Circle is live, map to actual epoch numbers via the indexer.
  try {
    const mandateId = await mand.issue(
      agentId,
      principalAddress,
      scopeHash,
      Math.round(maxValueOct * 1_000_000),
      Math.round(totalBudgetOct * 1_000_000),
      validFrom,
      validUntil,
    );

    getDb().prepare(`
      INSERT OR IGNORE INTO mandates
        (mandate_id, agent_id, principal_address, scope_hash, max_value, total_budget, spent, valid_from, valid_until, status, issued_epoch)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'Active', 0)
    `).run(
      mandateId, agentId, principalAddress, scopeHash,
      maxValueOct > 0 ? Math.round(maxValueOct * 1_000_000) : null,
      totalBudgetOct > 0 ? Math.round(totalBudgetOct * 1_000_000) : null,
      validFrom, validUntil,
    );

    return res.status(201).json({ mandateId, scopeHash });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// POST /v1/mandates/verify
mandatesRouter.post("/verify", async (req, res) => {
  const body = z.object({
    agentId: z.string().startsWith("agt_"),
    scopeHash: z.string(),
  }).safeParse(req.body);

  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const { agentId, scopeHash } = body.data;

  try {
    const result = await mand.verifyMandate(agentId, scopeHash);
    const { attestation, token } = await signMandateAttestation(
      agentId,
      scopeHash,
      result.valid,
      result.mandate_id,
      result.expires_at,
      result.remaining_budget,
    );
    return res.json({ attestation, token });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// POST /v1/mandates/:id/revoke
mandatesRouter.post("/:id/revoke", async (req, res) => {
  try {
    await mand.revoke(req.params.id);
    getDb().prepare("UPDATE mandates SET status = 'Revoked' WHERE mandate_id = ?").run(req.params.id);
    return res.json({ revoked: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// GET /v1/agents/:agentId/mandates — count only, not contents
mandatesRouter.get("/agents/:agentId/mandates", async (req, res) => {
  try {
    const count = await mand.getActiveMandateCount(req.params.agentId);
    return res.json({ agentId: req.params.agentId, activeMandateCount: count });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});
