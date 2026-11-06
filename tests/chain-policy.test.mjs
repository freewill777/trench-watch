import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizePolicy, writePermission, loadPolicy, savePolicy, expectedGenesis } from "../src/chain-policy.js";
import { NETWORKS, MAINNET_GENESIS } from "../src/solana-networks.js";

const DEVNET = NETWORKS.devnet.genesis;
const TESTNET = NETWORKS.testnet.genesis;
const OFF = { chain: "mainnet-beta", realMoneyEnabled: false };
const ON = { chain: "mainnet-beta", realMoneyEnabled: true };

test("mainnet is read-only by default, even though it is a known chain", () => {
  const p = normalizePolicy(OFF);
  const r = writePermission(p, MAINNET_GENESIS);
  assert.equal(r.allowed, false);
  assert.match(r.reason, /read-only until the admin enables real money/);
});

test("mainnet writes are allowed only after the admin enables real money", () => {
  assert.equal(writePermission(normalizePolicy(ON), MAINNET_GENESIS).allowed, true);
});

test("test clusters accept writes without the real-money switch", () => {
  assert.equal(writePermission(normalizePolicy({ chain: "devnet" }), DEVNET).allowed, true);
  assert.equal(writePermission(normalizePolicy({ chain: "testnet" }), TESTNET).allowed, true);
});

test("an unknown genesis hash is refused for writes on every policy", () => {
  const unknown = "11111111111111111111111111111111";
  for (const p of [{ chain: "devnet" }, { chain: "testnet" }, ON]) {
    const r = writePermission(normalizePolicy(p), unknown);
    assert.equal(r.allowed, false, JSON.stringify(p));
    assert.match(r.reason, /unknown chain/);
  }
});

test("selecting mainnet expects mainnet's genesis, so a devnet RPC cannot stand in for it", () => {
  // The live probe compares the answering RPC's genesis with this value. A devnet RPC therefore fails the
  // mainnet selection instead of passing as mainnet with real money enabled.
  assert.equal(expectedGenesis(normalizePolicy(ON)), MAINNET_GENESIS);
  assert.notEqual(expectedGenesis(normalizePolicy(ON)), DEVNET);
});

test("a custom chain needs an https URL", () => {
  assert.throws(() => normalizePolicy({ chain: "custom" }), /needs an https/);
  assert.throws(() => normalizePolicy({ chain: "custom", customUrl: "http://x" }), /needs an https/);
  assert.equal(normalizePolicy({ chain: "custom", customUrl: "https://rpc.example" }).customUrl, "https://rpc.example");
});

test("custom chains have no fixed genesis, so the live hash decides", () => {
  assert.equal(expectedGenesis(normalizePolicy({ chain: "custom", customUrl: "https://rpc.example" })), null);
});

test("unknown chain names are refused", () => {
  assert.throws(() => normalizePolicy({ chain: "localnet" }), /unknown chain/);
});

test("the policy round-trips through disk and records who changed it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-policy-"));
  const file = path.join(dir, "chain-policy.json");
  try {
    assert.equal(loadPolicy(file).chain, "testnet", "defaults to testnet");
    const saved = savePolicy({ chain: "devnet" }, "admin", file);
    assert.equal(saved.updatedBy, "admin");
    assert.equal(loadPolicy(file).chain, "devnet");
    assert.equal(loadPolicy(file).realMoneyEnabled, false, "real money stays off after a chain change");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
