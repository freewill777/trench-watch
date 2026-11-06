import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { base58Decode, base58Encode, publicKeyObject } from "./solana-tx.js";

// Login and identity. Users sign a server challenge with their Solana wallet (ed25519), so no user password exists.
// The admin account has a password stored only as a scrypt hash in devnet/admin.json.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const adminFile = path.join(root, "devnet", "admin.json");
export const ADMIN_USER = "admin";
// The first password is set once, on first run, and then stored as a hash. It is never written to the repo as plain text
// anywhere except this constant, which is used only to create the hash the first time the file is missing.
const INITIAL_ADMIN_PASSWORD = "work4fun";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

export function hashPassword(password, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return { algo: "scrypt", N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString("hex"), hash: hash.toString("hex") };
}

export function verifyPassword(password, record) {
  const expected = Buffer.from(record.hash, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(record.salt, "hex"), expected.length, {
    N: record.N,
    r: record.r,
    p: record.p,
  });
  return crypto.timingSafeEqual(actual, expected);
}

export function loadAdmin(file = adminFile) {
  if (!fs.existsSync(file)) {
    const record = { user: ADMIN_USER, ...hashPassword(INITIAL_ADMIN_PASSWORD), createdAt: new Date().toISOString(), mustChange: true };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function saveAdmin(record, file = adminFile) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
}

// Verifies an ed25519 signature made by a Solana wallet over a message.
// The public key is the base58 wallet address, decoded to 32 bytes.
export function verifyWalletSignature(address, message, signatureBase58) {
  let pub;
  let sig;
  try {
    pub = base58Decode(address);
    sig = base58Decode(signatureBase58);
  } catch {
    return false;
  }
  if (pub.length !== 32 || sig.length !== 64) return false;
  return crypto.verify(null, Buffer.from(message, "utf8"), publicKeyObject(pub), sig);
}

export function challengeMessage({ nonce, address, issuedAt, domain }) {
  return [
    `${domain} wants you to sign in with your Solana wallet.`,
    "",
    `Wallet: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date(issuedAt).toISOString()}`,
    "",
    "This signature proves wallet ownership. It sends no transaction and costs no SOL.",
  ].join("\n");
}

// Challenges are single-use and expire. They are held in memory, so a restart invalidates pending logins.
export class ChallengeStore {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.pending = new Map();
  }
  issue(address, domain) {
    const nonce = crypto.randomBytes(16).toString("hex");
    const issuedAt = this.now();
    const message = challengeMessage({ nonce, address, issuedAt, domain });
    this.pending.set(nonce, { address, message, expiresAt: issuedAt + CHALLENGE_TTL_MS });
    this.sweep();
    return { nonce, message, expiresAt: issuedAt + CHALLENGE_TTL_MS };
  }
  // Consumes the challenge whether or not the signature is valid, so a challenge cannot be retried.
  take(nonce) {
    const entry = this.pending.get(nonce);
    this.pending.delete(nonce);
    if (!entry || entry.expiresAt < this.now()) return null;
    return entry;
  }
  sweep() {
    const t = this.now();
    for (const [nonce, entry] of this.pending) if (entry.expiresAt < t) this.pending.delete(nonce);
  }
}

// Tracks failed admin logins per client and locks the client out for a while after too many.
export class LoginGuard {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.failures = new Map();
  }
  locked(key) {
    const entry = this.failures.get(key);
    if (!entry || !entry.lockedUntil) return 0;
    if (entry.lockedUntil <= this.now()) {
      this.failures.delete(key);
      return 0;
    }
    return entry.lockedUntil - this.now();
  }
  fail(key) {
    const entry = this.failures.get(key) || { count: 0, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILURES) entry.lockedUntil = this.now() + LOCK_MS;
    this.failures.set(key, entry);
    return entry;
  }
  succeed(key) {
    this.failures.delete(key);
  }
}

export function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export const SESSION = { ttlMs: SESSION_TTL_MS };
export { base58Encode };
