import { walletFromPrivateKey, signSync } from "./wallet";

const MICRO_OCT = 1_000_000;

export interface OctraRpcConfig {
  rpcUrl?: string;
  privateKey?: string;
}

export interface BalanceResult {
  address: string;
  balance: bigint;    // in microOCT
  nonce: number;
}

export interface Transaction {
  hash: string;
  from: string;
  to: string;
  amount: string;
  nonce: number;
  timestamp: number;
  status?: string;
  [key: string]: unknown;
}

export interface TxParams {
  to: string;
  amountOct: number;
  message?: string;
  nonce?: number;
}

export class OctraRpcClient {
  private rpcUrl: string;
  private privateKey?: string;
  private address?: string;
  private publicKey?: string;

  constructor(config: OctraRpcConfig = {}) {
    this.rpcUrl = (config.rpcUrl ?? process.env.OCTRA_RPC_URL ?? "https://octra.network").replace(/\/$/, "");
    if (config.privateKey) {
      const wallet = walletFromPrivateKey(config.privateKey);
      this.privateKey = config.privateKey;
      this.address = wallet.address;
      this.publicKey = wallet.publicKey;
    }
  }

  private async rpcFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.rpcUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Octra RPC ${path} → HTTP ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async getBalance(address: string): Promise<BalanceResult> {
    const data = await this.rpcFetch<{ balance: string | number; nonce?: number }>(`/balance/${address}`);
    // Balance from RPC is in OCT (float); convert to microOCT bigint
    const balOct = Number(data.balance);
    return {
      address,
      balance: BigInt(Math.round(balOct * MICRO_OCT)),
      nonce: data.nonce ?? 0,
    };
  }

  // Build and sign a transaction payload matching the pre_client format.
  // Signing: JSON.stringify of tx (without message), compact, Ed25519.
  private buildSignedTx(
    to: string,
    amountOct: number,
    nonce: number,
    extra: Record<string, unknown> = {},
    message?: string,
  ): Record<string, unknown> {
    if (!this.privateKey || !this.address) throw new Error("No wallet configured");

    const ou = amountOct < 1000 ? "1" : "3";
    const tx: Record<string, unknown> = {
      from: this.address,
      to_: to,
      amount: String(Math.round(amountOct * MICRO_OCT)),
      nonce,
      ou,
      timestamp: Date.now() / 1000,
      ...extra,
    };
    if (message) tx.message = message;

    // Sign payload = compact JSON of tx without message field (matches pre_client exactly)
    const signable = Object.fromEntries(
      Object.entries(tx).filter(([k]) => k !== "message")
    );
    const payload = Buffer.from(JSON.stringify(signable), "utf8");
    tx.signature = signSync(this.privateKey, payload);
    tx.public_key = this.publicKey;

    return tx;
  }

  private async currentNonce(): Promise<number> {
    if (!this.address) throw new Error("No wallet configured");
    const bal = await this.getBalance(this.address);
    return bal.nonce;
  }

  async sendTransaction(params: TxParams): Promise<string> {
    const nonce = params.nonce ?? (await this.currentNonce()) + 1;
    const tx = this.buildSignedTx(params.to, params.amountOct, nonce, {}, params.message);
    const result = await this.rpcFetch<{ status: string; tx_hash?: string }>("/send-tx", {
      method: "POST",
      body: JSON.stringify(tx),
    });
    if (result.status !== "accepted") throw new Error(`TX rejected: ${JSON.stringify(result)}`);
    return result.tx_hash ?? "";
  }

  async getTransaction(txHash: string): Promise<Transaction> {
    return this.rpcFetch<Transaction>(`/tx/${txHash}`);
  }

  async getAddressHistory(address: string): Promise<Transaction[]> {
    try {
      return await this.rpcFetch<Transaction[]>(`/history/${address}`);
    } catch {
      return [];
    }
  }

  // Call a deployed Circle's state-changing method (sends a transaction).
  // Architecture note: Circles are isolated units; the `to_` field is the Circle's
  // address and the `data` field carries the method invocation as JSON.
  // If the Octra RPC uses a different format for Circle calls, update this method.
  async callCircle(circleId: string, method: string, params: unknown[]): Promise<unknown> {
    const nonce = (await this.currentNonce()) + 1;
    const tx = this.buildSignedTx(circleId, 0, nonce, {
      data: JSON.stringify({ method, params }),
    });
    return this.rpcFetch<unknown>("/send-tx", { method: "POST", body: JSON.stringify(tx) });
  }

  // Query a Circle's view method (read-only, no transaction required).
  async queryCircle(circleId: string, method: string, params: unknown[]): Promise<unknown> {
    return this.rpcFetch<unknown>(`/circle/${circleId}/query`, {
      method: "POST",
      body: JSON.stringify({ method, params }),
    });
  }

  // Deploy a compiled Circle WASM binary. Returns the Circle's address.
  // Assumption: deploy endpoint accepts base64-encoded WASM with init params.
  // Update endpoint/format when Octra deployment docs are available.
  async deployCircle(wasmBytes: Buffer, initParams: unknown[] = []): Promise<string> {
    const nonce = (await this.currentNonce()) + 1;
    const tx = this.buildSignedTx("deploy", 0, nonce, {
      wasm: wasmBytes.toString("base64"),
      init_params: initParams,
    });
    const result = await this.rpcFetch<{ status: string; circle_id?: string; contract_address?: string }>(
      "/deploy-circle",
      { method: "POST", body: JSON.stringify(tx) },
    );
    const id = result.circle_id ?? result.contract_address;
    if (!id) throw new Error(`Deploy failed: ${JSON.stringify(result)}`);
    return id;
  }
}
