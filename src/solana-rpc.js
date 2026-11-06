import { base58Decode, buildSignedTransfer } from "./solana-tx.js";
import { KNOWN_GENESIS, NETWORKS, requireGameNetwork, rpcUrlFor } from "./solana-networks.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class SolanaRpc {
  constructor(network = "devnet", url = rpcUrlFor(network)) {
    this.network = requireGameNetwork(network);
    this.url = url;
    this.nextId = 1;
  }

  // Retries only transport errors and HTTP 429. JSON-RPC errors are thrown at once, so a refused
  // faucet request is not repeated. A retried sendTransaction reuses the same signature, so the network dedupes it.
  async call(method, params = []) {
    const attempts = 3;
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await fetch(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        if (attempt >= attempts) throw new Error(`${method}: network error: ${err.message}`);
        await sleep(1000 * attempt);
        continue;
      }
      if (res.status === 429 && attempt < attempts) {
        await sleep(2000 * attempt);
        continue;
      }
      const body = await res.json().catch(() => null);
      if (!body) throw new Error(`${method}: HTTP ${res.status} without a JSON body`);
      if (body.error) throw new Error(`${method}: ${body.error.message || JSON.stringify(body.error)}`);
      return body.result;
    }
  }

  // Confirms the RPC reports the genesis hash of the network this client was built for. A mismatch
  // (mainnet, the other test cluster, or a wrong URL) stops every signing path. Only the host is printed.
  async assertNetwork() {
    const expected = NETWORKS[this.network].genesis;
    const genesis = await this.call("getGenesisHash");
    if (genesis !== expected) {
      const actual = KNOWN_GENESIS[genesis] || "an unknown chain";
      throw new Error(
        `refusing to continue: ${new URL(this.url).host} reports ${actual}, but the active network is ${this.network}`
      );
    }
    return genesis;
  }

  async balance(address) {
    const res = await this.call("getBalance", [address, { commitment: "confirmed" }]);
    return res.value;
  }

  // Devnet faucet through the RPC. The public endpoint rate-limits this, so a refusal surfaces as a thrown error.
  async airdrop(address, lamports) {
    const signature = await this.call("requestAirdrop", [address, lamports]);
    await this.waitForSignature(signature, 90_000);
    return signature;
  }

  async latestBlockhash() {
    const res = await this.call("getLatestBlockhash", [{ commitment: "confirmed" }]);
    return base58Decode(res.value.blockhash);
  }

  async waitForSignature(signature, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await this.call("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
      const status = res.value[0];
      if (status) {
        if (status.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
        if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return status;
      }
      await sleep(1000);
    }
    throw new Error(`transaction ${signature} not confirmed within ${timeoutMs / 1000}s`);
  }

  // Signs a System Program transfer with `payer`, dry-runs it with signature verification, then sends it.
  async transfer({ payer, to, lamports }) {
    const blockhash = await this.latestBlockhash();
    const tx = buildSignedTransfer({ payer, to: base58Decode(to), lamports, blockhash });
    const wire = tx.wire.toString("base64");
    const sim = await this.call("simulateTransaction", [
      wire,
      { encoding: "base64", sigVerify: true, commitment: "confirmed" },
    ]);
    if (sim.value.err) {
      throw new Error(`simulation rejected: ${JSON.stringify(sim.value.err)} ${(sim.value.logs || []).join(" | ")}`);
    }
    const signature = await this.call("sendTransaction", [
      wire,
      { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3 },
    ]);
    if (signature !== tx.signatureBase58) {
      throw new Error(`RPC returned ${signature}, expected ${tx.signatureBase58}`);
    }
    await this.waitForSignature(signature);
    return signature;
  }

  // Reads the confirmed transaction back, so the on-chain fee and transfer amount can be checked.
  async parsedTransaction(signature) {
    for (let i = 0; i < 10; i++) {
      const tx = await this.call("getTransaction", [
        signature,
        { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ]);
      if (tx) return tx;
      await sleep(1000);
    }
    throw new Error(`no transaction record for ${signature}`);
  }
}
