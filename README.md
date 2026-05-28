# OctraID — Private Agent Trust Infrastructure

Port of [ERC-8004](https://github.com/erc-8004/erc-8004-contracts) to the Octra Network using Rust Circles.

## What this is

OctraID lets AI agents register identities, earn reputation, and receive authorization mandates — all verifiable without exposing scores, capabilities, or ownership to third parties.

On Ethereum, ERC-8004 agent scores, capabilities, and ownership are fully public. OctraID uses Octra's sealed Circle execution environment to make these private by default:

- Reputation scores are provable above/below a threshold without revealing the actual score
- Agent capabilities are verifiable without exposing what they are  
- Principal ownership is provable without revealing the principal's identity
- Mandates are enforceable without revealing their contents

## Privacy model

**Mechanism: sealed execution environment** (not cryptographic zero-knowledge proofs).

Scores are stored as plaintext integers inside sealed Circles. The Circle is the only entity that can read them. Third parties interact only with signed attestations:

- `prove_threshold(agentId, N)` → returns `{ above_threshold: bool, commitment, tier }` signed as a JWT. The commitment is a Pedersen commitment (`fhe_pedersen`) produced by the sealed Circle, providing a cryptographic fingerprint without revealing the score.
- `verify_mandate(agentId, scopeHash)` → proves authorization without revealing scope contents.

**Upgrade path:** The Octra Circle SDK already exposes `fhe_verify_bound`, `fhe_encrypt`, `fhe_decrypt`, and the full HFHE subsystem. A future version can store scores as FHE ciphertexts and implement trustless threshold proofs using these available primitives — the architecture is designed for this migration.

## Architecture

### Circles (on-chain, Rust → WASM → Octra)

Three sealed Circles are the source of truth:

| Circle | Responsibility |
|--------|---------------|
| `identity-registry` | Agent registration, principal binding, status management |
| `reputation-registry` | Score tracking, tier derivation, threshold attestation |
| `mandate-registry` | Authorization issuance, scope-hash verification, budget tracking |

**Circle state model (Option C):** Flat prefixed index keys + JSON blob record values.
```
agent:{id}                 → JSON blob of AgentRecord
principal:{addr}:agents    → comma-delimited list of agent IDs
agents:count               → u64 total
score:{agent_id}           → JSON blob of ReputationScore
events:count:{agent_id}    → u64 event count
mandate:{id}               → JSON blob of Mandate
agent:{id}:mandates        → comma-delimited list of mandate IDs
```

**Cross-Circle calls:** The Octra runtime does not expose `host_call_circle` — Circles cannot call each other synchronously. All cross-registry validation (e.g., verifying a reporter is a registered agent before submitting a reputation event) happens in the off-chain API layer. **Upgrade path:** Refactor to cross-Circle calls when supported by the Octra runtime.

**Timestamps:** Circles use `Host::epoch()` (Octra epoch numbers), not Unix timestamps. The off-chain indexer maps epochs to wall-clock time for the API and dashboard.

**Signing:** `Host::sign()` does not exist in the Circle SDK. Threshold and mandate attestations are signed in the API layer using `REGISTRY_PRIVATE_KEY` as HS256 JWTs.

### Off-chain layer (TypeScript/Node.js)

```
packages/
  octra-rpc/      Octra Network RPC client + wallet (Ed25519, signing, Circle calls)
  octraid-sdk/    Developer SDK wrapping the registry API
apps/
  registry-api/   Express REST API, Circle interaction, attestation generation, SQLite index
  dashboard/      Next.js 14 frontend (dark, technical aesthetic)
circles/
  rust_circle_sdk/        Vendored Octra Circle SDK (from octra-labs/circle_examples)
  identity-registry/      Identity Circle
  reputation-registry/    Reputation Circle
  mandate-registry/       Mandate Circle
scripts/
  deploy.ts               Deploys all three Circles, outputs addresses
```

## API endpoints

See `apps/dashboard/src/app/docs/page.tsx` or visit `/docs` on the running dashboard.

Base URL: `http://localhost:3000` (dev)

```
POST /v1/agents/register
GET  /v1/agents/:agentId
GET  /v1/agents/by-address/:addr
POST /v1/agents/:agentId/revoke
GET  /v1/principals/:addr/agents

POST /v1/reputation/event
GET  /v1/reputation/:agentId          (tier only — score not exposed)
POST /v1/reputation/prove-threshold   (returns signed JWT attestation)

POST /v1/mandates/issue
POST /v1/mandates/verify
POST /v1/mandates/:id/revoke
GET  /v1/mandates/agents/:agentId/mandates  (count only)

POST /v1/handshake/initiate
POST /v1/handshake/respond
POST /v1/handshake/verify
POST /v1/handshake/validate
```

## Quickstart (after funding the wallet)

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in env
cp .env.example .env
# Add REGISTRY_PRIVATE_KEY from WALLET.txt
# Add JWT_SECRET (any strong random string)

# 3. Build Circles
cd circles
cargo build --target wasm32-unknown-unknown --release
cd ..

# 4. Deploy Circles (requires funded registry wallet)
npx tsx scripts/deploy.ts
# Copy output IDENTITY_CIRCLE_ID, REPUTATION_CIRCLE_ID, MANDATE_CIRCLE_ID into .env

# 5. Start API
npm run dev:api

# 6. Start dashboard
npm run dev:dashboard
```

## Registry wallet

The registry wallet address is `octAyje5VdK8RJAfsVczbhGdmdyeXMoWciWbsXLCNBbWt1g`.

The private key and mnemonic are in `WALLET.txt` (chmod 600, gitignored). Never commit `WALLET.txt`.

For testnet, get free OCT at https://faucet.octra.network.

## Architectural decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| State model | Option C (index keys + JSON blobs) | Efficient index lookups without full-scan |
| Privacy mechanism | Sealed oracle | No `fhe_verify_bound` integration in v0.1; upgrade path documented |
| Cross-Circle | Off-chain coordination | No `host_call_circle` in Octra runtime |
| Timestamps | Epoch on-chain, Unix off-chain | Only `Host::epoch()` available in Circles |
| Attestation signing | HS256 JWT with REGISTRY_PRIVATE_KEY | No `Host::sign()` in Circle SDK |
| Agent IDs | djb2+fnv1a hash of agent address | No std sha256 in `wasm32-unknown-unknown` |
| Database | SQLite (better-sqlite3) | Off-chain index is a cache; Circles are source of truth |

## Reference material

- [ERC-8004 spec](https://github.com/erc-8004/erc-8004-contracts)
- [Octra Circle examples](https://github.com/octra-labs/circle_examples)
- [Octra pre-client](https://github.com/octra-labs/octra_pre_client) (signing reference)
- [Octra program examples](https://github.com/octra-labs/program-examples)
