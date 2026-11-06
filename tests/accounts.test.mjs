import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AccountError,
  adminGuard,
  adminLogin,
  changeAdminPassword,
  endSession,
  sessionFrom,
  setAdminFileForTests,
} from "../src/accounts.js";
import { base58Encode, keypairFromSeed } from "../src/solana-tx.js";

// Every admin test runs against a temp file, so the real devnet/admin.json password is never changed.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-accounts-"));
const tempAdmin = path.join(dir, "admin.json");

before(() => setAdminFileForTests(tempAdmin));
after(() => {
  setAdminFileForTests(undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

// Each test gets a fresh client key, so one test's failures never lock another test out.
let client = 0;
const key = () => `client-${++client}`;

test("the admin login accepts admin/work4fun and returns a session", () => {
  const k = key();
  const token = adminLogin(k, "admin", "work4fun");
  const s = sessionFrom(token);
  assert.equal(s.kind, "admin");
  assert.equal(s.subject, "admin");
  endSession(token);
  assert.equal(sessionFrom(token), null, "ended sessions are gone");
});

test("a wrong admin password is refused with a generic message", () => {
  const k = key();
  assert.throws(() => adminLogin(k, "admin", "work4fun!"), (e) => e instanceof AccountError && e.status === 401 && /wrong username or password/.test(e.message));
  assert.throws(() => adminLogin(k, "root", "work4fun"), /wrong username or password/, "wrong user is refused too");
  assert.throws(() => adminLogin(k, "admin", ""), /wrong username or password/, "empty password is refused");
});

test("five wrong admin logins lock the client out with a 429", () => {
  const k = key();
  for (let i = 0; i < 5; i++) assert.throws(() => adminLogin(k, "admin", "nope"));
  assert.throws(() => adminLogin(k, "admin", "work4fun"), (e) => e.status === 429, "even the right password is locked out");
  adminGuard.succeed(k);
});

test("the admin can change the password, and the old one stops working", () => {
  const k = key();
  changeAdminPassword("correct-horse-9");
  assert.throws(() => adminLogin(k, "admin", "work4fun"), /wrong username or password/);
  const token = adminLogin(k, "admin", "correct-horse-9");
  assert.ok(sessionFrom(token));
  endSession(token);
  changeAdminPassword("work4fun");
});

test("a new admin password must be at least eight characters", () => {
  assert.throws(() => changeAdminPassword("short"), /at least 8/);
});

test("chain changes are refused until the first-run password is replaced", async () => {
  const { changePolicy, adminMustChange } = await import("../src/accounts.js");
  // The temp file starts with mustChange true only if it was created that way; force the first-run state.
  const record = JSON.parse(fs.readFileSync(tempAdmin, "utf8"));
  fs.writeFileSync(tempAdmin, JSON.stringify({ ...record, mustChange: true }, null, 2));
  assert.equal(adminMustChange(), true);
  assert.throws(() => changePolicy({ chain: "devnet" }, "admin"), (e) => e.status === 403 && /change the default admin password/.test(e.message));
  changeAdminPassword("replacement-pass-1");
  assert.equal(adminMustChange(), false, "changing the password clears the first-run flag");
  changeAdminPassword("work4fun");
});

test("the admin password is never written to disk in plain text", () => {
  const onDisk = fs.readFileSync(tempAdmin, "utf8");
  assert.ok(!onDisk.includes("work4fun"), "the stored file holds only a hash");
  assert.ok(!onDisk.includes("correct-horse-9"));
});

// Wallet login uses a real wallet keypair, so the signature checks are real ed25519 checks.
const wallet = keypairFromSeed(crypto.randomBytes(32));
const other = keypairFromSeed(crypto.randomBytes(32));
const signWith = (kp, message) => base58Encode(crypto.sign(null, Buffer.from(message, "utf8"), kp.privateKey));

test("wallet login succeeds with a real signature over the issued challenge", async () => {
  const { issueChallenge, walletLogin } = await import("../src/accounts.js");
  const c = issueChallenge(wallet.address, "Trench Watch");
  const token = walletLogin({ nonce: c.nonce, address: wallet.address, signature: signWith(wallet, c.message) });
  const s = sessionFrom(token);
  assert.equal(s.kind, "user");
  assert.equal(s.subject, wallet.address);
  endSession(token);
});

test("a wallet challenge cannot be used twice", async () => {
  const { issueChallenge, walletLogin } = await import("../src/accounts.js");
  const c = issueChallenge(wallet.address, "Trench Watch");
  const sig = signWith(wallet, c.message);
  walletLogin({ nonce: c.nonce, address: wallet.address, signature: sig });
  assert.throws(() => walletLogin({ nonce: c.nonce, address: wallet.address, signature: sig }), /missing, used, or expired/);
});

test("a wrong signature fails and consumes the challenge", async () => {
  const { issueChallenge, walletLogin } = await import("../src/accounts.js");
  const c = issueChallenge(wallet.address, "Trench Watch");
  assert.throws(() => walletLogin({ nonce: c.nonce, address: wallet.address, signature: signWith(wallet, "something else") }), /signature does not match/);
  assert.throws(() => walletLogin({ nonce: c.nonce, address: wallet.address, signature: signWith(wallet, c.message) }), /missing, used, or expired/, "the same challenge is refused after a failure");
});

test("a signature from another wallet cannot log in as this wallet", async () => {
  const { issueChallenge, walletLogin } = await import("../src/accounts.js");
  const c = issueChallenge(wallet.address, "Trench Watch");
  assert.throws(() => walletLogin({ nonce: c.nonce, address: wallet.address, signature: signWith(other, c.message) }), /signature does not match/);
});

test("a challenge issued for one wallet cannot be redeemed for another", async () => {
  const { issueChallenge, walletLogin } = await import("../src/accounts.js");
  const c = issueChallenge(wallet.address, "Trench Watch");
  assert.throws(() => walletLogin({ nonce: c.nonce, address: other.address, signature: signWith(other, c.message) }), /does not match the challenge/);
});

test("a malformed wallet address is refused before a challenge is issued", async () => {
  const { issueChallenge } = await import("../src/accounts.js");
  assert.throws(() => issueChallenge("short", "Trench Watch"), /wallet address is required/);
  assert.throws(() => issueChallenge(undefined, "Trench Watch"), /wallet address is required/);
});

test("the session cookie is HttpOnly, SameSite=Strict and scoped to /", async () => {
  const { sessionCookie, clearCookie, cookieValue } = await import("../src/accounts.js");
  const cookie = sessionCookie("abc");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.equal(cookieValue(cookie.split(";")[0], "tw_session"), "abc");
  assert.match(clearCookie(), /Max-Age=0/);
});

test("the cookie reader finds one named value among several", async () => {
  const { cookieValue } = await import("../src/accounts.js");
  assert.equal(cookieValue("a=1; tw_session=tok%3D; b=2", "tw_session"), "tok=");
  assert.equal(cookieValue("a=1", "tw_session"), null);
});

test("an identity without a mint is pending; with a mint it derives a token account", async () => {
  const { identityView } = await import("../src/accounts.js");
  const pending = identityView(wallet.address, null);
  assert.equal(pending.status, "pending");
  assert.equal(pending.account, undefined);
  const mint = "So11111111111111111111111111111111111111112";
  const derived = identityView(wallet.address, mint);
  assert.equal(derived.status, "derived");
  assert.equal(derived.mint, mint);
  assert.ok(derived.account.length >= 32 && derived.account.length <= 44);
});
