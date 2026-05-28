import "dotenv/config";
import express from "express";
import { config } from "./config";
import { agentsRouter } from "./routes/agents";
import { reputationRouter } from "./routes/reputation";
import { mandatesRouter } from "./routes/mandates";
import { handshakeRouter } from "./routes/handshake";

const app = express();
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: "0.1.0" });
});

// Network stats — served from local DB cache
app.get("/v1/stats", async (_req, res) => {
  try {
    const { getDb } = await import("./db");
    const db = getDb();
    const agentCount = (db.prepare("SELECT COUNT(*) as c FROM agents WHERE status = 'Active'").get() as { c: number }).c;
    const mandateCount = (db.prepare("SELECT COUNT(*) as c FROM mandates WHERE status = 'Active'").get() as { c: number }).c;
    const eventCount = (db.prepare("SELECT COUNT(*) as c FROM reputation_events").get() as { c: number }).c;
    res.json({ agentCount, mandateCount, eventCount });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.use("/v1/agents", agentsRouter);
app.use("/v1/reputation", reputationRouter);
app.use("/v1/mandates", mandatesRouter);
app.use("/v1/handshake", handshakeRouter);

// 404
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(config.port, () => {
  console.log(`OctraID Registry API running on port ${config.port}`);
  console.log(`Registry address: ${config.registryAddress || "(not configured)"}`);
});

export default app;
