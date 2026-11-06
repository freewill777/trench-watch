import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { NETWORKS, MAINNET_GENESIS, readActiveNetwork, requireGameNetwork, rpcUrlFor, writeActiveNetwork } from "../src/solana-networks.js";
import { SolanaRpc } from "../src/solana-rpc.js";

// A tiny JSON-RPC server that answers getGenesisHash with a chosen value, so the guard is tested offline.
function fakeRpc(genesis) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const msg = JSON.parse(body || "{}");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: genesis }));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("devnet and testnet are distinct clusters with distinct genesis hashes", () => {
  assert.notEqual(NETWORKS.devnet.genesis, NETWORKS.testnet.genesis);
  assert.notEqual(NETWORKS.devnet.genesis, MAINNET_GENESIS);
  assert.notEqual(NETWORKS.testnet.genesis, MAINNET_GENESIS);
  assert.equal(NETWORKS.devnet.genesis, "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
  assert.equal(NETWORKS.testnet.genesis, "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY");
});

test("unknown network names are refused", () => {
  assert.throws(() => requireGameNetwork("mainnet-beta"), /unknown network/);
  assert.throws(() => requireGameNetwork("__proto__"), /unknown network/);
  assert.throws(() => new SolanaRpc("localnet"), /unknown network/);
});

test("RPC URL comes from the network's env override, else its default", () => {
  const saved = process.env.TESTNET_RPC_URL;
  try {
    delete process.env.TESTNET_RPC_URL;
    assert.equal(rpcUrlFor("testnet"), NETWORKS.testnet.url);
    process.env.TESTNET_RPC_URL = "http://127.0.0.1:1";
    assert.equal(rpcUrlFor("testnet"), "http://127.0.0.1:1");
  } finally {
    if (saved === undefined) delete process.env.TESTNET_RPC_URL;
    else process.env.TESTNET_RPC_URL = saved;
  }
});

test("the guard accepts an RPC that reports the expected genesis", async () => {
  const server = await fakeRpc(NETWORKS.testnet.genesis);
  try {
    const rpc = new SolanaRpc("testnet", `http://127.0.0.1:${server.address().port}`);
    assert.equal(await rpc.assertNetwork(), NETWORKS.testnet.genesis);
  } finally {
    server.close();
  }
});

test("the guard refuses a devnet RPC when testnet is active", async () => {
  const server = await fakeRpc(NETWORKS.devnet.genesis);
  try {
    const rpc = new SolanaRpc("testnet", `http://127.0.0.1:${server.address().port}`);
    await assert.rejects(rpc.assertNetwork(), /reports devnet, but the active network is testnet/);
  } finally {
    server.close();
  }
});

test("the guard refuses mainnet and names it", async () => {
  const server = await fakeRpc(MAINNET_GENESIS);
  try {
    const rpc = new SolanaRpc("devnet", `http://127.0.0.1:${server.address().port}`);
    await assert.rejects(rpc.assertNetwork(), /reports mainnet-beta, but the active network is devnet/);
  } finally {
    server.close();
  }
});

test("the guard refuses an unknown chain and never signs", async () => {
  const server = await fakeRpc("11111111111111111111111111111111");
  try {
    const rpc = new SolanaRpc("devnet", `http://127.0.0.1:${server.address().port}`);
    await assert.rejects(rpc.assertNetwork(), /reports an unknown chain/);
  } finally {
    server.close();
  }
});

test("the saved active network round-trips and defaults to devnet", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-net-"));
  try {
    assert.equal(readActiveNetwork(dir), "devnet");
    writeActiveNetwork("testnet", dir);
    assert.equal(readActiveNetwork(dir), "testnet");
    writeActiveNetwork("devnet", dir);
    assert.equal(readActiveNetwork(dir), "devnet");
    assert.throws(() => writeActiveNetwork("mainnet-beta", dir), /unknown network/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
