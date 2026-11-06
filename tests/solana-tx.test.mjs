import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  SYSTEM_PROGRAM,
  TRANSFER_DATA_LENGTH,
  base58Decode,
  base58Encode,
  buildSignedTransfer,
  encodeCompactU16,
  keypairFromSeed,
  publicKeyObject,
} from "../src/solana-tx.js";

// RFC 8032, section 7.1, test 1 (empty message).
const RFC_SECRET = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const RFC_PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const RFC_EMPTY_SIG =
  "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";

test("base58 matches known vectors and round-trips", () => {
  assert.equal(base58Encode(Buffer.from("Hello World")), "JxF12TrwUP45BMd");
  assert.equal(base58Decode("JxF12TrwUP45BMd").toString(), "Hello World");
  assert.equal(base58Encode(Buffer.from([0, 0, 1])), "112");
  assert.deepEqual(base58Decode("11"), Buffer.from([0, 0]));
  const random = crypto.randomBytes(32);
  assert.deepEqual(base58Decode(base58Encode(random)), random);
  assert.throws(() => base58Decode("0OIl"), /invalid base58/);
});

test("the System Program address is 32 zero bytes", () => {
  assert.equal(SYSTEM_PROGRAM, "11111111111111111111111111111111");
  assert.deepEqual(base58Decode(SYSTEM_PROGRAM), Buffer.alloc(32));
});

test("compact-u16 encodes the boundary values", () => {
  const cases = [
    [0, [0x00]],
    [127, [0x7f]],
    [128, [0x80, 0x01]],
    [16383, [0xff, 0x7f]],
    [16384, [0x80, 0x80, 0x01]],
  ];
  for (const [value, bytes] of cases) assert.deepEqual(encodeCompactU16(value), Buffer.from(bytes), `value ${value}`);
  assert.throws(() => encodeCompactU16(-1), /out of range/);
  assert.throws(() => encodeCompactU16(65536), /out of range/);
});

test("ed25519 derivation and signing match RFC 8032 test 1", () => {
  const kp = keypairFromSeed(Buffer.from(RFC_SECRET, "hex"));
  assert.equal(kp.publicKey.toString("hex"), RFC_PUBLIC);
  assert.equal(kp.address, base58Encode(Buffer.from(RFC_PUBLIC, "hex")));
  assert.equal(crypto.sign(null, Buffer.alloc(0), kp.privateKey).toString("hex"), RFC_EMPTY_SIG);
  assert.throws(() => keypairFromSeed(Buffer.alloc(31)), /32 bytes/);
});
test("a 0.001 SOL transfer has the legacy wire layout", () => {
  const payer = keypairFromSeed(Buffer.from(RFC_SECRET, "hex"));
  const recipient = Buffer.alloc(32, 7);
  const blockhash = Buffer.alloc(32, 9);
  const tx = buildSignedTransfer({ payer, to: recipient, lamports: 1_000_000, blockhash });
  const m = tx.message;

  assert.equal(m[0], 1, "one required signature");
  assert.equal(m[1], 0, "zero read-only signed accounts");
  assert.equal(m[2], 1, "one read-only unsigned account (System Program)");
  assert.equal(m[3], 3, "three account keys");
  assert.deepEqual(m.subarray(4, 36), payer.publicKey, "key 0 is the payer");
  assert.deepEqual(m.subarray(36, 68), recipient, "key 1 is the recipient");
  assert.deepEqual(m.subarray(68, 100), Buffer.alloc(32), "key 2 is the System Program");
  assert.deepEqual(m.subarray(100, 132), blockhash, "recent blockhash follows the keys");
  assert.equal(m[132], 1, "one instruction");
  assert.equal(m[133], 2, "program id index points at the System Program");
  assert.equal(m[134], 2, "two account indexes");
  assert.deepEqual(m.subarray(135, 137), Buffer.from([0, 1]), "accounts are payer then recipient");
  assert.equal(m[137], TRANSFER_DATA_LENGTH, "instruction data length");
  assert.equal(m.readUInt32LE(138), 2, "System Program Transfer discriminant");
  assert.equal(m.readBigUInt64LE(142), 1_000_000n, "lamports");
  assert.equal(m.length, 150);
});

test("the transfer signature verifies against the message and the payer key", () => {
  const payer = keypairFromSeed(Buffer.from(RFC_SECRET, "hex"));
  const tx = buildSignedTransfer({
    payer,
    to: Buffer.alloc(32, 7),
    lamports: 1_000_000,
    blockhash: Buffer.alloc(32, 9),
  });
  assert.equal(tx.wire[0], 1, "compact-u16 signature count is 1");
  assert.deepEqual(tx.wire.subarray(1, 65), tx.signature, "signature sits right after the count");
  assert.deepEqual(tx.wire.subarray(65), tx.message, "message follows the signature");
  assert.equal(crypto.verify(null, tx.message, publicKeyObject(payer.publicKey), tx.signature), true);
  assert.equal(crypto.verify(null, Buffer.concat([tx.message, Buffer.from([0])]), publicKeyObject(payer.publicKey), tx.signature), false);
  assert.equal(tx.signatureBase58.length >= 86 && tx.signatureBase58.length <= 88, true);
});

test("invalid transfers are refused before signing", () => {
  const payer = keypairFromSeed(Buffer.from(RFC_SECRET, "hex"));
  const blockhash = Buffer.alloc(32, 9);
  const to = Buffer.alloc(32, 7);
  assert.throws(() => buildSignedTransfer({ payer, to: payer.publicKey, lamports: 1, blockhash }), /same account/);
  assert.throws(() => buildSignedTransfer({ payer, to, lamports: 0, blockhash }), /positive integer/);
  assert.throws(() => buildSignedTransfer({ payer, to, lamports: 1.5, blockhash }), /positive integer/);
  assert.throws(() => buildSignedTransfer({ payer, to, lamports: 1, blockhash: Buffer.alloc(31) }), /32 bytes/);
  assert.throws(() => buildSignedTransfer({ payer, to: Buffer.alloc(31), lamports: 1, blockhash }), /32-byte/);
});
