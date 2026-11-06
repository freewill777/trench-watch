import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The clusters the game wallets can use. Each is named by the genesis hash its RPC must report.
// The same ed25519 keys are valid on every cluster; only balances and RPC endpoints differ.
export const NETWORKS = {
  devnet: {
    label: "devnet",
    url: "https://api.devnet.solana.com",
    genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    urlEnv: "DEVNET_RPC_URL",
  },
  testnet: {
    label: "testnet",
    url: "https://api.testnet.solana.com",
    genesis: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
    urlEnv: "TESTNET_RPC_URL",
  },
};

export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const DEFAULT_NETWORK = "devnet";

// Every genesis hash we know, so a probe can name what it found, including mainnet-beta.
export const KNOWN_GENESIS = {
  [NETWORKS.devnet.genesis]: "devnet",
  [NETWORKS.testnet.genesis]: "testnet",
  [MAINNET_GENESIS]: "mainnet-beta",
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function requireGameNetwork(name) {
  if (!Object.prototype.hasOwnProperty.call(NETWORKS, name)) {
    throw new Error(`unknown network "${name}"; choose one of: ${Object.keys(NETWORKS).join(", ")}`);
  }
  return name;
}

// The env override is read at call time, so a changed variable takes effect without a code change.
export function rpcUrlFor(name) {
  const net = NETWORKS[requireGameNetwork(name)];
  return process.env[net.urlEnv] || net.url;
}

function configPath(dir) {
  return path.join(dir, "devnet", "network.json");
}

export function readActiveNetwork(dir = repoRoot) {
  const file = configPath(dir);
  if (!fs.existsSync(file)) return DEFAULT_NETWORK;
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  return requireGameNetwork(record.network);
}

export function writeActiveNetwork(name, dir = repoRoot) {
  requireGameNetwork(name);
  const file = configPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ network: name, setAt: new Date().toISOString() }, null, 2) + "\n");
  return file;
}
