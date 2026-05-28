"use client";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

interface Agent {
  agent_id: string;
  agent_address: string;
  agent_uri: string;
  registered_at: number;
  status: string;
}

const TIER_LABELS: Record<string, string> = {
  Unverified: "tier-Unverified",
  Low: "tier-Low",
  Standard: "tier-Standard",
  High: "tier-High",
};

export default function AgentsPage() {
  const [search, setSearch] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!search) { setAgents([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        // Search by agentId or address
        const res = await fetch(
          search.startsWith("oct")
            ? `${API}/v1/agents/by-address/${search}`
            : `${API}/v1/agents/${search}`
        );
        if (res.ok) {
          const data = await res.json();
          setAgents([data]);
        } else {
          setAgents([]);
        }
      } catch { setAgents([]); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Agent Registry</h1>
        <p className="text-oct-text-dim text-sm">
          Search by agent ID (agt_...) or wallet address (oct...). Principal addresses are never shown.
        </p>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search agt_... or oct..."
        className="w-full max-w-xl px-4 py-2.5 rounded-lg bg-oct-surface border border-oct-border text-oct-text placeholder:text-oct-text-dim focus:outline-none focus:border-oct-accent font-mono text-sm"
      />

      {loading && <div className="text-oct-text-dim text-sm">Searching…</div>}

      {agents.length > 0 && (
        <div className="space-y-3">
          {agents.map((agent) => (
            <AgentRow key={agent.agent_id} agent={agent} />
          ))}
        </div>
      )}

      {!loading && search && agents.length === 0 && (
        <div className="text-oct-text-dim text-sm">No agent found.</div>
      )}
    </div>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const [tier, setTier] = useState<string>("—");

  useEffect(() => {
    fetch(`${API}/v1/reputation/${agent.agent_id}`)
      .then((r) => r.json())
      .then((d) => setTier(d.tier ?? "Unverified"))
      .catch(() => {});
  }, [agent.agent_id]);

  return (
    <a href={`/agents/${agent.agent_id}`} className="block p-4 rounded-lg border border-oct-border bg-oct-surface hover:border-oct-accent/40 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-sm text-oct-text">{agent.agent_id}</div>
          <div className="font-mono text-xs text-oct-text-dim mt-0.5">{agent.agent_address}</div>
          <div className="text-xs text-oct-text-dim mt-1 opacity-60">{agent.agent_uri}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${TIER_LABELS[tier] ?? "tier-Unverified"}`}>
            {tier}
          </span>
          <span className={`px-2 py-0.5 rounded text-xs ${agent.status === "Active" ? "bg-emerald-900/40 text-emerald-400" : "bg-oct-muted text-oct-text-dim"}`}>
            {agent.status}
          </span>
        </div>
      </div>
    </a>
  );
}
