import { ADMIN_USER, ChallengeStore, LoginGuard, hashPassword, loadAdmin, newToken, saveAdmin, verifyPassword, verifyWalletSignature } from "./auth.js";
import { SESSION } from "./auth.js";
import { loadPolicy, savePolicy } from "./chain-policy.js";
import { identityFor } from "./identity.js";

// In-memory sessions. A restart signs everyone out, which is the safe default for a local panel.
const sessions = new Map();
const challenges = new ChallengeStore();
export const adminGuard = new LoginGuard();

// The admin file path is a parameter so tests can use a temp file. The panel always uses the default.
let adminPath = undefined;
export function setAdminFileForTests(file) {
  adminPath = file;
}

export function createSession(kind, subject) {
  const token = newToken();
  sessions.set(token, { kind, subject, expiresAt: Date.now() + SESSION.ttlMs });
  return token;
}

export function sessionFrom(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

export function endSession(token) {
  if (token) sessions.delete(token);
}

// Reads one cookie value from a Cookie header.
export function cookieValue(header, name) {
  for (const part of String(header || "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export const SESSION_COOKIE = "tw_session";

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION.ttlMs / 1000)}`;
}

export function clearCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

// Checks the admin credentials with the same lockout for every caller. Returns nothing; throws on failure.
function checkAdmin(clientKey, user, password) {
  const locked = adminGuard.locked(clientKey);
  if (locked) throw new AccountError(429, `too many failed logins; try again in ${Math.ceil(locked / 60000)} minutes`);
  const record = loadAdmin(adminPath);
  const userOk = user === ADMIN_USER;
  const passOk = typeof password === "string" && password.length > 0 && verifyPassword(password, record);
  if (!userOk || !passOk) {
    adminGuard.fail(clientKey);
    throw new AccountError(401, "wrong username or password");
  }
  adminGuard.succeed(clientKey);
}

// Admin login. Returns a session token, or throws with a reason the caller can show.
export function adminLogin(clientKey, user, password) {
  checkAdmin(clientKey, user, password);
  return createSession("admin", ADMIN_USER);
}

// Re-checks the password for a sensitive change without creating a session.
export function confirmAdminPassword(clientKey, password) {
  checkAdmin(clientKey, ADMIN_USER, password);
}

export function changeAdminPassword(newPassword) {
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    throw new AccountError(400, "the new password must be at least 8 characters");
  }
  const record = loadAdmin(adminPath);
  saveAdmin({ ...record, ...hashPassword(newPassword), mustChange: false, changedAt: new Date().toISOString() }, adminPath);
}

// Wallet login, step 1: issue a single-use challenge for the wallet address.
export function issueChallenge(address, domain) {
  if (typeof address !== "string" || address.length < 32 || address.length > 44) {
    throw new AccountError(400, "a Solana wallet address is required");
  }
  return challenges.issue(address, domain);
}

// Wallet login, step 2: the wallet signs the challenge message. The challenge is consumed even on failure.
export function walletLogin({ nonce, address, signature }) {
  const entry = challenges.take(String(nonce || ""));
  if (!entry) throw new AccountError(401, "the sign-in challenge is missing, used, or expired; start again");
  if (entry.address !== address) throw new AccountError(401, "that wallet does not match the challenge");
  if (!verifyWalletSignature(address, entry.message, String(signature || ""))) {
    throw new AccountError(401, "the signature does not match the wallet");
  }
  return createSession("user", address);
}

// The identity: each user's associated token account for the identity mint on the chosen chain.
// The mint is supplied by the admin's chain setup; until one exists, the identity is reported as pending.
export function identityView(address, identityMint) {
  if (!identityMint) return { user: address, status: "pending", note: "no identity mint on this chain yet" };
  return { ...identityFor(address, identityMint), status: "derived" };
}

export function policyView() {
  return loadPolicy();
}

// True while the admin still has the first-run password. Chain and real-money changes are refused until it is changed.
export function adminMustChange() {
  return loadAdmin(adminPath).mustChange === true;
}

// Saves the chain policy. Only the admin session can reach this; the route enforces that.
export function changePolicy(changes, by) {
  if (adminMustChange()) {
    throw new AccountError(403, "change the default admin password before changing the chain");
  }
  return savePolicy({ ...loadPolicy(), ...changes }, by);
}

export class AccountError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
