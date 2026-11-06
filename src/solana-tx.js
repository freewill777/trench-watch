import crypto from "node:crypto";

// Pure Solana wire-format helpers: base58, compact-u16, ed25519 keys, and a single System Program transfer.
// Nothing here touches the network.

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const SIGNATURE_FEE_LAMPORTS = 5_000;
// An empty account needs 890,880 lamports to be rent-exempt. A 0.001 SOL (1,000,000 lamport) transfer clears that,
// so a player wallet that receives one stays rent-exempt.
export const TRANSFER_DATA_LENGTH = 12;

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function base58Encode(input) {
  const bytes = Buffer.from(input);
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = bytes.length ? BigInt("0x" + bytes.toString("hex")) : 0n;
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  return "1".repeat(zeros) + out;
}

export function base58Decode(text) {
  let n = 0n;
  for (const ch of text) {
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) throw new Error(`invalid base58 character "${ch}"`);
    n = n * 58n + BigInt(digit);
  }
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  let hex = n === 0n ? "" : n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(hex, "hex")]);
}

export function encodeCompactU16(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(`compact-u16 out of range: ${value}`);
  }
  const out = [];
  let rest = value;
  for (;;) {
    const low = rest & 0x7f;
    rest >>= 7;
    if (rest === 0) {
      out.push(low);
      break;
    }
    out.push(low | 0x80);
  }
  return Buffer.from(out);
}

// Solana keys are ed25519. The 32-byte seed is the secret; the public key is derived from it.
export function keypairFromSeed(seed) {
  if (!Buffer.isBuffer(seed) || seed.length !== 32) throw new Error("ed25519 seed must be 32 bytes");
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const spki = crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const publicKey = Buffer.from(spki.subarray(spki.length - 32));
  return { seed: Buffer.from(seed), publicKey, privateKey, address: base58Encode(publicKey) };
}

export function publicKeyObject(publicKey) {
  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, publicKey]),
    format: "der",
    type: "spki",
  });
}
// Legacy message layout: header(3) | keys | blockhash(32) | instructions.
// Keys: payer (signer, writable), recipient (writable), System Program (read-only).
// The System Program transfer instruction is u32 LE index 2, then u64 LE lamports.
export function buildSignedTransfer({ payer, to, lamports, blockhash }) {
  if (!payer || !payer.privateKey || !payer.publicKey) throw new Error("payer keypair is required");
  if (!Buffer.isBuffer(to) || to.length !== 32) throw new Error("recipient must be a 32-byte public key");
  if (Buffer.compare(to, payer.publicKey) === 0) throw new Error("payer and recipient are the same account");
  if (!Buffer.isBuffer(blockhash) || blockhash.length !== 32) throw new Error("blockhash must be 32 bytes");
  if (!Number.isSafeInteger(lamports) || lamports <= 0) throw new Error("lamports must be a positive integer");

  const data = Buffer.alloc(TRANSFER_DATA_LENGTH);
  data.writeUInt32LE(2, 0);
  data.writeBigUInt64LE(BigInt(lamports), 4);

  const message = Buffer.concat([
    Buffer.from([1, 0, 1]),
    encodeCompactU16(3),
    payer.publicKey,
    to,
    base58Decode(SYSTEM_PROGRAM),
    blockhash,
    encodeCompactU16(1),
    Buffer.from([2]),
    encodeCompactU16(2),
    Buffer.from([0, 1]),
    encodeCompactU16(data.length),
    data,
  ]);
  const signature = crypto.sign(null, message, payer.privateKey);
  const wire = Buffer.concat([encodeCompactU16(1), signature, message]);
  return { wire, message, signature, signatureBase58: base58Encode(signature) };
}
