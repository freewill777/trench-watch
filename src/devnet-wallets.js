import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { keypairFromSeed } from "./solana-tx.js";

// Keys live under devnet/wallets/, which .gitignore excludes. Nothing here prints a secret.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const walletDir = path.join(root, "devnet", "wallets");
export const runsDir = path.join(root, "devnet", "runs");

export const GAME_WALLET = "game";
export const PLAYER_PREFIX = "player-";

export function playerNames(count) {
  return Array.from({ length: count }, (_, i) => `${PLAYER_PREFIX}${i + 1}`);
}

function fileFor(name) {
  if (!/^[a-z0-9-]{1,32}$/.test(name)) throw new Error(`invalid wallet name "${name}"`);
  return path.join(walletDir, `${name}.json`);
}

// Creates a wallet only if its file does not exist yet. An existing key is never replaced.
export function createWallet(name, role) {
  fs.mkdirSync(walletDir, { recursive: true });
  const seed = crypto.randomBytes(32);
  const kp = keypairFromSeed(seed);
  const record = { name, role, address: kp.address, seedHex: seed.toString("hex"), createdAt: new Date().toISOString() };
  try {
    fs.writeFileSync(fileFor(name), JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } catch (err) {
    if (err.code === "EEXIST") return { created: false, address: loadWallet(name).address };
    throw err;
  }
  return { created: true, address: kp.address };
}

export function loadWallet(name) {
  const file = fileFor(name);
  if (!fs.existsSync(file)) throw new Error(`wallet "${name}" does not exist; run: npm run devnet -- init`);
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const kp = keypairFromSeed(Buffer.from(record.seedHex, "hex"));
  if (kp.address !== record.address) throw new Error(`wallet "${name}" file does not match its address`);
  return { name: record.name, role: record.role, address: kp.address, keypair: kp };
}

export function listWallets() {
  if (!fs.existsSync(walletDir)) return [];
  return fs
    .readdirSync(walletDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}
