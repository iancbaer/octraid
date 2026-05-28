import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "OctraID — Private Agent Trust",
  description: "Private agent trust infrastructure on the Octra Network",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-oct-bg text-oct-text">
        <nav className="border-b border-oct-border bg-oct-surface/80 backdrop-blur sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-8 h-8 rounded bg-oct-accent/20 border border-oct-accent/40 flex items-center justify-center text-oct-accent text-sm font-bold">
                O
              </div>
              <span className="font-bold text-oct-text tracking-tight">OctraID</span>
              <span className="text-oct-text-dim text-xs">v0.1</span>
            </Link>
            <div className="flex items-center gap-6 text-sm text-oct-text-dim">
              <Link href="/agents" className="hover:text-oct-text transition-colors">Agents</Link>
              <Link href="/verify" className="hover:text-oct-text transition-colors">Verify</Link>
              <Link href="/register" className="hover:text-oct-text transition-colors">Register</Link>
              <Link href="/docs" className="hover:text-oct-text transition-colors">Docs</Link>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-6 py-10">
          {children}
        </main>
        <footer className="border-t border-oct-border mt-20 py-8 text-center text-oct-text-dim text-xs">
          <p>OctraID — Private agent trust on the Octra Network</p>
          <p className="mt-1 opacity-60">
            Privacy model: sealed execution environment (not cryptographic ZK).
            Scores are plaintext inside sealed Circles. <a href="https://github.com/octra-labs" className="underline">Upgrade path →</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
