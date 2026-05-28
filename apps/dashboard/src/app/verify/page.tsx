"use client";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

function VerifyForm() {
  const params = useSearchParams();
  const [agentId, setAgentId] = useState(params.get("agentId") ?? "");
  const [threshold, setThreshold] = useState(50);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setResult(null); setError(null);
    try {
      const res = await fetch(`${API}/v1/reputation/prove-threshold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, threshold }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unknown error");
      setResult(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Verify an Agent</h1>
        <p className="text-oct-text-dim text-sm">
          Request a signed threshold attestation. Returns whether the agent's reputation score ≥ threshold
          without revealing the actual score. The attestation is a signed JWT valid for 1 hour.
        </p>
      </div>

      <form onSubmit={handleVerify} className="space-y-4">
        <div>
          <label className="block text-sm text-oct-text-dim mb-1">Agent ID</label>
          <input
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            placeholder="agt_..."
            className="w-full px-4 py-2.5 rounded-lg bg-oct-surface border border-oct-border text-oct-text font-mono text-sm focus:outline-none focus:border-oct-accent"
            required
          />
        </div>
        <div>
          <label className="block text-sm text-oct-text-dim mb-1">Threshold (reputation score)</label>
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
            min={0}
            className="w-full px-4 py-2.5 rounded-lg bg-oct-surface border border-oct-border text-oct-text font-mono text-sm focus:outline-none focus:border-oct-accent"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2.5 rounded bg-oct-accent hover:bg-oct-accent-dim text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {loading ? "Verifying…" : "Get attestation"}
        </button>
      </form>

      {error && (
        <div className="p-4 rounded-lg border border-red-800 bg-red-900/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-oct-border bg-oct-surface">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-3 h-3 rounded-full ${(result.attestation as Record<string, unknown>)?.aboveThreshold ? "bg-emerald-400" : "bg-red-500"}`} />
              <span className="font-semibold">
                {(result.attestation as Record<string, unknown>)?.aboveThreshold
                  ? `Reputation ≥ ${threshold} ✓`
                  : `Reputation < ${threshold} ✗`}
              </span>
              <span className="ml-auto text-oct-text-dim text-xs">Tier: {String((result.attestation as Record<string, unknown>)?.tier)}</span>
            </div>
            <pre className="text-xs text-oct-text-dim overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(result.attestation, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-xs text-oct-text-dim mb-1">JWT (copy for verification)</div>
            <pre className="p-3 rounded bg-oct-surface border border-oct-border text-xs text-oct-text-dim overflow-x-auto whitespace-pre-wrap break-all">
              {result.token as string}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyForm />
    </Suspense>
  );
}
