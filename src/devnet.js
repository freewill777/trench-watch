import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SolanaRpc } from "./solana-rpc.js";
import { LAMPORTS_PER_SOL, SIGNATURE_FEE_LAMPORTS } from "./solana-tx.js";
import { GAME_WALLET, createWallet, listWallets, loadWallet, playerNames, runsDir } from "./devnet-wallets.js";
import { NETWORKS, readActiveNetwork, writeActiveNetwork } from "./solana-networks.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAYER_TARGET = 0.1 * LAMPORTS_PER_SOL;
const TEST_TRANSFER = 0.001 * LAMPORTS_PER_SOL;
const DEFAULT_PLAYERS = 4;
const FAUCET_CHUNK = 1 * LAMPORTS_PER_SOL;
const MIN_GAME_BALANCE = 0.25 * LAMPORTS_PER_SOL;

const sol = (lamports) => (lamports / LAMPORTS_PER_SOL).toFixed(6);
const args = process.argv.slice(2);
const command = args[0] || "help";
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeRun(kind, data) {
  fs.mkdirSync(runsDir, { recursive: true });
  const file = path.join(runsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${kind}.json`);
  fs.writeFileSync(file, JSON.stringify({ kind, at: new Date().toISOString(), ...data }, null, 2) + "\n");
  return file;
}

// Every command that reads a balance or signs connects through here. The RPC must report the active network's genesis hash.
// A mainnet URL, the other test cluster, or an unknown chain stops the command before any key is used.
async function connect() {
  const network = readActiveNetwork();
  const rpc = new SolanaRpc(network);
  await rpc.assertNetwork();
  return rpc;
}

function gameAndPlayers() {
  const game = loadWallet(GAME_WALLET);
  const players = listWallets()
    .filter((name) => name.startsWith("player-"))
    .sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]))
    .map((name) => loadWallet(name));
  return { game, players };
}

// Sets the network the game wallets use. The RPC is checked first, so the saved choice always names a real chain.
async function cmdUse() {
  const name = args[1];
  if (!name || !NETWORKS[name]) throw new Error(`usage: use <${Object.keys(NETWORKS).join("|")}>`);
  const rpc = new SolanaRpc(name);
  await rpc.assertNetwork();
  const file = writeActiveNetwork(name);
  console.log(`active network set to ${name} (${new URL(rpc.url).host} reports its genesis hash). Saved to ${file}`);
}

function cmdNetwork() {
  const name = readActiveNetwork();
  console.log(`active network: ${name} (${NETWORKS[name].genesis})`);
}

async function cmdInit() {
  const count = Number(flag("--players", DEFAULT_PLAYERS));
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("--players must be 1 to 20");
  const names = [GAME_WALLET, ...playerNames(count)];
  const rows = [];
  for (const name of names) {
    const role = name === GAME_WALLET ? "game" : "player";
    const result = createWallet(name, role);
    rows.push({ name, address: result.address, created: result.created });
  }
  console.table(rows);
  console.log("Keys are in devnet/wallets/ (git-ignored). Nothing was sent.");
}

async function cmdBalances() {
  const rpc = await connect();
  const { game, players } = gameAndPlayers();
  const rows = [];
  for (const w of [game, ...players]) {
    const lamports = await rpc.balance(w.address);
    rows.push({ name: w.name, address: w.address, sol: sol(lamports), lamports });
  }
  console.table(rows.map(({ lamports, ...rest }) => rest));
  return rows;
}

async function cmdFund() {
  const rpc = await connect();
  const game = loadWallet(GAME_WALLET);
  const target = Number(flag("--sol", 2)) * LAMPORTS_PER_SOL;
  const signatures = [];
  let balance = await rpc.balance(game.address);
  while (balance < target) {
    const chunk = Math.min(FAUCET_CHUNK, target - balance);
    console.log(`requesting ${sol(chunk)} SOL for the game wallet`);
    try {
      signatures.push(await rpc.airdrop(game.address, chunk));
    } catch (err) {
      console.log(`faucet refused: ${err.message}`);
      console.log(`The RPC faucet on ${rpc.network} is closed or rate-limited. Wait, then run fund again, or use that network's faucet website for the game address.`);
      break;
    }
    balance = await rpc.balance(game.address);
  }
  const file = writeRun("fund", { game: game.address, signatures, balanceSol: sol(balance), targetSol: sol(target) });
  console.log(`game balance ${sol(balance)} SOL. Run record: ${file}`);
  if (balance < target) {
    console.log(`short of the ${sol(target)} SOL target. Fund ${game.address} on ${rpc.network} from that network's faucet, then run balances again.`);
    process.exitCode = 1;
  }
  return balance;
}
async function cmdDistribute() {
  const rpc = await connect();
  const { game, players } = gameAndPlayers();
  if (players.length === 0) throw new Error("no player wallets; run init first");
  const plan = [];
  for (const p of players) {
    const have = await rpc.balance(p.address);
    const need = Math.max(0, PLAYER_TARGET - have);
    plan.push({ player: p.name, address: p.address, haveSol: sol(have), sendSol: sol(need), need });
  }
  const total = plan.reduce((sum, row) => sum + row.need, 0);
  const gameBefore = await rpc.balance(game.address);
  if (gameBefore < total + MIN_GAME_BALANCE) {
    throw new Error(`game wallet holds ${sol(gameBefore)} SOL; needs ${sol(total + MIN_GAME_BALANCE)} to distribute. Run fund first.`);
  }
  const sent = [];
  for (const row of plan) {
    if (row.need <= 0) continue;
    const player = players.find((p) => p.name === row.player);
    const signature = await rpc.transfer({ payer: game.keypair, to: player.address, lamports: row.need });
    sent.push({ player: row.player, lamports: row.need, signature });
    console.log(`sent ${row.sendSol} SOL to ${row.player}: ${signature}`);
  }
  const table = [];
  for (const p of players) table.push({ player: p.name, sol: sol(await rpc.balance(p.address)) });
  console.table(table);
  const file = writeRun("distribute", { game: game.address, sent, playerBalances: table });
  console.log(`Run record: ${file}`);
}

async function cmdTest() {
  const rpc = await connect();
  const { game, players } = gameAndPlayers();
  if (players.length < 2) throw new Error("the test needs at least two player wallets");
  const ring = [game, ...players, game];
  const hops = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const from = ring[i];
    const to = ring[i + 1];
    const fromBefore = await rpc.balance(from.address);
    const toBefore = await rpc.balance(to.address);
    if (fromBefore < TEST_TRANSFER + SIGNATURE_FEE_LAMPORTS) {
      throw new Error(`${from.name} holds ${sol(fromBefore)} SOL, which cannot cover a 0.001 transfer plus fee`);
    }
    const signature = await rpc.transfer({ payer: from.keypair, to: to.address, lamports: TEST_TRANSFER });
    const tx = await rpc.parsedTransaction(signature);
    const fee = tx.meta.fee;
    const toAfter = await rpc.balance(to.address);
    const fromAfter = await rpc.balance(from.address);
    const received = toAfter - toBefore;
    const spent = fromBefore - fromAfter;
    const hop = {
      from: from.name,
      to: to.name,
      signature,
      sentLamports: TEST_TRANSFER,
      receivedLamports: received,
      feeLamports: fee,
      fromSpentLamports: spent,
      ok: received === TEST_TRANSFER && spent === TEST_TRANSFER + fee && fee === SIGNATURE_FEE_LAMPORTS,
    };
    hops.push(hop);
    console.log(`${hop.from} -> ${hop.to}: received ${received} lamports, fee ${fee}, ${hop.ok ? "OK" : "MISMATCH"}`);
  }
  const allOk = hops.every((h) => h.ok);
  const file = writeRun("test", { hops, allOk });
  console.log(allOk ? `All ${hops.length} hops matched on-chain. Run record: ${file}` : `Mismatch found. Run record: ${file}`);
  if (!allOk) process.exitCode = 1;
}

const HELP = `Usage: npm run devnet -- <command>

  network              show the active game network (devnet by default)
  use <devnet|testnet> choose the network; the RPC must report its genesis hash first
  init [--players N]   create the game wallet and N player wallets (default 4). Never overwrites a key.
  balances             show every wallet's balance on the active network
  fund [--sol N]       request SOL for the game wallet until it holds N SOL (default 2)
  distribute           top each player up to 0.1 SOL from the game wallet
  test                 send a ring of 0.001 SOL transfers and check each one on-chain

Every command first confirms the RPC reports the active network's genesis hash.`;

const commands = {
  network: cmdNetwork,
  use: cmdUse,
  init: cmdInit,
  balances: cmdBalances,
  fund: cmdFund,
  distribute: cmdDistribute,
  test: cmdTest,
};

if (!commands[command]) {
  console.log(HELP);
  process.exitCode = command === "help" ? 0 : 1;
} else {
  Promise.resolve()
    .then(() => commands[command]())
    .catch((err) => {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    });
}
