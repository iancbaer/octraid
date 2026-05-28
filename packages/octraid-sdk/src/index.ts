import { createHash } from "crypto";

export interface OctraIDConfig {
  registryUrl?: string;
  agentId?: string;
  privateKey?: string;
}

export interface RegisterResult {
  agentId: string;
}

export interface VerifyResult {
  trusted: boolean;
  tier?: string;
  mandateValid?: boolean;
  sessionToken?: string;
}

export interface IssueMandateOptions {
  scope: Record<string, unknown>;
  validForHours: number;
  maxValueOct?: number;
  totalBudgetOct?: number;
}

export interface IssueMandateResult {
  mandateId: string;
  scopeHash: string;
}

export interface HandshakeResult {
  trusted: boolean;
  sessionToken?: string;
  expiresAt?: number;
}

export class OctraID {
  private registryUrl: string;
  private agentId?: string;
  private privateKey?: string;

  constructor(config: OctraIDConfig = {}) {
    this.registryUrl = (config.registryUrl ?? process.env.OCTRAID_REGISTRY_URL ?? "https://registry.octraid.network").replace(/\/$/, "");
    this.agentId = config.agentId;
    this.privateKey = config.privateKey;
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.registryUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OctraID API ${path} → ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  // Register a new agent. The caller's address becomes the principal.
  async register(options: { agentUri: string; agentAddress?: string; principalAddress?: string }): Promise<RegisterResult> {
    if (!this.agentId && !options.agentAddress) {
      throw new Error("agentAddress required when no agentId is configured");
    }
    return this.fetch<RegisterResult>("/v1/agents/register", {
      method: "POST",
      body: JSON.stringify({
        agentAddress: options.agentAddress ?? this.agentId,
        principalAddress: options.principalAddress,
        agentUri: options.agentUri,
      }),
    });
  }

  // Verify another agent — check reputation tier and mandate before interacting.
  async verify(agentId: string, options: {
    requiredScopeHash?: string;
    minimumTier?: "Unverified" | "Low" | "Standard" | "High";
  } = {}): Promise<VerifyResult> {
    const TIERS = ["Unverified", "Low", "Standard", "High"];
    const minTierIndex = TIERS.indexOf(options.minimumTier ?? "Unverified");

    // Get reputation tier
    const repResult = await this.fetch<{ agentId: string; tier: string; eventCount: number }>(
      `/v1/reputation/${agentId}`
    );
    const tierIndex = TIERS.indexOf(repResult.tier);
    const tierOk = tierIndex >= minTierIndex;

    // Check mandate if scope provided
    let mandateValid = false;
    if (options.requiredScopeHash) {
      try {
        const mandateResult = await this.fetch<{ attestation: { valid: boolean } }>(
          "/v1/mandates/verify",
          {
            method: "POST",
            body: JSON.stringify({ agentId, scopeHash: options.requiredScopeHash }),
          }
        );
        mandateValid = mandateResult.attestation.valid;
      } catch { /* no mandate */ }
    }

    return {
      trusted: tierOk && (!options.requiredScopeHash || mandateValid),
      tier: repResult.tier,
      mandateValid: options.requiredScopeHash ? mandateValid : undefined,
    };
  }

  // Issue a mandate to another agent. Caller must be the agent's principal.
  async issueMandateTo(agentId: string, options: IssueMandateOptions): Promise<IssueMandateResult> {
    return this.fetch<IssueMandateResult>("/v1/mandates/issue", {
      method: "POST",
      body: JSON.stringify({
        agentId,
        principalAddress: undefined, // set server-side from auth
        scope: options.scope,
        maxValueOct: options.maxValueOct ?? 0,
        totalBudgetOct: options.totalBudgetOct ?? 0,
        validForHours: options.validForHours,
      }),
    });
  }

  // Hash a scope object the same way the API does (sha256 of JSON).
  static hashScope(scope: Record<string, unknown>): string {
    return createHash("sha256").update(JSON.stringify(scope)).digest("hex");
  }

  // Report a reputation event about another agent.
  async reportEvent(
    agentId: string,
    eventType: "TransactionCompleted" | "TransactionFailed" | "UnauthorizedAttempt" | "Vouched" | "DisputeLost" | "DisputeWon",
    options: { evidenceUri?: string } = {},
  ): Promise<{ eventId: number }> {
    return this.fetch<{ eventId: number }>("/v1/reputation/event", {
      method: "POST",
      body: JSON.stringify({
        agentId,
        eventType,
        evidenceUri: options.evidenceUri ?? "",
        reporterAddress: this.agentId,
      }),
    });
  }

  // Get a signed threshold attestation — proves agent reputation >= threshold without revealing score.
  async proveThreshold(agentId: string, threshold: number): Promise<{
    attestation: {
      agentId: string;
      threshold: number;
      aboveThreshold: boolean;
      tier: string;
      commitment: string;
      attestedAt: number;
      expiresAt: number;
    };
    token: string;
  }> {
    return this.fetch("/v1/reputation/prove-threshold", {
      method: "POST",
      body: JSON.stringify({ agentId, threshold }),
    });
  }

  // Perform a trust handshake with another agent and get a session token.
  async handshake(targetAgentId: string, options: { requiredScopeHash?: string } = {}): Promise<HandshakeResult> {
    if (!this.agentId) throw new Error("agentId required for handshake");

    const timestamp = Math.floor(Date.now() / 1000);
    const { challengeId, nonce } = await this.fetch<{ challengeId: string; nonce: string }>(
      "/v1/handshake/initiate",
      {
        method: "POST",
        body: JSON.stringify({
          agentIdA: this.agentId,
          requestedScopeHash: options.requiredScopeHash ?? "",
          timestamp,
        }),
      }
    );

    // Respond on behalf of target agent (in practice, target agent calls this themselves)
    await this.fetch("/v1/handshake/respond", {
      method: "POST",
      body: JSON.stringify({ challengeId, agentIdB: targetAgentId, signedNonce: nonce }),
    });

    const result = await this.fetch<{ trusted: boolean; sessionToken?: string; expiresAt?: number }>(
      "/v1/handshake/verify",
      { method: "POST", body: JSON.stringify({ challengeId }) }
    );

    return result;
  }
}

export default OctraID;
