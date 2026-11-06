export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

const CREATE_LOG = /Instruction: CreateV2(?:\s|$)|Instruction: Create(?:\s|$)/;

export function isCreateLog(logs, err) {
  if (err) return false;
  const text = (logs || []).join("\n");
  return CREATE_LOG.test(text);
}

export function accountKeys(tx) {
  const msg = tx.transaction.message;
  const loaded = tx.meta?.loadedAddresses || {};
  return [
    ...msg.accountKeys,
    ...(loaded.writable || []),
    ...(loaded.readonly || []),
  ];
}

function keyAt(keys, index) {
  const k = keys[index];
  return typeof k === "string" ? k : k?.pubkey || null;
}

function pumpInstructions(tx, keys) {
  const found = [];
  const top = tx.transaction.message.instructions || [];
  for (const ix of top) found.push(ix);
  for (const group of tx.meta?.innerInstructions || []) {
    for (const ix of group.instructions || []) found.push(ix);
  }
  return found.filter((ix) => {
    if (ix.programId === PUMP_PROGRAM) return true;
    return keyAt(keys, ix.programIdIndex) === PUMP_PROGRAM;
  });
}

function ixAccounts(ix, keys) {
  return (ix.accounts || []).map((a) => (typeof a === "string" ? a : keyAt(keys, a)));
}

export function decodeCreate(tx) {
  if (!tx || tx.meta?.err) return null;
  const keys = accountKeys(tx);
  const ixs = pumpInstructions(tx, keys);
  let create = null;
  for (const ix of ixs) {
    const accounts = ixAccounts(ix, keys);
    const mint = accounts[0];
    if (mint && mint.endsWith("pump") && accounts.length >= 14) {
      create = { accounts, mint };
      break;
    }
  }
  if (!create) return null;
  const mint = create.mint;
  const creator = create.accounts[5] || null;
  const bondingCurve = create.accounts[2] || null;
  const devBuy = ixs.some((ix) => {
    const accounts = ixAccounts(ix, keys);
    return accounts.includes(mint) && accounts[0] !== mint;
  });
  return {
    mint,
    creator,
    bondingCurve,
    devBuy: devBuy ? 1 : 0,
    slot: tx.slot,
    blockTime: tx.blockTime || null,
  };
}

export function parseCurve(base64) {
  const buf = Buffer.from(base64, "base64");
  if (buf.length < 49) return null;
  return {
    virtualTokenRaw: buf.readBigUInt64LE(8).toString(),
    virtualSolLamports: buf.readBigUInt64LE(16).toString(),
    supplyRaw: buf.readBigUInt64LE(40).toString(),
    realSolLamports: buf.readBigUInt64LE(32).toString(),
    complete: buf[48] === 1 ? 1 : 0,
  };
}

export function parseMint(base64) {
  const buf = Buffer.from(base64, "base64");
  if (buf.length < 82) return null;
  const mintAuthority = buf.readUInt32LE(0) === 0 ? 0 : 1;
  const supplyRaw = buf.readBigUInt64LE(36).toString();
  const freezeAuthority = buf.readUInt32LE(46) === 0 ? 0 : 1;
  const strings = [];
  let current = "";
  for (let i = 82; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 32 && b < 127) current += String.fromCharCode(b);
    else {
      if (/^[A-Za-z][A-Za-z0-9]{1,15}$/.test(current)) strings.push(current);
      current = "";
    }
  }
  if (/^[A-Za-z][A-Za-z0-9]{1,15}$/.test(current)) strings.push(current);
  const symbol = strings[0] || null;
  const name = strings.find((s) => s !== symbol && s.startsWith(symbol || "\0")) || strings[1] || symbol;
  return { mintAuthority, freezeAuthority, supplyRaw, name: name || null, symbol };
}

export function lamportsToSol(value) {
  if (value == null) return null;
  return Number(value) / 1e9;
}
