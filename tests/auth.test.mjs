import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ChallengeStore,
  LoginGuard,
  challengeMessage,
  hashPassword,
  loadAdmin,
  saveAdmin,
  verifyPassword,
  verifyWalletSignature,
} from "../src/auth.js";
import { base58Encode, keypairFromSeed } from "../src/solana-tx.js";

const seed = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
const wallet = keypairFromSeed(seed);

// A real ed25519 signature over the message, made with the wallet's private key, base58-encoded as a wallet returns it.
const sign = (message, kp = wallet) => crypto.sign(null, Buffer.from(message, "utf8"), kp.privateKey);
const b58 = (bytes) => base58Encode(bytes);

test("a wallet signature over the challenge is accepted", () => {
  const message = challengeMessage({ nonce: "abc", address: wallet.address, issuedAt: 1_000, domain: "Trench Watch" });
  assert.equal(verifyWalletSignature(wallet.address, message, b58(sign(message))), true);
});

test("a signature over a different message is rejected", () => {
  const message = challengeMessage({ nonce: "abc", address: wallet.address, issuedAt: 1_000, domain: "Trench Watch" });
  const other = challengeMessage({ nonce: "xyz", address: wallet.address, issuedAt: 1_000, domain: "Trench Watch" });
  assert.equal(verifyWalletSignature(wallet.address, other, b58(sign(message))), false);
});

test("a signature from a different key is rejected", () => {
  const impostor = keypairFromSeed(crypto.randomBytes(32));
  const message = challengeMessage({ nonce: "abc", address: wallet.address, issuedAt: 1_000, domain: "Trench Watch" });
  assert.equal(verifyWalletSignature(wallet.address, message, b58(sign(message, impostor))), false);
});

test("malformed addresses and signatures are rejected without throwing", () => {
  const message = "hello";
  assert.equal(verifyWalletSignature("not-base58-0OIl", message, b58(sign(message))), false);
  assert.equal(verifyWalletSignature(wallet.address, message, "1111"), false);
  assert.equal(verifyWalletSignature(wallet.address, message, ""), false);
});

test("a challenge is single-use", () => {
  let t = 1_000;
  const store = new ChallengeStore(() => t);
  const c = store.issue(wallet.address, "Trench Watch");
  assert.ok(store.take(c.nonce), "first take succeeds");
  assert.equal(store.take(c.nonce), null, "second take fails");
});

test("a challenge expires after five minutes", () => {
  let t = 1_000;
  const store = new ChallengeStore(() => t);
  const c = store.issue(wallet.address, "Trench Watch");
  t += 5 * 60_000 + 1;
  assert.equal(store.take(c.nonce), null);
});

test("an unknown nonce is rejected", () => {
  const store = new ChallengeStore();
  assert.equal(store.take("never-issued"), null);
});

test("the admin password is stored as a salted scrypt hash, never as plain text", () => {
  const record = hashPassword("work4fun");
  assert.equal(record.algo, "scrypt");
  assert.ok(!JSON.stringify(record).includes("work4fun"));
  assert.equal(verifyPassword("work4fun", record), true);
  assert.equal(verifyPassword("work4fun!", record), false);
  assert.equal(verifyPassword("", record), false);
  const again = hashPassword("work4fun");
  assert.notEqual(again.salt, record.salt, "each hash gets a fresh salt");
});

test("the first admin file is created with the default user and a hash, then reused", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-admin-"));
  const file = path.join(dir, "admin.json");
  try {
    const first = loadAdmin(file);
    assert.equal(first.user, "admin");
    assert.equal(first.mustChange, true);
    assert.ok(!fs.readFileSync(file, "utf8").includes("work4fun"), "file holds a hash, not the password");
    assert.equal(verifyPassword("work4fun", first), true);
    const second = loadAdmin(file);
    assert.equal(second.hash, first.hash, "an existing file is not replaced");
    saveAdmin({ ...second, mustChange: false }, file);
    assert.equal(loadAdmin(file).mustChange, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("five failed admin logins lock the client for 15 minutes", () => {
  let t = 0;
  const guard = new LoginGuard(() => t);
  for (let i = 0; i < 4; i++) guard.fail("1.2.3.4");
  assert.equal(guard.locked("1.2.3.4"), 0, "not locked before the fifth failure");
  guard.fail("1.2.3.4");
  assert.equal(guard.locked("1.2.3.4"), 15 * 60_000);
  assert.equal(guard.locked("5.6.7.8"), 0, "other clients are unaffected");
  t += 15 * 60_000 + 1;
  assert.equal(guard.locked("1.2.3.4"), 0, "lock expires");
});

test("a successful login clears the failure count", () => {
  const guard = new LoginGuard(() => 0);
  for (let i = 0; i < 4; i++) guard.fail("c");
  guard.succeed("c");
  guard.fail("c");
  assert.equal(guard.locked("c"), 0);
});
