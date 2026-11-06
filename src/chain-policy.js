import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN_GENESIS, MAINNET_GENESIS, NETWORKS, DEFAULT_NETWORK } from "./solana-networks.js";

// The chain the admin selects for identity and game accounts. Every chain is one of:
//   - a named cluster from solana-networks.js (devnet, testnet), or
//   - "mainnet-beta", which is read-only unless the real-money switch is on, or
//   - "custom": an admin-entered RPC URL whose chain is read from its genesis hash.
// The genesis hash of whatever answers is what decides the label. The admin's choice is only a request.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const policyFile = path.join(root, "devnet", "chain-policy.json");

export const CHAINS = ["devnet", "testnet", "mainnet-beta", "custom"];

const DEFAULT_POLICY = {
  chain: "testnet",
  customUrl: null,
  realMoneyEnabled: false,
  updatedAt: null,
  updatedBy: null,
};

export function normalizePolicy(raw) {
  const p = { ...DEFAULT_POLICY, ...(raw || {}) };
  if (!CHAINS.includes(p.chain)) throw new Error(`unknown chain "${p.chain}"`);
  if (p.chain === "custom") {
    if (!p.customUrl || !/^https:\/\//.test(p.customUrl)) {
      throw new Error("a custom chain needs an https:// RPC URL");
    }
  } else {
    p.customUrl = null;
  }
  p.realMoneyEnabled = p.realMoneyEnabled === true;
  return p;
}

export function loadPolicy(file = policyFile) {
  if (!fs.existsSync(file)) return normalizePolicy(DEFAULT_POLICY);
  return normalizePolicy(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function savePolicy(policy, by, file = policyFile) {
  const next = normalizePolicy({ ...policy, updatedAt: new Date().toISOString(), updatedBy: by });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return next;
}

// Decides whether a write (creating accounts, spending SOL) is allowed on a chain whose genesis hash is known.
// Reads are allowed on every chain. Writes need a known test cluster, or mainnet with the real-money switch on.
export function writePermission(policy, genesis) {
  const name = KNOWN_GENESIS[genesis];
  if (!name) return { allowed: false, reason: "the RPC reports an unknown chain; writes are refused" };
  if (name === "mainnet-beta") {
    if (!policy.realMoneyEnabled) return { allowed: false, reason: "mainnet-beta is read-only until the admin enables real money" };
    return { allowed: true, reason: "mainnet-beta writes enabled by the admin" };
  }
  return { allowed: true, reason: `${name} is a test cluster` };
}

// The genesis hash each admin-selectable chain must report. `custom` has no fixed hash: its hash is read live.
export function expectedGenesis(policy) {
  if (policy.chain === "mainnet-beta") return MAINNET_GENESIS;
  if (policy.chain === "custom") return null;
  return NETWORKS[policy.chain || DEFAULT_NETWORK].genesis;
}
