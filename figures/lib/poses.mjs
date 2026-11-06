// World pose of every moving part. The build draws parts at the first pose.
// The page runs this same function, injected as source, so the two cannot drift.

export function worldOf(joint, riderX, layout) {
  const out = {};
  for (let i = 0; i < layout.blocks; i++) {
    out[`paper-${i}`] = i < joint.paperBlocks
      ? [layout.paper.x, layout.paper.y, layout.panZ + i * layout.pitch]
      : [layout.paperRack.x0 + i * layout.paperRack.step, layout.paperRack.y, layout.rackZ];
    const weigh = joint.token !== "tray";
    out[`ledger-${i}`] = weigh && i < joint.ledgerBlocks
      ? [layout.ledger.x, layout.ledger.y, layout.panZ + i * layout.pitch]
      : [layout.ledgerRack.x0 + i * layout.ledgerRack.step, layout.ledgerRack.y, layout.rackZ];
  }
  out.rider = [riderX, layout.riderY, 0];
  if (layout.blades) {
    for (const name of layout.blades) {
      const down = joint.blades && joint.blades[name] === false;
      out[`blade-${name}`] = [0, 0, down ? layout.bladeDrop : 0];
    }
  }
  if (layout.gateOpen) out.gate = joint.dial === "held" ? [0, 0, 0] : layout.gateOpen;
  if (layout.tokenTray) out.token = joint.token === "tray" ? layout.tokenTray : [0, 0, 0];
  out.turn = [joint.needle || 0];
  return out;
}
