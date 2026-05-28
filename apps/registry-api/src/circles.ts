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

// Identity Registry Circle calls
export const identity = {
  async register(agentAddress: string, principalAddress: string, agentUri: string): Promise<string> {
    const result = await client().callCircle(config.identityCircleId, "register", [
      agentAddress,
      principalAddress,
      agentUri,
    ]);
    return result as string;
  },

  async setAgentUri(agentId: string, newUri: string): Promise<boolean> {
    return client().callCircle(config.identityCircleId, "set_agent_uri", [agentId, newUri]) as Promise<boolean>;
  },

  async setStatus(agentId: string, status: "Active" | "Suspended" | "Revoked"): Promise<boolean> {
    return client().callCircle(config.identityCircleId, "set_status", [agentId, status]) as Promise<boolean>;
  },

  async getAgent(agentId: string): Promise<unknown> {
    return client().queryCircle(config.identityCircleId, "get_agent", [agentId]);
  },

  async getAgentsByPrincipal(principalAddress: string): Promise<string[]> {
    const result = await client().queryCircle(config.identityCircleId, "get_agents_by_principal", [principalAddress]);
    const list = (result as string) ?? "";
    return list ? list.split(",").map((s) => s.trim()).filter(Boolean) : [];
  },

  async getTotalAgents(): Promise<number> {
    const result = await client().queryCircle(config.identityCircleId, "get_total_agents", []);
    return parseInt(result as string, 10) || 0;
  },
};

// Reputation Registry Circle calls
export const reputation = {
  async submitEvent(
    agentId: string,
    eventType: string,
    evidenceUri: string,
  ): Promise<number> {
    const result = await client().callCircle(config.reputationCircleId, "submit_event", [
      agentId,
      eventType,
      evidenceUri,
    ]);
    return parseInt(result as string, 10);
  },

  async getScore(agentId: string): Promise<{ agent_id: string; score: number; trust_tier: string; last_updated_epoch: number }> {
    const result = await client().queryCircle(config.reputationCircleId, "get_score", [agentId]);
    return JSON.parse(result as string);
  },

  async proveThreshold(agentId: string, threshold: number): Promise<{
    agent_id: string;
    threshold: number;
    above_threshold: boolean;
    tier: string;
    commitment: string;
    epoch: number;
  }> {
    const result = await client().queryCircle(config.reputationCircleId, "prove_threshold", [agentId, threshold]);
    return JSON.parse(result as string);
  },

  async getTier(agentId: string): Promise<string> {
    return client().queryCircle(config.reputationCircleId, "get_tier", [agentId]) as Promise<string>;
  },

  async getEventCount(agentId: string): Promise<number> {
    const result = await client().queryCircle(config.reputationCircleId, "get_event_count", [agentId]);
    return parseInt(result as string, 10) || 0;
  },
};

// Mandate Registry Circle calls
export const mandate = {
  async issue(
    agentId: string,
    principalAddress: string,
    scopeHash: string,
    maxValue: number,
    totalBudget: number,
    validFrom: number,
    validUntil: number,
  ): Promise<string> {
    const result = await client().callCircle(config.mandateCircleId, "issue", [
      agentId,
      principalAddress,
      scopeHash,
      maxValue,
      totalBudget,
      validFrom,
      validUntil,
    ]);
    return result as string;
  },

  async revoke(mandateId: string): Promise<boolean> {
    return client().callCircle(config.mandateCircleId, "revoke", [mandateId]) as Promise<boolean>;
  },

  async recordSpend(mandateId: string, amount: number): Promise<boolean> {
    return client().callCircle(config.mandateCircleId, "record_spend", [mandateId, amount]) as Promise<boolean>;
  },

  async verifyMandate(agentId: string, scopeHash: string): Promise<{
    valid: boolean;
    mandate_id: string | null;
    expires_at: number | null;
    remaining_budget: number | null;
  }> {
    const result = await client().queryCircle(config.mandateCircleId, "verify_mandate", [agentId, scopeHash]);
    return JSON.parse(result as string);
  },

  async getActiveMandateCount(agentId: string): Promise<number> {
    const result = await client().queryCircle(config.mandateCircleId, "get_active_mandate_count", [agentId]);
    return parseInt(result as string, 10) || 0;
  },
};
