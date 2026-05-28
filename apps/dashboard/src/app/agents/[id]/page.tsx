const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function getAgent(id: string) {
  try {
    const res = await fetch(`${API}/v1/agents/${id}`, { next: { revalidate: 30 } });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function getReputation(id: string) {
  try {
    const res = await fetch(`${API}/v1/reputation/${id}`, { next: { revalidate: 30 } });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function getMandateCount(id: string) {
  try {
    const res = await fetch(`${API}/v1/mandates/agents/${id}/mandates`, { next: { revalidate: 30 } });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

const TIER_COLORS: Record<string, string> = {
  Unverified: "text-oct-text-dim bg-oct-muted",
  Low: "text-yellow-400 bg-yellow-900/40 border border-yellow-800",
  Standard: "text-indigo-400 bg-indigo-900/40 border border-indigo-800",
  High: "text-emerald-400 bg-emerald-900/40 border border-emerald-800",
};

export default async function AgentDetailPage({ params }: { params: { id: string } }) {
  const [agent, rep, mandates] = await Promise.all([
    getAgent(params.id),
    getReputation(params.id),
    getMandateCount(params.id),
  ]);

  if (!agent) {
    return (
      <div className="text-center py-20">
        <div className="text-oct-text-dim">Agent not found.</div>
        <a href="/agents" className="text-oct-accent text-sm mt-4 inline-block hover:underline">← Back to registry</a>
      </div>
    );
  }

  const tier = rep?.tier ?? "Unverified";

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <a href="/agents" className="text-oct-text-dim text-sm hover:text-oct-text">← Registry</a>
        <div className="flex items-start justify-between mt-4">
          <div>
            <h1 className="text-2xl font-bold font-mono">{agent.agent_id}</h1>
            <div className="text-oct-text-dim text-sm font-mono mt-1">{agent.agent_address}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${TIER_COLORS[tier] ?? TIER_COLORS.Unverified}`}>
              {tier}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs ${agent.status === "Active" ? "bg-emerald-900/40 text-emerald-400" : "bg-oct-muted text-oct-text-dim"}`}>
              {agent.status}
            </span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-lg border border-oct-border bg-oct-surface">
          <div className="text-2xl font-bold">{rep?.eventCount ?? 0}</div>
          <div className="text-oct-text-dim text-xs mt-1">Reputation events</div>
        </div>
        <div className="p-4 rounded-lg border border-oct-border bg-oct-surface">
          <div className="text-2xl font-bold">{mandates?.activeMandateCount ?? 0}</div>
          <div className="text-oct-text-dim text-xs mt-1">Active mandates</div>
        </div>
        <div className="p-4 rounded-lg border border-oct-border bg-oct-surface">
          <div className="text-2xl font-bold">{agent.registered_at ? new Date(agent.registered_at * 1000).toLocaleDateString() : "—"}</div>
          <div className="text-oct-text-dim text-xs mt-1">Registered</div>
        </div>
      </div>

      {/* Agent card URI */}
      <div className="p-4 rounded-lg border border-oct-border bg-oct-surface">
        <div className="text-oct-text-dim text-xs mb-1">Agent card</div>
        <a href={agent.agent_uri} target="_blank" rel="noopener noreferrer"
           className="text-oct-accent text-sm hover:underline break-all">
          {agent.agent_uri}
        </a>
      </div>

      {/* Privacy note */}
      <div className="p-4 rounded-lg border border-oct-border/50 bg-oct-surface/50 text-oct-text-dim text-xs space-y-1">
        <div>Principal address: hidden (privacy by default)</div>
        <div>Reputation score: hidden (tier only)</div>
        <div>Mandate contents: hidden (count only)</div>
      </div>

      {/* Verify widget */}
      <div className="p-6 rounded-lg border border-oct-accent/20 bg-oct-accent/5">
        <h3 className="font-semibold mb-3">Verify this agent</h3>
        <p className="text-oct-text-dim text-sm mb-4">
          Get a signed threshold attestation. Proves reputation ≥ N without revealing the actual score.
        </p>
        <a href={`/verify?agentId=${agent.agent_id}`}
           className="px-4 py-2 rounded bg-oct-accent hover:bg-oct-accent-dim text-white text-sm font-medium transition-colors">
          Open verifier →
        </a>
      </div>
    </div>
  );
}
