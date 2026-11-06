// Browser-side wallet sign-in. Loaded as a plain script by /login, and also imported by the Node unit tests,
// so the logic that decides errors and signatures is tested without a browser.
// No dependency on window at load time: every browser object is passed in.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// Phantom's documented provider is window.phantom.solana. window.solana is a legacy alias that another wallet
// may own, so we prefer the documented path and only accept a provider that actually identifies itself.
export function findProvider(win) {
  const phantom = win && win.phantom && win.phantom.solana;
  if (phantom && phantom.isPhantom) return { name: "Phantom", provider: phantom };
  const legacy = win && win.solana;
  if (legacy && legacy.isPhantom) return { name: "Phantom (legacy path)", provider: legacy };
  const solflare = win && win.solflare;
  if (solflare && solflare.isSolflare) return { name: "Solflare", provider: solflare };
  if (legacy && typeof legacy.signMessage === "function") return { name: "a Solana wallet", provider: legacy };
  return null;
}

export function bs58Encode(bytes) {
  const data = Array.from(bytes);
  let zeros = 0;
  while (zeros < data.length && data[zeros] === 0) zeros++;
  let n = 0n;
  for (const b of data) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  return "1".repeat(zeros) + out;
}

// Wallets reject with an Error, a plain object ({ code, message }), a string, or nothing useful at all.
// This turns every shape into text the user can act on, and keeps the wallet's numeric code when it has one.
export function describeWalletError(err) {
  if (err === null || err === undefined) return { message: "the wallet returned no error details", code: null };
  if (typeof err === "string") return { message: err, code: null };
  const code = err.code !== undefined ? err.code : null;
  const text = typeof err.message === "string" && err.message.trim() ? err.message.trim() : null;
  if (text) return { message: text, code };
  if (typeof err.error === "string" && err.error) return { message: err.error, code };
  if (typeof err.error === "object" && err.error && typeof err.error.message === "string") {
    return { message: err.error.message, code: err.error.code ?? code };
  }
  if (code !== null) return { message: "the wallet reported error code " + code + " with no message", code };
  return { message: "the wallet rejected the request without a reason", code: null };
}

// Accepts the standard shape ({ signature: Uint8Array }) or bare bytes, and refuses anything else.
export function signatureBytes(signed) {
  const bytes = signed && typeof signed === "object" && signed.signature !== undefined ? signed.signature : signed;
  const isBytes = bytes instanceof Uint8Array || (Array.isArray(bytes) && bytes.every((b) => Number.isInteger(b) && b >= 0 && b < 256));
  if (!isBytes) throw new Error("the wallet returned a signature in a form this page does not understand");
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (data.length !== 64) throw new Error("the wallet returned " + data.length + " signature bytes; expected 64");
  return data;
}

// The sign-in steps. `api.post` and `wallet` are injected, so tests can drive every branch.
// `say` receives each status line. Errors are rethrown with a message that says which step failed.
export async function signIn({ wallet, api, say }) {
  let address;
  try {
    say("Approve the connection in your wallet.");
    const conn = await wallet.connect();
    address = conn && conn.publicKey ? String(conn.publicKey.toString()) : null;
    if (!address) throw new Error("the wallet connected without returning a public key");
  } catch (err) {
    throw stepError("connecting to the wallet", err);
  }

  let challenge;
  try {
    challenge = await api.post("/api/login/challenge", { address });
  } catch (err) {
    throw stepError("requesting a sign-in challenge", err);
  }

  let signature;
  try {
    say("Approve the sign-in message in your wallet. It sends no transaction.");
    const bytes = new TextEncoder().encode(challenge.message);
    const signed = await wallet.signMessage(bytes, "utf8");
    signature = bs58Encode(signatureBytes(signed));
  } catch (err) {
    throw stepError("signing the message", err);
  }

  try {
    await api.post("/api/login/verify", { nonce: challenge.nonce, address, signature });
  } catch (err) {
    throw stepError("verifying the signature", err);
  }
  return { address };
}

// Adds the step name to every failure, and keeps any wallet code, so a report can be matched to a cause.
// Server errors from /api/login/* arrive as plain Errors with the server's wording, so they pass through unchanged.
function stepError(step, err) {
  const described = describeWalletError(err);
  const codePart = described.code !== null ? " [code " + described.code + "]" : "";
  const out = new Error(described.message + codePart + " (while " + step + ")");
  out.step = step;
  return out;
}
