"use client";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const STEPS = ["Generate keypair", "Configure agent card", "Register on-chain", "Done"];

export default function RegisterPage() {
  const [step, setStep] = useState(0);
  const [agentAddress, setAgentAddress] = useState("");
  const [principalAddress, setPrincipalAddress] = useState("");
  const [agentUri, setAgentUri] = useState("");
  const [registering, setRegistering] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [error, setError] = useState("");

  const agentCardTemplate = agentAddress ? JSON.stringify({
    schemaVersion: "1.0",
    name: "My Agent",
    description: "An agent registered with OctraID",
    url: "https://myagent.example.com",
    address: agentAddress,
    capabilities: [],
    contact: { email: "" },
  }, null, 2) : "";

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegistering(true); setError("");
    try {
      const res = await fetch(`${API}/v1/agents/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentAddress, principalAddress, agentUri }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Registration failed");
      setAgentId(data.agentId);
      setStep(3);
    } catch (err) {
      setError(String(err));
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Register an Agent</h1>
        <p className="text-oct-text-dim text-sm">
          Register an agent identity on the Octra Network. The agent's wallet address
          and your principal address are anchored in the Identity Circle.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full text-xs flex items-center justify-center font-bold transition-colors ${i === step ? "bg-oct-accent text-white" : i < step ? "bg-emerald-600 text-white" : "bg-oct-muted text-oct-text-dim"}`}>
              {i < step ? "✓" : i + 1}
            </div>
            {i < STEPS.length - 1 && <div className={`h-px w-8 ${i < step ? "bg-emerald-600" : "bg-oct-border"}`} />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <h2 className="font-semibold">Step 1: Generate an agent keypair</h2>
          <p className="text-oct-text-dim text-sm">
            Your agent needs its own oct... wallet address. Generate one using the{" "}
            <a href="https://faucet.octra.network" target="_blank" rel="noopener" className="text-oct-accent hover:underline">
              Octra wallet generator
            </a>
            , then paste the address below.
          </p>
          <div>
            <label className="block text-sm text-oct-text-dim mb-1">Agent wallet address</label>
            <input
              value={agentAddress}
              onChange={(e) => setAgentAddress(e.target.value)}
              placeholder="oct..."
              className="w-full px-4 py-2.5 rounded-lg bg-oct-surface border border-oct-border text-oct-text font-mono text-sm focus:outline-none focus:border-oct-accent"
            />
          </div>
          <div>
            <label className="block text-sm text-oct-text-dim mb-1">Your principal address (your personal oct... wallet)</label>
            <input
              value={principalAddress}
              onChange={(e) => setPrincipalAddress(e.target.value)}
              placeholder="oct..."
              className="w-full px-4 py-2.5 rounded-lg bg-oct-surface border border-oct-border text-oct-text font-mono text-sm focus:outline-none focus:border-oct-accent"
            />
          </div>
          <button
            onClick={() => setStep(1)}
            disabled={!agentAddress.startsWith("oct") || !principalAddress.startsWith("oct")}
            className="px-5 py-2.5 rounded bg-oct-accent hover:bg-oct-accent-dim text-white text-sm font-medium transition-colors disabled:opacity-40"
          >
            Continue →
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <h2 className="font-semibold">Step 2: Publish your agent card</h2>
          <p className="text-oct-text-dim text-sm">
            The agent card is a JSON file describing your agent's capabilities. Host it at a public HTTPS URL
            (IPFS or your own server). Paste your agent card URL below.
          </p>
          <div>
            <label className="block text-sm text-oct-text-dim mb-1">Agent card URL</label>
            <input
              value={agentUri}
              onChange={(e) => setAgentUri(e.target.value)}
              placeholder="https://... or ipfs://..."
              className="w-full px-4 py-2.5 rounded-lg bg-oct-surface border border-oct-border text-oct-text font-mono text-sm focus:outline-none focus:border-oct-accent"
            />
          </div>
          {agentAddress && (
            <div>
              <div className="text-xs text-oct-text-dim mb-1">Agent card template (save as agent-card.json)</div>
              <pre className="p-3 rounded bg-oct-surface border border-oct-border text-xs text-oct-text-dim overflow-x-auto">
                {agentCardTemplate}
              </pre>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => setStep(0)} className="px-4 py-2 rounded border border-oct-border text-oct-text-dim text-sm hover:text-oct-text transition-colors">
              ← Back
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={!agentUri}
              className="px-5 py-2.5 rounded bg-oct-accent hover:bg-oct-accent-dim text-white text-sm font-medium transition-colors disabled:opacity-40"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <form onSubmit={handleRegister} className="space-y-4">
          <h2 className="font-semibold">Step 3: Register on-chain</h2>
          <div className="p-4 rounded-lg border border-oct-border bg-oct-surface space-y-2 text-sm">
            <div><span className="text-oct-text-dim">Agent address:</span> <span className="font-mono">{agentAddress}</span></div>
            <div><span className="text-oct-text-dim">Principal:</span> <span className="font-mono">{principalAddress}</span></div>
            <div><span className="text-oct-text-dim">Agent card:</span> <span className="font-mono break-all">{agentUri}</span></div>
          </div>
          {error && <div className="p-3 rounded border border-red-800 bg-red-900/20 text-red-400 text-sm">{error}</div>}
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(1)} className="px-4 py-2 rounded border border-oct-border text-oct-text-dim text-sm hover:text-oct-text transition-colors">
              ← Back
            </button>
            <button
              type="submit"
              disabled={registering}
              className="px-5 py-2.5 rounded bg-oct-accent hover:bg-oct-accent-dim text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {registering ? "Registering…" : "Register agent →"}
            </button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="p-6 rounded-lg border border-emerald-800 bg-emerald-900/20">
            <div className="text-emerald-400 font-semibold mb-2">Agent registered ✓</div>
            <div className="font-mono text-lg">{agentId}</div>
            <div className="text-oct-text-dim text-sm mt-3">
              Your agent is now registered in the OctraID Identity Circle. It starts with
              a reputation score of 10 (Unverified tier). Earn reputation by completing transactions.
            </div>
          </div>
          <a href={`/agents/${agentId}`}
             className="inline-flex items-center gap-2 text-oct-accent hover:underline text-sm">
            View agent profile →
          </a>
        </div>
      )}
    </div>
  );
}
