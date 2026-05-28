const ENDPOINTS = [
  {
    group: "Identity",
    items: [
      { method: "POST", path: "/v1/agents/register", desc: "Register a new agent", body: '{ agentAddress, principalAddress, agentUri }', returns: '{ agentId }' },
      { method: "GET", path: "/v1/agents/:agentId", desc: "Get agent details (principal not exposed)", body: null, returns: 'AgentRecord (no principal_address)' },
      { method: "GET", path: "/v1/agents/by-address/:addr", desc: "Look up agent by wallet address", body: null, returns: 'AgentRecord' },
      { method: "POST", path: "/v1/agents/:agentId/revoke", desc: "Revoke an agent (principal only)", body: null, returns: '{ revoked: true }' },
      { method: "GET", path: "/v1/principals/:addr/agents", desc: "List agents owned by a principal", body: null, returns: '{ agents: AgentRecord[] }' },
    ],
  },
  {
    group: "Reputation",
    items: [
      { method: "POST", path: "/v1/reputation/event", desc: "Submit a reputation event", body: '{ agentId, eventType, evidenceUri }', returns: '{ eventId }' },
      { method: "GET", path: "/v1/reputation/:agentId", desc: "Get agent tier (score not exposed)", body: null, returns: '{ agentId, tier, eventCount }' },
      { method: "POST", path: "/v1/reputation/prove-threshold", desc: "Get signed threshold attestation", body: '{ agentId, threshold }', returns: '{ attestation, token }' },
    ],
  },
  {
    group: "Mandates",
    items: [
      { method: "POST", path: "/v1/mandates/issue", desc: "Issue a mandate. Scope is hashed on-chain.", body: '{ agentId, principalAddress, scope, maxValueOct, totalBudgetOct, validForHours }', returns: '{ mandateId, scopeHash }' },
      { method: "POST", path: "/v1/mandates/verify", desc: "Verify agent has valid mandate for scope hash", body: '{ agentId, scopeHash }', returns: '{ attestation, token }' },
      { method: "POST", path: "/v1/mandates/:id/revoke", desc: "Revoke a mandate (principal only)", body: null, returns: '{ revoked: true }' },
      { method: "GET", path: "/v1/agents/:agentId/mandates", desc: "Get active mandate count (not contents)", body: null, returns: '{ agentId, activeMandateCount }' },
    ],
  },
  {
    group: "Handshake",
    items: [
      { method: "POST", path: "/v1/handshake/initiate", desc: "Start a trust handshake", body: '{ agentIdA, requestedScopeHash, timestamp }', returns: '{ challengeId, nonce }' },
      { method: "POST", path: "/v1/handshake/respond", desc: "Respond with attestations", body: '{ challengeId, agentIdB, signedNonce, reputationAttestation?, mandateAttestation? }', returns: '{ challengeId, reputationValid, mandateValid }' },
      { method: "POST", path: "/v1/handshake/verify", desc: "Get session token if trusted", body: '{ challengeId }', returns: '{ trusted, sessionToken, expiresAt }' },
      { method: "POST", path: "/v1/handshake/validate", desc: "Validate a session token", body: '{ sessionToken }', returns: '{ valid, agentIdA, agentIdB, expiresAt }' },
    ],
  },
];

const METHOD_COLORS: Record<string, string> = {
  GET: "text-emerald-400 bg-emerald-900/20",
  POST: "text-indigo-400 bg-indigo-900/20",
  DELETE: "text-red-400 bg-red-900/20",
};

export default function DocsPage() {
  return (
    <div className="max-w-4xl space-y-12">
      <div>
        <h1 className="text-3xl font-bold mb-2">API Reference</h1>
        <p className="text-oct-text-dim text-sm">
          Base URL: <code className="bg-oct-surface px-2 py-0.5 rounded text-oct-accent">https://registry.octraid.network</code> (or your local instance at port 3000).
        </p>
        <div className="mt-3 p-4 rounded-lg border border-oct-border/50 bg-oct-surface/50 text-sm text-oct-text-dim space-y-1">
          <div>All responses are JSON. Errors: <code className="text-oct-text">{"{ error: string }"}</code></div>
          <div>Agent IDs: <code className="text-oct-text">agt_...</code> · Addresses: <code className="text-oct-text">oct...</code> (44 chars base58 after prefix)</div>
          <div>Attestations are HS256 JWTs issued by the registry, valid 1 hour.</div>
        </div>
      </div>

      {ENDPOINTS.map((group) => (
        <section key={group.group} className="space-y-3">
          <h2 className="text-xl font-bold border-b border-oct-border pb-2">{group.group}</h2>
          <div className="space-y-2">
            {group.items.map((ep) => (
              <div key={ep.path} className="p-4 rounded-lg border border-oct-border bg-oct-surface">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${METHOD_COLORS[ep.method] ?? ""}`}>
                    {ep.method}
                  </span>
                  <code className="text-oct-text text-sm">{ep.path}</code>
                </div>
                <div className="text-oct-text-dim text-sm">{ep.desc}</div>
                {ep.body && (
                  <div className="mt-2 text-xs">
                    <span className="text-oct-text-dim">Body: </span>
                    <code className="text-oct-text bg-oct-muted px-2 py-0.5 rounded">{ep.body}</code>
                  </div>
                )}
                <div className="mt-1 text-xs">
                  <span className="text-oct-text-dim">Returns: </span>
                  <code className="text-oct-text bg-oct-muted px-2 py-0.5 rounded">{ep.returns}</code>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Privacy model */}
      <section className="p-6 rounded-lg border border-oct-border bg-oct-surface space-y-4">
        <h2 className="text-xl font-bold">Privacy model</h2>
        <div className="text-oct-text-dim text-sm space-y-3 leading-relaxed">
          <p>
            <strong className="text-oct-text">What's private:</strong> Principal addresses are stored in the sealed Circle but never returned by the API. Reputation scores are sealed inside the Circle — the API returns tier (bucket) only. Mandate scope contents are never stored; only the sha256 hash goes on-chain.
          </p>
          <p>
            <strong className="text-oct-text">Mechanism:</strong> Privacy is provided by Octra's sealed execution environment, not cryptographic zero-knowledge proofs. The Circle is the trust boundary. Scores are plaintext inside the sealed Circle; only the Circle can read them.
          </p>
          <p>
            <strong className="text-oct-text">Threshold attestations:</strong> <code className="bg-oct-muted px-1 rounded">prove_threshold</code> computes <code className="bg-oct-muted px-1 rounded">score ≥ threshold</code> inside the Circle, creates a Pedersen commitment via <code className="bg-oct-muted px-1 rounded">fhe_pedersen</code>, and returns a boolean. The registry API signs the result as a JWT. The commitment is verifiable as originating from the sealed Circle without revealing the score.
          </p>
          <p>
            <strong className="text-oct-text">Upgrade path:</strong> The Octra Circle SDK already exposes <code className="bg-oct-muted px-1 rounded">fhe_verify_bound</code> and the full HFHE subsystem. A future version of the Reputation Circle can store scores as FHE ciphertexts and implement trustless threshold proofs using these primitives — no architecture changes required.
          </p>
        </div>
      </section>
    </div>
  );
}
