const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function getStats() {
  try {
    const res = await fetch(`${API}/v1/stats`, { next: { revalidate: 30 } });
    if (!res.ok) return null;
    return res.json() as Promise<{ agentCount: number; mandateCount: number; eventCount: number }>;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const stats = await getStats();

  return (
    <div className="space-y-20">
      {/* Hero */}
      <section className="pt-10 pb-6">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-oct-accent/30 bg-oct-accent/10 text-oct-accent text-xs mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-oct-accent animate-pulse" />
            Built on Octra Network · Sealed Execution
          </div>
          <h1 className="text-5xl font-bold tracking-tight leading-tight mb-6">
            Private agent trust<br />
            <span className="text-oct-accent">infrastructure.</span>
          </h1>
          <p className="text-oct-text-dim text-lg leading-relaxed max-w-2xl">
            OctraID is a port of ERC-8004 to Octra. Agents register identities, earn reputation,
            and receive mandates — all verifiable without exposing scores, capabilities, or ownership.
          </p>
          <p className="text-oct-text-dim text-sm mt-3 opacity-70">
            Privacy model: sealed Circle execution. Scores are plaintext inside the sealed environment.
            Third parties verify thresholds via signed attestations — not raw scores.
            Designed to upgrade to native FHE using available Octra SDK primitives.
          </p>
        </div>
        <div className="flex gap-4 mt-8">
          <a href="/register" className="px-5 py-2.5 rounded bg-oct-accent hover:bg-oct-accent-dim text-white text-sm font-medium transition-colors">
            Register an agent
          </a>
          <a href="/verify" className="px-5 py-2.5 rounded border border-oct-border hover:border-oct-accent/50 text-oct-text-dim hover:text-oct-text text-sm font-medium transition-colors">
            Verify an agent
          </a>
        </div>
      </section>

      {/* Stats */}
      <section>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "Registered Agents", value: stats?.agentCount ?? "—", unit: "agents" },
            { label: "Active Mandates", value: stats?.mandateCount ?? "—", unit: "mandates" },
            { label: "Reputation Events", value: stats?.eventCount ?? "—", unit: "events" },
          ].map((stat) => (
            <div key={stat.label} className="p-6 rounded-lg border border-oct-border bg-oct-surface">
              <div className="text-3xl font-bold text-oct-text tabular-nums">{stat.value}</div>
              <div className="text-oct-text-dim text-sm mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section>
        <h2 className="text-2xl font-bold mb-8">How it works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              step: "01",
              title: "Register",
              body: "An agent registers with a principal oct... address. The registration is anchored on-chain via the Identity Circle. The principal address is never exposed publicly.",
            },
            {
              step: "02",
              title: "Earn reputation",
              body: "Other agents submit reputation events. Scores accumulate inside the sealed Circle. Third parties see only the trust tier (Unverified / Low / Standard / High), never the raw score.",
            },
            {
              step: "03",
              title: "Prove and authorize",
              body: "Use prove_threshold to get a signed attestation that score ≥ N without revealing N. Issue mandates with hashed scopes — authorization is verifiable without exposing what was authorized.",
            },
          ].map((item) => (
            <div key={item.step} className="p-6 rounded-lg border border-oct-border bg-oct-surface space-y-3">
              <div className="text-oct-accent font-mono text-xs opacity-60">{item.step}</div>
              <div className="font-semibold text-oct-text">{item.title}</div>
              <div className="text-oct-text-dim text-sm leading-relaxed">{item.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Architecture note */}
      <section className="p-6 rounded-lg border border-oct-border/50 bg-oct-surface/50">
        <h3 className="text-sm font-semibold text-oct-text-dim uppercase tracking-wider mb-3">Architecture</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          {[
            { label: "Identity Circle", desc: "Agent registration, principal binding, status management" },
            { label: "Reputation Circle", desc: "Score tracking, tier derivation, threshold attestation via fhe_pedersen" },
            { label: "Mandate Circle", desc: "Authorization issuance, scope-hash verification, budget tracking" },
          ].map((item) => (
            <div key={item.label}>
              <div className="text-oct-accent font-medium mb-1">{item.label}</div>
              <div className="text-oct-text-dim">{item.desc}</div>
            </div>
          ))}
        </div>
        <p className="text-oct-text-dim text-xs mt-4 opacity-60">
          Circles are isolated (no cross-Circle calls in current Octra runtime). All cross-registry
          validation happens in the off-chain API layer. Upgrade path: cross-Circle calls when supported.
        </p>
      </section>
    </div>
  );
}
