// Cross-reference structures.
// A structure is a rule for laying a ledger measurement against a paper claim.
// Old structures stay in this list. The gallery keeps their figures.
// v1 weighs any two percentages, and weighs a missing rate as zero.
// v2 opens the dial only when quantity, population, definition, and sample size all pass.

export const BLOCKS = 10;

export const STRUCTURES = [
  {
    id: "v1",
    status: "archived",
    title: "Open comparator",
    objectName: "Open comparator",
    fig: "Fig 1",
    created: "2026-11-06",
    summary:
      "Two percentages share a pan. The dial turns by their difference. A rate the ledger never counted is set on the pan as zero.",
    retiredReason:
      "The graduation flag and a 30-minute curve reading were weighed as one length. A wash rate that was never counted was weighed as zero.",
  },
  {
    id: "v2",
    status: "current",
    title: "Receiving gauge",
    objectName: "Receiving gauge",
    fig: "Fig 2",
    created: "2026-11-06",
    summary:
      "The dial opens only when the paper and the ledger share a quantity, a population, and a definition, and the ledger sample is large enough. Anything else stays in the hold tray.",
    retiredReason: null,
    replaces: "v1",
  },
];

export const CLAIMS = {
  "melt-dev-buy": {
    id: "melt-dev-buy",
    citation: "Hu and coauthors, MELT, arXiv:2602.13480",
    url: "https://arxiv.org/abs/2602.13480",
    quantityId: "dev-buy-share",
    quantity: "Share of creates that include a developer buy",
    populationId: "migrated-coins",
    population: "Coins that migrated, which is the set MELT keeps",
    definitionId: "dev-buy-in-create",
    definition: "The create transaction includes a buy by the creator",
    value: 0.987,
    sampleNote: "98.7 percent of creates in that migrated set include a developer buy.",
  },
  "dev-buy-usual": {
    id: "dev-buy-usual",
    citation: "Hu and coauthors, MELT, arXiv:2602.13480",
    url: "https://arxiv.org/abs/2602.13480",
    quantityId: "dev-buy-usual",
    quantity: "A developer buy is the usual create",
    populationId: "any-create-sample",
    population: "Any sample of create transactions",
    definitionId: "share-at-least-90",
    definition: "At least 90 percent of creates include a developer buy",
    value: 0.987,
    threshold: 0.9,
    sampleNote: "The coarse question uses MELT's 98.7 percent only as a rate that clears 90 percent.",
  },
  "ccs-graduation": {
    id: "ccs-graduation",
    citation: "Szwajcok, Tsuchiya, and coauthors, ACM CCS 2026, arXiv:2609.10246",
    url: "https://arxiv.org/abs/2609.10246",
    quantityId: "graduation-share",
    quantity: "Share of coins that graduate",
    populationId: "all-pump-coins-2024-2026",
    population: "All 15.2 million Pump.fun coins from January 2024 to January 2026",
    definitionId: "platform-graduation",
    definition: "The platform's graduation flag",
    value: 0.0102,
    sampleNote: "1.02 percent of those coins graduate.",
  },
  "ccs-wash": {
    id: "ccs-wash",
    citation: "Szwajcok, Tsuchiya, and coauthors, ACM CCS 2026, arXiv:2609.10246",
    url: "https://arxiv.org/abs/2609.10246",
    quantityId: "strict-wash-share",
    quantity: "Share of trades that are strict wash",
    populationId: "sampled-trades",
    population: "Trading transactions in the paper's samples",
    definitionId: "same-address-same-size-one-tx",
    definition: "The same address buys and sells the same amount inside one transaction",
    value: 0.17,
    sampleNote: "A strict wash definition covers 17 percent of trading transactions in their samples.",
  },
  "ccs-copycat": {
    id: "ccs-copycat",
    citation: "Szwajcok, Tsuchiya, and coauthors, ACM CCS 2026, arXiv:2609.10246",
    url: "https://arxiv.org/abs/2609.10246",
    quantityId: "copycat-share",
    quantity: "Share of coins that are copycats",
    populationId: "all-pump-coins-2024-2026",
    population: "All Pump.fun coins in the factory study",
    definitionId: "name-copycat",
    definition: "A copy of another coin's name or theme",
    value: 0.1,
    sampleNote: "At least 1.5 million copycats, over 10 percent of coins. The open comparator treats 10 percent as a point.",
  },
  "gafarov-under-1sol": {
    id: "gafarov-under-1sol",
    citation: "Gafarov, arXiv:2610.39458",
    url: "https://arxiv.org/abs/2610.39458",
    quantityId: "never-above-1-sol",
    quantity: "Share of launches that never hold more than 1 SOL",
    populationId: "gafarov-88h",
    population: "200,443 launches in one complete 88-hour window",
    definitionId: "continuous-curve-max",
    definition: "The curve never holds more than 1 SOL during the window",
    value: 0.53,
    sampleNote: "53 percent of launches in that window never hold more than 1 SOL.",
  },
};

// measurementId values are filled from the ledger on each run.
// The identity fields below are what the receiving gauge compares to the claim.
export const MEASUREMENT_SPECS = {
  "dev-buy-share": {
    quantityId: "dev-buy-share",
    quantity: "Share of creates that include a developer buy",
    populationId: "kept-creates",
    population: "Successful creates this watcher kept",
    definitionId: "dev-buy-in-create",
    definition: "The create transaction includes a buy by the creator",
  },
  "dev-buy-usual": {
    quantityId: "dev-buy-usual",
    quantity: "A developer buy is the usual create",
    populationId: "any-create-sample",
    population: "Any sample of create transactions",
    definitionId: "share-at-least-90",
    definition: "At least 90 percent of creates include a developer buy",
  },
  "above-5-30m": {
    quantityId: "above-5-sol-at-30m",
    quantity: "Share of 30-minute readings still at least 5 SOL",
    populationId: "kept-30m-snapshots",
    population: "Kept mints that have a 30-minute curve snapshot",
    definitionId: "real-sol-at-least-5-at-30m",
    definition: "The stored 30-minute real_sol reading is at least 5 SOL",
  },
  "repeat-mint-share": {
    quantityId: "repeat-creator-share",
    quantity: "Share of mints from a creator who already launched",
    populationId: "kept-creates",
    population: "Successful creates this watcher kept",
    definitionId: "repeat-creator-wallet",
    definition: "The same creator wallet appears on more than one kept mint",
  },
  "wash-share": {
    quantityId: "strict-wash-share",
    quantity: "Share of trades that are strict wash",
    populationId: "sampled-trades",
    population: "Trading transactions in the study sample",
    definitionId: "same-address-same-size-one-tx",
    definition: "The same address buys and sells the same amount inside one transaction",
  },
  "checkpoint-under-1": {
    quantityId: "checkpoint-peak-under-1-sol",
    quantity: "Share whose highest stored checkpoint is under 1 SOL",
    populationId: "kept-creates-with-a-curve",
    population: "Kept mints with at least one curve reading",
    definitionId: "max-stored-checkpoint",
    definition: "The highest stored checkpoint reading is at most 1 SOL",
  },
};

export const JOINTS = [
  joint("v1", "v1-dev", "Developer buy", "melt-dev-buy", "dev-buy-share", "raw-percent", 0),
  joint("v1", "v1-grad", "Graduation", "ccs-graduation", "above-5-30m", "raw-percent", 0),
  joint("v1", "v1-copy", "Copycats", "ccs-copycat", "repeat-mint-share", "raw-percent", 0),
  joint("v1", "v1-wash", "Wash trades", "ccs-wash", "wash-share", "raw-percent", 0),
  joint("v1", "v1-small", "Under 1 SOL", "gafarov-under-1sol", "checkpoint-under-1", "raw-percent", 0),
  joint("v2", "v2-dev", "Developer buy", "melt-dev-buy", "dev-buy-share", "receiving", 200),
  joint("v2", "v2-usual", "Developer buy, usual", "dev-buy-usual", "dev-buy-usual", "threshold", 200),
  joint("v2", "v2-grad", "Graduation", "ccs-graduation", "above-5-30m", "receiving", 200),
  joint("v2", "v2-copy", "Copycats", "ccs-copycat", "repeat-mint-share", "receiving", 200),
  joint("v2", "v2-wash", "Wash trades", "ccs-wash", "wash-share", "receiving", 100),
  joint("v2", "v2-small", "Under 1 SOL", "gafarov-under-1sol", "checkpoint-under-1", "receiving", 200),
];

function joint(structureId, id, title, claimId, measurementId, mode, minN) {
  return { structureId, id, title, claimId, measurementId, mode, minN, tol: 0.02 };
}

export function measureLedger(db) {
  const tokens = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(dev_buy), 0) AS buys FROM tokens").get();
  const n = Number(tokens.n) || 0;
  const buys = Number(tokens.buys) || 0;
  const snap = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN CAST(real_sol_lamports AS INTEGER) >= 5000000000 THEN 1 ELSE 0 END), 0) AS above5,
              COALESCE(SUM(CASE WHEN CAST(real_sol_lamports AS INTEGER) > 105000000000 THEN 1 ELSE 0 END), 0) AS absurd,
              COALESCE(SUM(CASE WHEN CAST(real_sol_lamports AS INTEGER) >= 5000000000
                            AND CAST(real_sol_lamports AS INTEGER) <= 105000000000 THEN 1 ELSE 0 END), 0) AS plausible
       FROM snapshots
       WHERE checkpoint = '30m' AND real_sol_lamports IS NOT NULL`
    )
    .get();
  const n30 = Number(snap.n) || 0;
  const above5 = Number(snap.above5) || 0;
  const absurd = Number(snap.absurd) || 0;
  const plausible = Number(snap.plausible) || 0;
  const repeat = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tokens
       WHERE creator IS NOT NULL AND creator IN (
         SELECT creator FROM tokens WHERE creator IS NOT NULL GROUP BY creator HAVING COUNT(*) > 1
       )`
    )
    .get();
  const repeatN = Number(repeat.n) || 0;
  const peak = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN peak <= 1000000000 THEN 1 ELSE 0 END), 0) AS under
       FROM (
         SELECT mint, MAX(CAST(real_sol_lamports AS INTEGER)) AS peak
         FROM snapshots
         WHERE real_sol_lamports IS NOT NULL AND IFNULL(curve_missing, 0) = 0
         GROUP BY mint
       )`
    )
    .get();
  const peakN = Number(peak.n) || 0;
  const under = Number(peak.under) || 0;
  const investigations = Number(db.prepare("SELECT COUNT(*) AS n FROM investigations").get().n) || 0;

  const dev = ratio(buys, n);
  const rows = {
    "dev-buy-share": specRow("dev-buy-share", dev, n, `${buys} of ${n} kept creates include a creator buy.`),
    "dev-buy-usual": specRow("dev-buy-usual", dev, n, `${buys} of ${n} kept creates include a creator buy.`),
    "above-5-30m": specRow(
      "above-5-30m",
      ratio(above5, n30),
      n30,
      `${above5} of ${n30} thirty-minute readings are at least 5 SOL. ${absurd} read above 105 SOL. ${plausible} sit between 5 and 105 SOL.`
    ),
    "repeat-mint-share": specRow(
      "repeat-mint-share",
      ratio(repeatN, n),
      n,
      `${repeatN} of ${n} mints come from a creator wallet that launched more than once.`
    ),
    "wash-share": specRow(
      "wash-share",
      null,
      0,
      `${investigations} holder investigations are saved. None of them is a count of wash trades.`
    ),
    "checkpoint-under-1": specRow(
      "checkpoint-under-1",
      ratio(under, peakN),
      peakN,
      `${under} of ${peakN} mints have a highest stored checkpoint of at most 1 SOL.`
    ),
  };
  return {
    tokens: n,
    extra: {
      above5,
      absurd,
      plausible,
      n30,
      investigations,
    },
    rows,
  };
}

function specRow(id, value, n, note) {
  return { id, ...MEASUREMENT_SPECS[id], value, n, note };
}

function ratio(part, whole) {
  if (!whole) return null;
  return part / whole;
}

export function presentStructure(structureId, measured) {
  return JOINTS.filter((item) => item.structureId === structureId).map((item) =>
    presentJoint(item, measured.rows[item.measurementId], CLAIMS[item.claimId])
  );
}

export function presentJoint(joint, local, claim) {
  const judged = judge(joint, local, claim);
  const shownLocal = joint.mode === "raw-percent" && local.value == null ? 0 : local.value;
  return {
    id: joint.id,
    structureId: joint.structureId,
    title: joint.title,
    mode: joint.mode,
    claimId: claim.id,
    measurementId: local.id,
    citation: claim.citation,
    url: claim.url,
    verdict: judged.verdict,
    reason: judged.reason,
    claim: claim.value,
    local: shownLocal,
    localMissing: local.value == null,
    delta: judged.delta,
    n: local.n,
    note: local.note,
    quantityId: local.quantityId,
    populationId: local.populationId,
    definitionId: local.definitionId,
    blades: judged.blades,
    dial: judged.dial,
    token: judged.token,
    needle: judged.needle,
    paperBlocks: blocksOf(claim.value),
    ledgerBlocks: blocksOf(shownLocal),
  };
}

function blocksOf(value) {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(BLOCKS, Math.round(value * BLOCKS)));
}

export function judge(joint, local, claim) {
  if (joint.mode === "raw-percent") return judgeRaw(local, claim);
  if (joint.mode === "threshold") return judgeThreshold(joint, local, claim);
  return judgeReceiving(joint, local, claim);
}

function judgeRaw(local, claim) {
  const used = local.value == null ? 0 : local.value;
  const delta = used - claim.value;
  const relative = Math.abs(delta) / Math.max(Math.abs(claim.value), 1e-9);
  const agree = relative <= 0.15 || Math.abs(delta) <= 0.02;
  const missing = local.value == null
    ? " The ledger has no rate, and this structure enters that absence as zero."
    : "";
  const band = agree
    ? " This structure calls that a match when the gap is within 2 percentage points, or within 15 percent of the paper's rate."
    : " The gap is wider than that band, so this structure calls it a difference.";
  return {
    verdict: agree ? "agree" : "diverge",
    delta,
    blades: null,
    dial: "live",
    token: "anvil",
    needle: clamp(delta / 0.4, -0.42, 0.42),
    reason:
      `Compared directly: ledger ${pct(used)} (${local.definition}) against paper ${pct(claim.value)} (${claim.definition}).` +
      band +
      missing +
      (local.note ? ` ${local.note}` : ""),
  };
}

function judgeThreshold(joint, local, claim) {
  const bar = claim.threshold ?? 0.9;
  const blades = {
    quantity: true,
    population: true,
    definition: local.value != null && claim.value != null,
    sample: local.value != null && local.n >= joint.minN,
  };
  if (!blades.sample || !blades.definition) {
    return held("thin", blades, local, claim, sampleReason(joint, local));
  }
  const localPass = local.value >= bar;
  const claimPass = claim.value >= bar;
  const delta = local.value - claim.value;
  if (localPass && claimPass) {
    return {
      verdict: "agree",
      delta,
      blades,
      dial: "mark",
      token: "anvil",
      needle: 0.08,
      reason:
        `Both samples clear ${(bar * 100).toFixed(0)} percent, so a developer buy is usual in each. ` +
        `Ledger ${pct(local.value)} on ${local.population.toLowerCase()}. Paper ${pct(claim.value)} on ${claim.population.toLowerCase()}. ` +
        `This stop does not match the two rates to each other. ${local.note}`,
    };
  }
  return {
    verdict: "diverge",
    delta,
    blades,
    dial: "live",
    token: "anvil",
    needle: clamp(delta / 0.4, -0.42, 0.42),
    reason:
      `One sample is under ${(bar * 100).toFixed(0)} percent. Ledger ${pct(local.value)}. Paper ${pct(claim.value)}. ${local.note}`,
  };
}

function judgeReceiving(joint, local, claim) {
  const blades = {
    quantity: local.quantityId === claim.quantityId,
    population: local.populationId === claim.populationId,
    definition: local.definitionId === claim.definitionId,
    sample: local.value != null && local.n >= joint.minN,
  };
  if (!blades.quantity || !blades.population || !blades.definition) {
    const failed = [];
    if (!blades.quantity) failed.push(`quantity (${local.quantity} against ${claim.quantity})`);
    if (!blades.population) failed.push(`population (${local.population} against ${claim.population})`);
    if (!blades.definition) failed.push(`definition (${local.definition} against ${claim.definition})`);
    return held(
      "incomparable",
      blades,
      local,
      claim,
      `Held. The gates that differ: ${failed.join("; ")}. ${local.note || ""}`.trim()
    );
  }
  if (!blades.sample) {
    return held("thin", blades, local, claim, `${sampleReason(joint, local)} ${local.note || ""}`.trim());
  }
  const lo = claim.low ?? claim.value;
  const hi = claim.high ?? claim.value;
  const delta = local.value - claim.value;
  const agree = local.value >= lo - joint.tol && local.value <= hi + joint.tol;
  return {
    verdict: agree ? "agree" : "diverge",
    delta,
    blades,
    dial: "live",
    token: "anvil",
    needle: clamp(delta / 0.4, -0.42, 0.42),
    reason: agree
      ? `The dial opens. Ledger ${pct(local.value)} sits with paper ${pct(claim.value)} under the same definition. ${local.note}`
      : `The dial opens. Ledger ${pct(local.value)} and paper ${pct(claim.value)} count the same thing and differ. ${local.note}`,
  };
}

function held(verdict, blades, local, claim, reason) {
  return {
    verdict,
    delta: null,
    blades,
    dial: "held",
    token: "tray",
    needle: -0.18,
    reason,
    claim: claim.value,
    local: local.value,
  };
}

function sampleReason(joint, local) {
  if (local.value == null) {
    return `The ledger has not counted this. The rate is left empty. This joint waits for ${joint.minN} rows.`;
  }
  return `The ledger sample has ${local.n} rows. This joint waits for ${joint.minN}.`;
}

export function pct(value) {
  if (value == null || Number.isNaN(Number(value))) return "absent";
  const points = Number(value) * 100;
  if (points !== 0 && Math.abs(points) < 10) return `${points.toFixed(2)}%`;
  return `${points.toFixed(1)}%`;
}

export function verdictLabel(verdict) {
  if (verdict === "agree") return "Agree";
  if (verdict === "diverge") return "Diverge";
  if (verdict === "thin") return "Thin sample";
  if (verdict === "incomparable") return "Held";
  return verdict;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}
