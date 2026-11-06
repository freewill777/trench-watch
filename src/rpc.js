const DEFAULT_HTTP = "https://api.mainnet-beta.solana.com";

export class Rpc {
  constructor(url = process.env.SOLANA_RPC_URL || DEFAULT_HTTP) {
    this.url = url;
    this.gapMs = Number(process.env.RPC_GAP_MS || 250);
    this.nextAt = 0;
    this.tail = Promise.resolve();
    this.calls = 0;
    this.errors = 0;
  }

  call(method, params) {
    const run = async () => {
      const wait = Math.max(0, this.nextAt - Date.now());
      this.nextAt = Date.now() + wait + this.gapMs;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      let lastErr;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await fetch(this.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            signal: AbortSignal.timeout(15_000),
          });
          if (res.status === 429 || res.status >= 500) {
            this.errors += 1;
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
            continue;
          }
          const body = await res.json();
          if (body.error) {
            this.errors += 1;
            const code = body.error.code;
            if (code === 429 || code === -32005) {
              await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
              continue;
            }
            throw new Error(`${method}: ${body.error.message || JSON.stringify(body.error)}`);
          }
          this.calls += 1;
          return body.result;
        } catch (err) {
          lastErr = err;
          this.errors += 1;
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
      throw lastErr || new Error(`${method} failed`);
    };
    const pending = this.tail.then(run, run);
    this.tail = pending.then(
      () => {},
      () => {}
    );
    return pending;
  }
}
