import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AccountError,
  adminLogin,
  confirmAdminPassword,
  changeAdminPassword,
  changePolicy,
  clearCookie,
  cookieValue,
  endSession,
  identityView,
  issueChallenge,
  policyView,
  sessionCookie,
  sessionFrom,
  walletLogin,
  SESSION_COOKIE,
} from "./accounts.js";
import { CHAINS } from "./chain-policy.js";
import { ADMIN_USER } from "./auth.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOMAIN = "Trench Watch";

// Routes for /admin, /login and the identity API. Returns true when the request was handled.
// Every admin mutation needs a valid admin session cookie. The panel passes in its JSON helpers.
export async function handleIdentity(req, res, url, helpers) {
  const { sendJson, readBody } = helpers;
  const clientKey = req.socket.remoteAddress || "unknown";
  const session = sessionFrom(cookieValue(req.headers.cookie, SESSION_COOKIE));

  if (url.pathname === "/admin" || url.pathname === "/admin/") {
    return page(res, "admin/index.html");
  }
  if (url.pathname === "/login" || url.pathname === "/login/") {
    return page(res, "login/index.html");
  }
  if (url.pathname === "/identity/login/wallet-login.js") {
    return asset(res, "login/wallet-login.js", "text/javascript; charset=utf-8");
  }

  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    try {
      const body = parse(await readBody(req));
      const token = adminLogin(clientKey, String(body.user || ""), String(body.password || ""));
      res.setHeader("set-cookie", sessionCookie(token));
      sendJson(res, 200, { ok: true });
    } catch (err) {
      fail(res, sendJson, err);
    }
    return true;
  }
  if (url.pathname === "/api/admin/logout" && req.method === "POST") {
    endSession(cookieValue(req.headers.cookie, SESSION_COOKIE));
    res.setHeader("set-cookie", clearCookie());
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (url.pathname === "/api/admin/state" && req.method === "GET") {
    if (!isAdmin(session)) return sendJson(res, 401, { error: "admin login required" }), true;
    sendJson(res, 200, { policy: policyView(), chains: CHAINS });
    return true;
  }
  if (url.pathname === "/api/admin/policy" && req.method === "POST") {
    if (!isAdmin(session)) return sendJson(res, 401, { error: "admin login required" }), true;
    try {
      const body = parse(await readBody(req));
      // Chain and real-money changes need the password again, so an unattended, unlocked tab cannot change them.
      confirmAdminPassword(clientKey, String(body.password || ""));
      const saved = changePolicy(pick(body), "admin");
      sendJson(res, 200, { policy: saved });
    } catch (err) {
      fail(res, sendJson, err);
    }
    return true;
  }
  if (url.pathname === "/api/admin/password" && req.method === "POST") {
    if (!isAdmin(session)) return sendJson(res, 401, { error: "admin login required" }), true;
    try {
      const body = parse(await readBody(req));
      changeAdminPassword(String(body.password || ""));
      sendJson(res, 200, { ok: true });
    } catch (err) {
      fail(res, sendJson, err);
    }
    return true;
  }
  if (url.pathname === "/api/login/challenge" && req.method === "POST") {
    try {
      const body = parse(await readBody(req));
      sendJson(res, 200, issueChallenge(String(body.address || ""), DOMAIN));
    } catch (err) {
      fail(res, sendJson, err);
    }
    return true;
  }
  if (url.pathname === "/api/login/verify" && req.method === "POST") {
    try {
      const body = parse(await readBody(req));
      const token = walletLogin({
        nonce: String(body.nonce || ""),
        address: String(body.address || ""),
        signature: String(body.signature || ""),
      });
      res.setHeader("set-cookie", sessionCookie(token));
      sendJson(res, 200, { ok: true, address: String(body.address) });
    } catch (err) {
      fail(res, sendJson, err);
    }
    return true;
  }
  if (url.pathname === "/api/me" && req.method === "GET") {
    if (!session) return sendJson(res, 200, { signedIn: false }), true;
    if (session.kind === "admin") return sendJson(res, 200, { signedIn: true, kind: "admin", user: "admin" }), true;
    sendJson(res, 200, { signedIn: true, kind: "user", address: session.subject, identity: identityView(session.subject, null) });
    return true;
  }
  return false;
}

function isAdmin(session) {
  return Boolean(session && session.kind === "admin");
}



function pick(body) {
  const out = {};
  if (body.chain !== undefined) out.chain = String(body.chain);
  if (body.customUrl !== undefined) out.customUrl = body.customUrl === "" ? null : String(body.customUrl);
  if (body.realMoneyEnabled !== undefined) out.realMoneyEnabled = body.realMoneyEnabled === true;
  return out;
}

function parse(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new AccountError(400, "the request body is not valid JSON");
  }
}

function fail(res, sendJson, err) {
  const status = err instanceof AccountError ? err.status : 400;
  sendJson(res, status, { error: err.message });
}

// Serves one fixed script next to the login page. The path is a constant, so no request can choose another file.
function asset(res, rel, type) {
  const file = path.join(root, "identity", rel);
  if (!fs.existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
    return true;
  }
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(fs.readFileSync(file));
  return true;
}

function page(res, rel) {
  const file = path.join(root, "identity", rel);
  if (!fs.existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
    return true;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(fs.readFileSync(file));
  return true;
}
