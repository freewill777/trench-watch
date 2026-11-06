import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { bs58Encode, describeWalletError, findProvider, signatureBytes } from "../identity/login/wallet-login.js";
import { base58Decode } from "../src/solana-tx.js";

const phantom = (extra = {}) => ({ isPhantom: true, ...extra });

test("the documented Phantom path is preferred over the legacy window.solana alias", () => {
  const win = { phantom: { solana: phantom() }, solana: phantom() };
  assert.equal(findProvider(win).name, "Phantom");
  assert.equal(findProvider(win).provider, win.phantom.solana);
});

test("window.solana is used only when it identifies itself as Phantom", () => {
  assert.equal(findProvider({ solana: phantom() }).name, "Phantom (legacy path)");
});

test("a non-Phantom signer on window.solana is used, but named honestly", () => {
  const other = { signMessage: () => {} };
  const found = findProvider({ solana: other });
  assert.equal(found.name, "a Solana wallet");
  assert.equal(found.provider, other);
});

test("Solflare is found when Phantom is absent", () => {
  assert.equal(findProvider({ solflare: { isSolflare: true } }).name, "Solflare");
});

test("no provider means no sign-in is offered", () => {
  assert.equal(findProvider({}), null);
  assert.equal(findProvider(undefined), null);
});

test("an Error keeps its message and has no code", () => {
  assert.deepEqual(describeWalletError(new Error("User rejected the request.")), { message: "User rejected the request.", code: null });
});

test("a plain wallet object with code and message keeps both", () => {
  assert.deepEqual(describeWalletError({ code: 4001, message: "User rejected the request." }), { message: "User rejected the request.", code: 4001 });
});

test("a wrapped error in err.error is unwrapped", () => {
  assert.deepEqual(describeWalletError({ error: { code: -32603, message: "Internal error" } }), { message: "Internal error", code: -32603 });
});

test("a code with no message names the code instead of a blank line", () => {
  const d = describeWalletError({ code: -32603 });
  assert.equal(d.code, -32603);
  assert.match(d.message, /error code -32603/);
});

test("an empty object gets an explicit reason, and null gets its own", () => {
  assert.equal(describeWalletError({}).message, "the wallet rejected the request without a reason");
  assert.equal(describeWalletError(null).message, "the wallet returned no error details");
});

test("a bare string error is passed through", () => {
  assert.equal(describeWalletError("Unexpected error").message, "Unexpected error");
});

test("a whitespace-only message counts as no message", () => {
  assert.equal(describeWalletError({ message: "   ", code: 7 }).message, "the wallet reported error code 7 with no message");
});

test("a Phantom-shaped signature result is normalized to the 64 signature bytes", () => {
  const sig = crypto.randomBytes(64);
  assert.deepEqual(Buffer.from(signatureBytes({ signature: sig, publicKey: null })), sig);
});

test("bare bytes and plain number arrays are accepted", () => {
  const sig = crypto.randomBytes(64);
  assert.deepEqual(Buffer.from(signatureBytes(sig)), sig);
  assert.deepEqual(Buffer.from(signatureBytes(Array.from(sig))), sig);
});

test("a base58 string signature is refused with the shape message, not re-encoded", () => {
  assert.throws(() => signatureBytes({ signature: bs58Encode(crypto.randomBytes(64)) }), /does not understand/);
});

test("a signature of the wrong length is refused", () => {
  assert.throws(() => signatureBytes(new Uint8Array(63)), /63 signature bytes; expected 64/);
});

test("base58 encoding round-trips through the server's decoder", () => {
  for (let i = 0; i < 50; i++) {
    const bytes = crypto.randomBytes(64);
    assert.deepEqual(Buffer.from(base58Decode(bs58Encode(bytes))), bytes);
  }
  assert.equal(bs58Encode(Uint8Array.from([0, 0, 1])), "112", "leading zeros become 1s");
});
