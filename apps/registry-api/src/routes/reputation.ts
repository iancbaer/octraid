import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db";
import { reputation as rep } from "../circles";
import { signThresholdAttestation } from "../attestation";

export const reputationRouter = Router();

const EVENT_TYPES = [
  "TransactionCompleted",
  "TransactionFailed",
  "UnauthorizedAttempt",
  "Vouched",
  "DisputeLost",
  "DisputeWon",
] as const;

const EVENT_DELTAS: Record<string, number> = {
  TransactionCompleted: 1,
  TransactionFailed: -2,
  UnauthorizedAttempt: -10,
  Vouched: 5,
  DisputeLost: -20,
  DisputeWon: 10,
};

const SubmitEventBody = z.object({
  agentId: z.string().startsWith("agt_"),
  eventType: z.enum(EVENT_TYPES),
  evidenceUri: z.string().default(""),
});

// POST /v1/reputation/event
reputationRouter.post("/event", async (req, res) => {
  const body = SubmitEventBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const { agentId, eventType, evidenceUri } = body.data;

  // Verify agent exists before submitting event
  const agent = getDb().prepare("SELECT agent_id FROM agents WHERE agent_id = ? AND status = 'Active'").get(agentId);
  if (!agent) return res.status(404).json({ error: "Agent not found or not active" });

  try {
    const eventId = await rep.submitEvent(agentId, eventType, evidenceUri);
    const delta = EVENT_DELTAS[eventType] ?? 0;
    const now = Math.floor(Date.now() / 1000);

    // Update local index
    getDb().prepare(`
      INSERT INTO reputation_events (agent_id, event_type, reporter, delta, epoch, evidence_uri, created_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(agentId, eventType, req.body.reporterAddress ?? "unknown", delta, evidenceUri, now);

    // Refresh cached score from Circle
    try {
      const score = await rep.getScore(agentId);
      getDb().prepare(`
        INSERT INTO reputation_scores (agent_id, score, trust_tier, last_updated_epoch, event_count, updated_at)
        VALUES (?, ?, ?, ?, 1, ?)
        ON CONFLICT(agent_id) DO UPDATE SET
          score = excluded.score,
          trust_tier = excluded.trust_tier,
          last_updated_epoch = excluded.last_updated_epoch,
          event_count = event_count + 1,
          updated_at = excluded.updated_at
      `).run(agentId, score.score, score.trust_tier, score.last_updated_epoch, now);
    } catch { /* indexing failure is non-fatal */ }

    return res.status(201).json({ eventId });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// GET /v1/reputation/:agentId — returns tier only, never raw score
reputationRouter.get("/:agentId", async (req, res) => {
  const { agentId } = req.params;

  // Try local cache first
  const cached = getDb()
    .prepare("SELECT trust_tier, event_count, updated_at FROM reputation_scores WHERE agent_id = ?")
    .get(agentId) as { trust_tier: string; event_count: number; updated_at: number } | undefined;

  if (cached) {
    return res.json({
      agentId,
      tier: cached.trust_tier,
      eventCount: cached.event_count,
      // Note: actual score is NOT returned — privacy by default
    });
  }

  // Fallback to Circle query
  try {
    const tier = await rep.getTier(agentId);
    const count = await rep.getEventCount(agentId);
    return res.json({ agentId, tier, eventCount: count });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// POST /v1/reputation/prove-threshold
reputationRouter.post("/prove-threshold", async (req, res) => {
  const body = z.object({
    agentId: z.string().startsWith("agt_"),
    threshold: z.number().int().min(0),
  }).safeParse(req.body);

  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const { agentId, threshold } = body.data;

  try {
    const proof = await rep.proveThreshold(agentId, threshold);
    const { attestation, token } = await signThresholdAttestation(
      agentId,
      threshold,
      proof.above_threshold,
      proof.tier,
      proof.commitment,
    );
    return res.json({ attestation, token });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});
