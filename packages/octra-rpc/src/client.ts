import { walletFromPrivateKey, signSync } from "./wallet";

const MICRO_OCT = 1_000_000;

export interface OctraRpcConfig {
  rpcUrl?: string;
  privateKey?: string;
}

export interface BalanceResult {
  address: string;
  balance: bigint;   // in microOCT
  nonce: number;
}

export interface Transaction {
  hash: string;
  from: string;
  to: string;
  amount: string;
  nonce: number;
  timestamp: number;
  op_type?: string;
  [key: string]: unknown;
}

export interface TxParams {
  to: string;
  amountOct: number;
  message?: string;
  nonce?: number;
}

// JSON-RPC 2.0 client for the Octra Network.
// RPC endpoint: https://octra.network/rpc
// Source reference: octra-labs/webcli lib/tx_builder.hpp, rpc_client.hpp
export class OctraRpcClient {
  private rpcUrl: string;
  private privateKey?: string;
  private address?: string;
  private publicKey?: string;

  constructor(config: OctraRpcConfig = {}) {
    const base = (config.rpcUrl ?? process.env.OCTRA_RPC_URL ?? "https://octra.network").replace(/\/$/, "");
    // Ensure we hit the /rpc JSON-RPC endpoint
    this.rpcUrl = base.endsWith("/rpc") ? base : `${base}/rpc`;
    if (config.privateKey) {
      const wallet = walletFromPrivateKey(config.privateKey);
      this.privateKey = config.privateKey;
      this.address = wallet.address;
      this.publicKey = wallet.publicKey;
    }
  }

  // JSON-RPC 2.0 call
  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    let id = Math.floor(Math.random() * 1_000_000);
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Octra RPC HTTP ${res.status}: ${body}`);
    }
    const data = await res.json() as { result?: T; error?: { message: string } };
    if (data.error) throw new Error(`Octra RPC ${method}: ${data.error.message}`);
    return data.result as T;
  }

  async getBalance(address: string): Promise<BalanceResult> {
    // octra_balance returns e.g. { balance: "1.234567", nonce: 5 }
    const data = await this.rpc<{ balance: string | number; nonce?: number }>("octra_balance", [address]);
    const balOct = parseFloat(String(data.balance));
    return {
      address,
      balance: BigInt(Math.round(balOct * MICRO_OCT)),
      nonce: data.nonce ?? 0,
    };
  }

  // Build canonical JSON for signing — matches webcli lib/tx_builder.hpp canonical_json()
  // Fields: from, to_, amount, nonce, ou, timestamp, op_type (always), encrypted_data?, message?
  private canonicalJson(fields: {
    from: string; to_: string; amount: string; nonce: number;
    ou: string; timestamp: number; op_type: string;
    encrypted_data?: string; message?: string;
  }): string {
    let s = `{"from":"${fields.from}","to_":"${fields.to_}","amount":"${fields.amount}","nonce":${fields.nonce},"ou":"${fields.ou}","timestamp":${fields.timestamp.toFixed(6)},"op_type":"${fields.op_type}"`;
    if (fields.encrypted_data) s += `,"encrypted_data":"${this.jsonEscape(fields.encrypted_data)}"`;
    if (fields.message) s += `,"message":"${this.jsonEscape(fields.message)}"`;
    s += "}";
    return s;
  }

  private jsonEscape(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  }

  private buildAndSignTx(opts: {
    to: string; amountOct: number; nonce: number; ou?: string;
    opType?: string; encryptedData?: string; message?: string;
  }): Record<string, unknown> {
    if (!this.privateKey || !this.address) throw new Error("No wallet configured");

    const ou = opts.ou ?? (opts.amountOct < 1000 ? "1" : "3");
    const timestamp = Date.now() / 1000;
    const opType = opts.opType ?? "standard";
    const amount = String(Math.round(opts.amountOct * MICRO_OCT));

    const canonical = this.canonicalJson({
      from: this.address,
      to_: opts.to,
      amount,
      nonce: opts.nonce,
      ou,
      timestamp,
      op_type: opType,
      encrypted_data: opts.encryptedData,
      message: opts.message,
    });

    const sig = signSync(this.privateKey, Buffer.from(canonical, "utf8"));

    const tx: Record<string, unknown> = {
      from: this.address,
      to_: opts.to,
      amount,
      nonce: opts.nonce,
      ou,
      timestamp,
      signature: sig,
      public_key: this.publicKey,
      op_type: opType,
    };
    if (opts.encryptedData) tx.encrypted_data = opts.encryptedData;
    if (opts.message) tx.message = opts.message;
    return tx;
  }

  private async currentNonce(): Promise<number> {
    if (!this.address) throw new Error("No wallet configured");
    const bal = await this.getBalance(this.address);
    return bal.nonce;
  }

  async sendTransaction(params: TxParams): Promise<string> {
    const nonce = params.nonce ?? (await this.currentNonce()) + 1;
    const tx = this.buildAndSignTx({
      to: params.to,
      amountOct: params.amountOct,
      nonce,
      message: params.message,
    });
    const result = await this.rpc<{ tx_hash?: string; hash?: string; status?: string }>("octra_submit", [tx]);
    return result.tx_hash ?? result.hash ?? "";
  }

  async getTransaction(txHash: string): Promise<Transaction> {
    return this.rpc<Transaction>("octra_transaction", [txHash]);
  }

  async getAddressHistory(address: string, limit = 20): Promise<Transaction[]> {
    try {
      return await this.rpc<Transaction[]>("octra_account", [address, limit]);
    } catch {
      return [];
    }
  }

  // Call a Circle's view method (read-only). Uses octra_circleView — no transaction required.
  // Auth signature: Ed25519 over "octra_circle_view|circle_id|caller_addr"
  async queryCircle(circleId: string, method: string, params: unknown[]): Promise<unknown> {
    if (!this.privateKey || !this.address) {
      // Unauthenticated view
      return this.rpc<unknown>("octra_circleView", [circleId, method, JSON.stringify(params), "", false]);
    }
    const sigMsg = `octra_circle_view|${circleId}|${this.address}`;
    const sig = signSync(this.privateKey, Buffer.from(sigMsg, "utf8"));
    return this.rpc<unknown>("octra_circleViewAuth", [circleId, method, JSON.stringify(params), this.address, this.publicKey, sig, false]);
  }

  // Call a Circle's state-changing method (submits a transaction).
  // op_type: "circle_call", encrypted_data: method name, message: JSON params array
  async callCircle(circleId: string, method: string, params: unknown[]): Promise<unknown> {
    const nonce = (await this.currentNonce()) + 1;
    const tx = this.buildAndSignTx({
      to: circleId,
      amountOct: 0,
      nonce,
      ou: "1000",  // default ou for circle_call per webcli
      opType: "circle_call",
      encryptedData: method,
      message: JSON.stringify(params),
    });
    return this.rpc<unknown>("octra_submit", [tx]);
  }

  // Pre-compute the Circle address from WASM bytecode + deployer + nonce.
  // Must be called before deployCircle to get the target address.
  async computeCircleAddress(wasmBytes: Buffer, nonce: number): Promise<string> {
    if (!this.address) throw new Error("No wallet configured");
    const wasmB64 = wasmBytes.toString("base64");
    return this.rpc<string>("octra_computeContractAddress", [wasmB64, this.address, nonce]);
  }

  // Deploy a compiled Circle WASM binary.
  // Workflow: compute address → build deploy_circle tx → submit
  // Returns the deployed Circle's address.
  async deployCircle(wasmBytes: Buffer, deployConfig: {
    runtime?: string;
    privacy_class?: string;
    browser_mode?: string;
    resource_mode?: string;
    ou?: string;
  } = {}): Promise<string> {
    if (!this.address) throw new Error("No wallet configured");
    const nonce = (await this.currentNonce()) + 1;
    const wasmB64 = wasmBytes.toString("base64");

    // Pre-compute the Circle's address
    const circleId = await this.computeCircleAddress(wasmBytes, nonce);

    const payload = {
      runtime: deployConfig.runtime ?? "wasm_v1",
      privacy_class: deployConfig.privacy_class ?? "sealed",
      browser_mode: deployConfig.browser_mode ?? "native_sealed",
      resource_mode: deployConfig.resource_mode ?? "sealed_read",
      limits: {
        max_stable_bytes: "33554432",
        max_assets_bytes: "33554432",
        max_inline_value: "65536",
        max_wasm_bytes: "33554432",
      },
      code_b64: wasmB64,
    };

    const tx = this.buildAndSignTx({
      to: circleId,
      amountOct: 0,
      nonce,
      ou: deployConfig.ou ?? "200000",
      opType: "deploy_circle",
      message: JSON.stringify(payload),
    });

    await this.rpc<unknown>("octra_submit", [tx]);
    return circleId;
  }
}
