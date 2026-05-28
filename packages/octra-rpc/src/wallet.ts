import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import { randomBytes } from "crypto";

// @noble/ed25519 v2 requires sha512Sync to be set for sync operations
ed.etc.sha512Sync = (...msgs) => sha512(ed.etc.concatBytes(...msgs));

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(buf: Uint8Array): string {
  if (buf.length === 0) return "";
  let num = BigInt("0x" + Buffer.from(buf).toString("hex"));
  let encoded = "";
  while (num > 0n) {
    const rem = num % 58n;
    num = num / 58n;
    encoded = BASE58_ALPHABET[Number(rem)] + encoded;
  }
  for (let i = 0; i < buf.length && buf[i] === 0; i++) encoded = "1" + encoded;
  return encoded;
}

export function publicKeyToAddress(publicKey: Uint8Array): string {
  const hash = sha256(publicKey);
  return "oct" + base58Encode(hash);
}

export interface Wallet {
  privateKey: string; // base64 encoded 32-byte Ed25519 private key
  publicKey: string;  // base64 encoded 32-byte Ed25519 public key
  address: string;    // oct... address
}

export function generateWallet(): Wallet {
  const privKeyBytes = randomBytes(32);
  const pubKeyBytes = ed.getPublicKey(privKeyBytes);
  return {
    privateKey: Buffer.from(privKeyBytes).toString("base64"),
    publicKey: Buffer.from(pubKeyBytes).toString("base64"),
    address: publicKeyToAddress(pubKeyBytes),
  };
}

export function walletFromPrivateKey(privateKeyB64: string): Wallet {
  const privKeyBytes = Buffer.from(privateKeyB64, "base64");
  const pubKeyBytes = ed.getPublicKey(privKeyBytes);
  return {
    privateKey: privateKeyB64,
    publicKey: Buffer.from(pubKeyBytes).toString("base64"),
    address: publicKeyToAddress(pubKeyBytes),
  };
}

export function signSync(privateKeyB64: string, message: Uint8Array): string {
  const privKeyBytes = Buffer.from(privateKeyB64, "base64");
  const sig = ed.sign(message, privKeyBytes);
  return Buffer.from(sig).toString("base64");
}

export async function signAsync(privateKeyB64: string, message: Uint8Array): Promise<string> {
  const privKeyBytes = Buffer.from(privateKeyB64, "base64");
  const sig = await ed.signAsync(message, privKeyBytes);
  return Buffer.from(sig).toString("base64");
}
