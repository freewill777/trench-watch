import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { bs58Encode, signIn } from "../identity/login/wallet-login.js";
import { base58Decode, base58Encode, keypairFromSeed } from "../src/solana-tx.js";

const seed = crypto.randomBytes(32);
const kp = keypairFromSeed(seed);

// Verifies a base58 signature against the message with this wallet's public key.
function verifies(message, base58Sig) {
  const key = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), kp.publicKey]),
    format: "der",
    type: "spki",
  });
  return crypto.verify(null, Buffer.from(message, "utf8"), key, base58Decode(base58Sig));
}

// A sign-in driven by stubs: a wallet, an API, and a recorder for status lines and calls.
function harness({ connect, signMessage, post } = {}) {
  const lines = [];
  const calls = [];
  const wallet = {
    connect: connect || (async () => ({ publicKey: { toString: () => kp.address } })),
    signMessage:
      signMessage ||
      (async (bytes) => ({ signature: new Uint8Array(crypto.sign(null, Buffer.from(bytes), kp.privateKey)), publicKey: null })),
  };
  const api = {
    post:
      post ||
      (async (path, body) => {
        calls.push([path, body]);
        if (path === "/api/login/challenge") return { nonce: "n1", message: "hello wallet" };
        return { ok: true };
      }),
  };
  return { wallet, api, say: (t) => lines.push(t), lines, calls };
}

test("a full sign-in succeeds and posts the challenge, then the verification", async () => {
  const h = harness();
  const out = await signIn(h);
  assert.equal(out.address, kp.address);
  assert.equal(h.calls[0][0], "/api/login/challenge");
  assert.equal(h.calls[0][1].address, kp.address);
  assert.equal(h.calls[1][0], "/api/login/verify");
  assert.equal(h.calls[1][1].nonce, "n1");
});

test("the signature the page sends verifies against the challenge message", async () => {
  const h = harness();
  await signIn(h);
  const sent = h.calls[1][1].signature;
  const bytes = base58Decode(sent);
  assert.equal(bytes.length, 64, `decodes to 64 bytes (got ${bytes.length})`);
  const ok = verifies("hello wallet", sent);
  assert.equal(ok, true, `signature over "hello wallet" should verify (sent ${sent.slice(0, 12)}..., key ${kp.address.slice(0, 12)}...)`);
  assert.equal(verifies("a different message", sent), false, "the signature is bound to the message");
});

test("the wallet is asked to sign the UTF-8 bytes of the challenge message", async () => {
  let seen = null;
  const h = harness({
    signMessage: async (bytes, enc) => {
      seen = { text: Buffer.from(bytes).toString("utf8"), enc };
      return { signature: new Uint8Array(crypto.sign(null, Buffer.from(bytes), kp.privateKey)) };
    },
  });
  await signIn(h);
  assert.equal(seen.text, "hello wallet");
  assert.equal(seen.enc, "utf8");
});

test("a rejected connection names the step and the wallet's code", async () => {
  const h = harness({ connect: async () => { throw { code: 4001, message: "User rejected the request." }; } });
  await assert.rejects(signIn(h), (e) => e.message === "User rejected the request. [code 4001] (while connecting to the wallet)");
});

test("a connect that fails with only a code does not produce a blank error", async () => {
  const h = harness({ connect: async () => { throw { code: -32603 }; } });
  await assert.rejects(signIn(h), (e) => /error code -32603 \[code -32603\] \(while connecting to the wallet\)/.test(e.message));
});

test("a refused signature names the signing step", async () => {
  const h = harness({ signMessage: async () => { throw new Error("User rejected the request."); } });
  await assert.rejects(signIn(h), (e) => e.message === "User rejected the request. (while signing the message)");
});

test("a server rejection keeps the server's wording and names the verify step", async () => {
  const h = harness({
    post: async (path) => {
      if (path === "/api/login/challenge") return { nonce: "n1", message: "m" };
      throw new Error("the signature does not match the wallet");
    },
  });
  await assert.rejects(signIn(h), (e) => e.message === "the signature does not match the wallet (while verifying the signature)");
});

test("a challenge request that fails names that step", async () => {
  const h = harness({ post: async () => { throw new Error("a Solana wallet address is required"); } });
  await assert.rejects(signIn(h), (e) => e.message === "a Solana wallet address is required (while requesting a sign-in challenge)");
});

test("a wallet that connects without a public key is refused", async () => {
  const h = harness({ connect: async () => ({}) });
  await assert.rejects(signIn(h), (e) => /connected without returning a public key/.test(e.message));
});

test("the user sees a status line before each wallet prompt", async () => {
  const h = harness();
  await signIn(h);
  assert.ok(h.lines.some((l) => /Approve the connection/.test(l)));
  assert.ok(h.lines.some((l) => /Approve the sign-in message/.test(l)));
});

test("base58 of a fresh signature is never re-encoded by the page", async () => {
  const h = harness({ signMessage: async () => ({ signature: bs58Encode(crypto.randomBytes(64)) }) });
  await assert.rejects(signIn(h), (e) => /does not understand \(while signing the message\)/.test(e.message));
});
