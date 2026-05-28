/**
 * Circle interaction layer.
 *
 * Architecture note: sealed Circles with resource_mode "sealed_read" require a Circle Relayer
 * for WASM view execution via octra_circleViewAuth. Since we don't run a local relayer,
 * we use direct storage reads (octra_circleStorageAuth / octra_circleStorageDumpAuth) for
 * read operations. This is safe: the registry owns the Circles and has sealed_read access.
 *
 * For write operations we use circle_call transactions (op_type: "circle_call").
 *
 * Cross-Circle validation (e.g. verifying a reporter is a registered agent before
 * accepting a reputation event) is handled here in the off-chain API layer.
 * Upgrade path: cross-Circle calls when supported by the Octra runtime.
 */
import { OctraRpcClient } from "@octraid/octra-rpc";
import { config } from "./config";

let _client: OctraRpcClient | null = null;

function client(): OctraRpcClient {
  if (!_client) {
    _client = new OctraRpcClient({
      rpcUrl: config.rpcUrl,
      privateKey: config.registryPrivateKey || undefined,
    });
  }
  return _client;
}

const M64 = 0xffffffffffffffffn;

// Derive agent_id: mirrors circles/identity-registry/src/lib.rs derive_agent_id()
// djb2 forward pass, then 0x9e3779b97f4a7c15*31+b reverse pass, XOR-fold to 64-bit
export function deriveAgentId(agentAddress: string): string {
  const bytes = Buffer.from(agentAddress, "utf8");
  let h = 5381n;
  for (const b of bytes) h = (h * 33n + BigInt(b)) & M64;
  let h2 = 0x9e3779b97f4a7c15n;
  for (let i = bytes.length - 1; i >= 0; i--) h2 = (h2 * 31n + BigInt(bytes[i])) & M64;
  const combined = (h ^ ((h2 << 32n) & M64) ^ (h2 >> 32n)) & M64;
  return `agt_${combined.toString(16).padStart(16, "0")}`;
}

// Identity Registry Circle
export const identity = {
  async register(agentAddress: string, principalAddress: string, agentUri: string): Promise<string> {
    const result = await client().callCircle(config.identityCircleId, "register", [
      agentAddress, principalAddress, agentUri,
    ]) as { tx_hash?: string };
    // Derive the agent_id deterministically (same algorithm as Circle)
    return deriveAgentId(agentAddress);
  },

  async setAgentUri(agentId: string, newUri: string): Promise<boolean> {
    await client().callCircle(config.identityCircleId, "set_agent_uri", [agentId, newUri]);
    return true;
  },

  async setStatus(agentId: string, status: "Active" | "Suspended" | "Revoked"): Promise<boolean> {
    await client().callCircle(config.identityCircleId, "set_status", [agentId, status]);
    return true;
  },

  async getAgent(agentId: string): Promise<Record<string, unknown> | null> {
    const json = await client().readCircleStorage(config.identityCircleId, `agent:${agentId}`);
    if (!json) return null;
    try { return JSON.parse(json); } catch { return null; }
  },

  async getAgentsByPrincipal(principalAddress: string): Promise<string[]> {
    const list = await client().readCircleStorage(
      config.identityCircleId,
      `principal:${principalAddress}:agents`
    );
    if (!list) return [];
    return list.split(",").map(s => s.trim()).filter(Boolean);
  },

  async getTotalAgents(): Promise<number> {
    const count = await client().readCircleStorage(config.identityCircleId, "agents:count");
    return parseInt(count ?? "0", 10);
  },

  async isRegistered(agentId: string): Promise<boolean> {
    const json = await client().readCircleStorage(config.identityCircleId, `agent:${agentId}`);
    return !!json;
  },
};

// Reputation Registry Circle
export const reputation = {
  async submitEvent(agentId: string, eventType: string, evidenceUri: string): Promise<string> {
    const result = await client().callCircle(config.reputationCircleId, "submit_event", [
      agentId, eventType, evidenceUri,
    ]) as { tx_hash?: string };
    return result?.tx_hash ?? "";
  },

  async getScore(agentId: string): Promise<{ agent_id: string; score: number; trust_tier: string; last_updated_epoch: number }> {
    const json = await client().readCircleStorage(config.reputationCircleId, `score:${agentId}`);
    if (!json) {
      return { agent_id: agentId, score: 10, trust_tier: "Unverified", last_updated_epoch: 0 };
    }
    return JSON.parse(json);
  },

  async proveThreshold(agentId: string, threshold: number): Promise<{
    agent_id: string;
    threshold: number;
    above_threshold: boolean;
    tier: string;
    commitment: string;
    epoch: number;
  }> {
    // Read score from sealed Circle storage (registry has sealed_read access)
    const scoreRecord = await this.getScore(agentId);
    const score = scoreRecord.score;
    const above_threshold = score >= threshold;
    const tier = scoreRecord.trust_tier;
    // Commitment: deterministic hash of (agentId, threshold, above_threshold, epoch)
    // This is computed off-chain since the Circle relayer isn't available for view calls.
    // The API layer signs the full attestation with REGISTRY_PRIVATE_KEY.
    const { createHash } = require("crypto");
    const commitment = createHash("sha256")
      .update(`${agentId}:${threshold}:${above_threshold}:${scoreRecord.last_updated_epoch}`)
      .digest("hex");
    return {
      agent_id: agentId,
      threshold,
      above_threshold,
      tier,
      commitment,
      epoch: scoreRecord.last_updated_epoch,
    };
  },

  async getTier(agentId: string): Promise<string> {
    const record = await this.getScore(agentId);
    return record.trust_tier;
  },

  async getEventCount(agentId: string): Promise<number> {
    const count = await client().readCircleStorage(config.reputationCircleId, `events:count:${agentId}`);
    return parseInt(count ?? "0", 10);
  },
};

// Mandate Registry Circle
export const mandate = {
  async issue(
    agentId: string, principalAddress: string, scopeHash: string,
    maxValue: number, totalBudget: number, validFrom: number, validUntil: number,
  ): Promise<string> {
    const result = await client().callCircle(config.mandateCircleId, "issue", [
      agentId, principalAddress, scopeHash, maxValue, totalBudget, validFrom, validUntil,
    ]) as { tx_hash?: string };
    // Mandate ID is computed deterministically by the Circle; we mirror the algorithm
    return deriveMandateId(agentId, scopeHash, validFrom);
  },

  async revoke(mandateId: string): Promise<boolean> {
    await client().callCircle(config.mandateCircleId, "revoke", [mandateId]);
    return true;
  },

  async recordSpend(mandateId: string, amount: number): Promise<boolean> {
    await client().callCircle(config.mandateCircleId, "record_spend", [mandateId, amount]);
    return true;
  },

  async verifyMandate(agentId: string, scopeHash: string): Promise<{
    valid: boolean;
    mandate_id: string | null;
    expires_at: number | null;
    remaining_budget: number | null;
  }> {
    // Read agent's mandate list from storage, then check each mandate
    const list = await client().readCircleStorage(config.mandateCircleId, `agent:${agentId}:mandates`);
    if (!list) return { valid: false, mandate_id: null, expires_at: null, remaining_budget: null };

    const now = Math.floor(Date.now() / 1000);
    for (const mid of list.split(",").map(s => s.trim()).filter(Boolean)) {
      const json = await client().readCircleStorage(config.mandateCircleId, `mandate:${mid}`);
      if (!json) continue;
      const m = JSON.parse(json) as Record<string, unknown>;
      if (m.scope_hash !== scopeHash) continue;
      if (m.status !== "Active") continue;
      const validUntil = Number(m.valid_until);
      const validFrom = Number(m.valid_from);
      if (now < validFrom || now > validUntil) continue;
      const totalBudget = m.total_budget ? Number(m.total_budget) : null;
      const spent = Number(m.spent ?? 0);
      const remaining = totalBudget !== null ? totalBudget - spent : null;
      return { valid: true, mandate_id: mid, expires_at: validUntil, remaining_budget: remaining };
    }
    return { valid: false, mandate_id: null, expires_at: null, remaining_budget: null };
  },

  async getActiveMandateCount(agentId: string): Promise<number> {
    const list = await client().readCircleStorage(config.mandateCircleId, `agent:${agentId}:mandates`);
    if (!list) return 0;
    const now = Math.floor(Date.now() / 1000);
    let count = 0;
    for (const mid of list.split(",").map(s => s.trim()).filter(Boolean)) {
      const json = await client().readCircleStorage(config.mandateCircleId, `mandate:${mid}`);
      if (!json) continue;
      const m = JSON.parse(json) as Record<string, unknown>;
      if (m.status === "Active" && now <= Number(m.valid_until)) count++;
    }
    return count;
  },
};

// Mirror of the Rust deriveMandateId function for local ID prediction
function deriveMandateId(agentId: string, scopeHash: string, epoch: number): string {
  const input = `${agentId}:${scopeHash}:${epoch}`;
  let h1 = 5381n, h2 = 0xcbf29ce484222325n;
  for (const c of Buffer.from(input, "utf8")) {
    h1 = (h1 * 33n + BigInt(c)) & 0xffffffffffffffffn;
    h2 = h2 ^ BigInt(c);
    h2 = (h2 * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `mnd_${(h1 & 0xffffffffn).toString(16).padStart(8, "0")}${(h2 & 0xffffffffn).toString(16).padStart(8, "0")}`;
}
