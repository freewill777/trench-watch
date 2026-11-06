import { DEFAULT_HTTP } from "./rpc.js";
import { loadWallet } from "./devnet-wallets.js";
import { LAMPORTS_PER_SOL } from "./solana-tx.js";
import { KNOWN_GENESIS, NETWORKS, readActiveNetwork, rpcUrlFor } from "./solana-networks.js";

// Live network status for the panel and the arena. A network is named only by the genesis hash its RPC reports,
// never by its URL. Hosts are shown without path or query, because a URL can carry an API key.

const TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;
let memo = { at: 0, value: null };

export function hostOf(url) {
  try {
    return new URL(url).host || "invalid";
  } catch {
    return "invalid";
  }
}

async function rpc(url, method, params, timeoutMs) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json().catch(() => null);
  if (!body) throw new Error("response was not JSON");
  if (body.error) throw new Error(body.error.message || "RPC error");
  return body.result;
}

// Never returns the URL. Error text is scrubbed of it in case a library echoes it back.
export async function probeNetwork(url, timeoutMs = PROBE_TIMEOUT_MS) {
  const host = hostOf(url);
  try {
    const genesis = await rpc(url, "getGenesisHash", [], timeoutMs);
    return { host, reachable: true, genesis, network: KNOWN_GENESIS[genesis] || "unknown", reason: null };
  } catch (err) {
    const reason = err.name === "TimeoutError" ? "timed out" : String(err.message || "failed").split(url).join("[url]");
    return { host, reachable: false, genesis: null, network: "unknown", reason };
  }
}

// Pure: turns a game-network probe and a ledger probe into the labels the UI shows.
// `game` is the probe for the active game network; `game.expected` is that network's name.
export function describeNetworks(game, ledger) {
  const name = game.expected.toUpperCase();
  let gameBadge;
  if (!game.reachable) {
    gameBadge = { tone: "warn", label: `${name} unreachable`, detail: `${game.host}: ${game.reason}` };
  } else if (game.network === game.expected) {
    gameBadge = { tone: "ok", label: name, detail: `${game.host} reports the ${game.expected} genesis hash` };
  } else {
    gameBadge = {
      tone: "bad",
      label: `NOT ${name}: ${game.network}`,
      detail: `${game.urlEnv} (${game.host}) reports ${game.network}. The CLI refuses to send.`,
    };
  }
  let ledgerBadge;
  if (!ledger.reachable) {
    ledgerBadge = { tone: "warn", label: "Ledger RPC unreachable", detail: `${ledger.host}: ${ledger.reason}` };
  } else if (ledger.network === "mainnet-beta") {
    ledgerBadge = { tone: "ok", label: "Ledger: mainnet-beta", detail: "real pump.fun launches, read-only" };
  } else {
    ledgerBadge = { tone: "warn", label: `Ledger: ${ledger.network}`, detail: `${ledger.host} reports ${ledger.network}` };
  }
  return { game: gameBadge, ledger: ledgerBadge };
}

export function gameAddress() {
  try {
    return loadWallet("game").address;
  } catch {
    return null;
  }
}

export async function networkStatus({ fresh = false } = {}) {
  if (!fresh && memo.value && Date.now() - memo.at < TTL_MS) return memo.value;
  const expected = readActiveNetwork();
  const gameUrl = rpcUrlFor(expected);
  const ledgerUrl = process.env.SOLANA_RPC_URL || DEFAULT_HTTP;
  const [probed, ledger] = await Promise.all([probeNetwork(gameUrl), probeNetwork(ledgerUrl)]);
  const gameProbe = { ...probed, expected, urlEnv: NETWORKS[expected].urlEnv };
  const address = gameAddress();
  const wallet = { address, sol: null };
  if (address && gameProbe.reachable && gameProbe.network === expected) {
    try {
      const res = await rpc(gameUrl, "getBalance", [address, { commitment: "confirmed" }], PROBE_TIMEOUT_MS);
      wallet.sol = res.value / LAMPORTS_PER_SOL;
    } catch {
      wallet.sol = null;
    }
  }
  const value = {
    checkedAt: Math.floor(Date.now() / 1000),
    activeNetwork: expected,
    game: gameProbe,
    ledger,
    wallet,
    badges: describeNetworks(gameProbe, ledger),
  };
  memo = { at: Date.now(), value };
  return value;
}
