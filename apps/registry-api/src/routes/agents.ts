import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db";
import { identity } from "../circles";
import { createHash } from "crypto";

export const agentsRouter = Router();

const RegisterBody = z.object({
  agentAddress: z.string().regex(/^oct[1-9A-HJ-NP-Za-km-z]{44}$/),
  principalAddress: z.string().regex(/^oct[1-9A-HJ-NP-Za-km-z]{44}$/),
  agentUri: z.string().url(),
});

// POST /v1/agents/register
agentsRouter.post("/register", async (req, res) => {
  const body = RegisterBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const { agentAddress, principalAddress, agentUri } = body.data;

  try {
    const agentId = await identity.register(agentAddress, principalAddress, agentUri);
    const now = Math.floor(Date.now() / 1000);

    getDb().prepare(`
      INSERT OR IGNORE INTO agents (agent_id, agent_address, principal_address, agent_uri, registered_at, registered_epoch, status)
      VALUES (?, ?, ?, ?, ?, ?, 'Active')
    `).run(agentId, agentAddress, principalAddress, agentUri, now, 0);

    return res.status(201).json({ agentId });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// GET /v1/agents/:agentId
agentsRouter.get("/:agentId", async (req, res) => {
  const { agentId } = req.params;
  const row = getDb().prepare("SELECT * FROM agents WHERE agent_id = ?").get(agentId) as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ error: "Agent not found" });

  // Never expose principal_address in the public response — privacy by default
  const { principal_address: _, ...safe } = row;
  return res.json(safe);
});

// GET /v1/agents/by-address/:addr
agentsRouter.get("/by-address/:addr", async (req, res) => {
  const row = getDb()
    .prepare("SELECT * FROM agents WHERE agent_address = ?")
    .get(req.params.addr) as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ error: "Agent not found" });
  const { principal_address: _, ...safe } = row;
  return res.json(safe);
});

// POST /v1/agents/:agentId/revoke
agentsRouter.post("/:agentId/revoke", async (req, res) => {
  const { agentId } = req.params;
  try {
    await identity.setStatus(agentId, "Revoked");
    getDb().prepare("UPDATE agents SET status = 'Revoked' WHERE agent_id = ?").run(agentId);
    return res.json({ revoked: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// GET /v1/principals/:addr/agents
agentsRouter.get("/principals/:addr/agents", async (req, res) => {
  const rows = getDb()
    .prepare("SELECT agent_id, agent_address, agent_uri, registered_at, status FROM agents WHERE principal_address = ?")
    .all(req.params.addr) as Record<string, unknown>[];
  return res.json({ agents: rows });
});
