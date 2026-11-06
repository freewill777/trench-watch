import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../vendor/anatomy/kit/iso-kit.mjs";
import { kitScript } from "../../vendor/anatomy/scripts/inline-kit.mjs";
import { runCrossref } from "../../src/crossref.js";
import { clientScript } from "../lib/client.mjs";
import { worldOf } from "../lib/poses.mjs";
import { wrapFigure } from "../lib/page.mjs";
import {
  BLOCKS,
  PAN_Z,
  PITCH,
  RACK_Z,
  bench,
  dialHead,
  disc,
  knob,
  knobMark,
  knobSource,
  needleAt,
  needleSource,
  notches,
  pan,
  rack,
  rail,
  rider,
} from "../lib/shop.mjs";

// Figure. A receiving gauge. Four blades (quantity, population, definition, sample)
// drop onto a mismatch. The gate stays shut, the ledger blocks stay in the magazine,
// and the specimen sits in the hold tray. The dial moves only when every blade is up.
//
// Parts: bench set, 2 racks, 2 pans, 20 blocks, 4 blade posts, 4 blades, bridge,
// gate, tray, token, gantry, dial, knob, rider, rail.

const HERE = dirname(fileURLToPath(import.meta.url));
const root = resolve(HERE, "../..");
const theme = process.argv.includes("--light") ? "light" : "dark";
const WIDTH = 820;
const HEIGHT = 500;

const PLATE = { x: -188, y: -102, w: 376, d: 204, r: 8 };
const BLADES = ["quantity", "population", "definition", "sample"];
const bladeX = [-156, -120, -84, -48];
const bladeY = 50;
const layout = {
  blocks: BLOCKS,
  pitch: PITCH,
  panZ: PAN_Z,
  rackZ: RACK_Z,
  paper: { x: -78, y: -6 },
  ledger: { x: -16, y: -6 },
  paperRack: { x0: -164, y: -82, step: 12.2 },
  ledgerRack: { x0: -164, y: -64, step: 12.2 },
  riderY: 82,
  notches: [-130, -78, -26, 26, 78, 130],
  blades: BLADES,
  bladeDrop: -7,
  gateOpen: [0, 24, 0],
  tokenTray: [112, 10, 0],
};
const dial = { x: 148, y: -46, z: 52, h: 10, r: 17 };
const knobSpec = { x: -158, y: 68, z: 8, r: 7 };
const tokenAt = { x: 28, y: 18 };

const snapshot = runCrossref(root);
const structure = snapshot.structures.find((item) => item.id === "v2");
const first = structure.joints[0];
const homes = worldOf(first, layout.notches[0], layout);

const P = k.fitProjection(
  [
    ...k.boxCorners(PLATE, -17, 0),
    [dial.x + dial.r, dial.y, dial.z + dial.h + 6],
    [layout.paper.x, layout.paper.y, 58],
    [tokenAt.x + layout.tokenTray[0], tokenAt.y, 16],
    [-164, -84, 12],
    [layout.notches[0], layout.riderY, 14],
    [layout.notches.at(-1), layout.riderY, 14],
  ],
  WIDTH,
  HEIGHT,
  { pad: 32, azimuth: 40, elevation: 32 }
);

const L = (d, style) => k.lineSvg(d, style);
const S = (paths, style) => k.solidSvg(paths, style);

function gantry() {
  const out = [];
  for (const [x, y] of [[-112, -40], [56, -40]]) {
    out.push(S(k.cylinder(x, y, 3, 0, 9, P, 18), { tone: "mid" }));
    out.push(S(k.cylinder(x, y, 4.1, 9, 1.6, P, 18), { tone: "mid" }));
    out.push(k.dotsSvg([k.iso([x, y, 10.6], P)], { size: 0.4 }));
  }
  return out.join("");
}

function blades() {
  const out = [];
  bladeX.forEach((x, index) => {
    const name = BLADES[index];
    out.push(S(k.cylinder(x, bladeY, 2.2, 0, 12, P, 16), { tone: "mid" }));
    out.push(S(k.cylinder(x, bladeY, 3.1, 12, 1.5, P, 16), { tone: "mid" }));
    const blade = S(k.slabOf({ x: x - 1.15, y: bladeY - 18, w: 2.3, d: 14, r: 0.4 }, 11.2, 1.5, P, 2), { tone: "hi", crease: "lo" });
    out.push(`<g data-blade="${name}">${blade}</g>`);
  });
  out.push(S(k.slabOf({ x: bladeX[0] - 6, y: bladeY - 2.4, w: bladeX.at(-1) - bladeX[0] + 12, d: 4.8, r: 1 }, 15.4, 2, P, 3, 0.3), { tone: "mid" }));
  return out.join("");
}

function gateAndTray() {
  const tray = { x: 118, y: 16, w: 48, d: 32, r: 3 };
  const out = [];
  out.push(S(k.slabOf({ x: tokenAt.x - 10, y: tokenAt.y - 8, w: 20, d: 16, r: 2 }, 0, 1.6, P, 3, 0.3), { tone: "lo" }));
  out.push(L(k.planOutline({ x: tokenAt.x - 7, y: tokenAt.y - 5, w: 14, d: 10, r: 1 }, 1.6, P, 3), { tone: "faint" }));
  out.push(S(k.slabOf(tray, 0, 2.4, P, 4, 0.4), { tone: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(tray, 2), 2.4, P, 4), { tone: "faint" }));
  out.push(S(k.slabOf({ x: tray.x, y: tray.y, w: tray.w, d: 2.2, r: 0.6 }, 2.4, 5, P, 2), { tone: "mid" }));
  out.push(S(k.slabOf({ x: tray.x, y: tray.y + tray.d - 2.2, w: tray.w, d: 2.2, r: 0.6 }, 2.4, 5, P, 2), { tone: "mid" }));
  out.push(S(k.slabOf({ x: tray.x + tray.w - 2.2, y: tray.y, w: 2.2, d: tray.d, r: 0.6 }, 2.4, 5, P, 2), { tone: "mid" }));
  const gate = S(k.slabOf({ x: 62, y: 12, w: 22, d: 7, r: 1.2 }, 0, 8, P, 3, 0.4), { tone: "mid" });
  out.push(`<g data-part="gate">${gate}</g>`);
  const token = [
    S(k.cylinder(tokenAt.x, tokenAt.y, 4.2, 2.2, 3.2, P, 24, 0.4), { tone: "hi", lit: true }),
    L(k.ring(tokenAt.x, tokenAt.y, 2.4, 5.45, P, 16), { tone: "lo" }),
  ].join("");
  out.push(`<g data-part="token">${token}</g>`);
  return out.join("");
}

function discs() {
  const out = [];
  for (const kind of ["paper", "ledger"]) {
    for (let i = 0; i < BLOCKS; i++) {
      const [x, y, z] = homes[`${kind}-${i}`];
      const tone = kind === "paper" ? "hi" : "mid";
      out.push(`<g data-part="${kind}-${i}">${disc(k, P, x, y, z, tone)}</g>`);
    }
  }
  return out.join("");
}

const [riderX, riderY] = homes.rider;
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "A receiving gauge. Four blades check quantity, population, definition, and sample size. The lit specimen stays in the hold tray unless every blade is up. Only then do the ledger blocks leave the magazine and the dial leave its pin.",
  body: [
    bench(k, P, PLATE, "V2"),
    rack(k, P, layout.paperRack),
    rack(k, P, layout.ledgerRack),
    gantry(),
    pan(k, P, layout.paper.x, layout.paper.y),
    pan(k, P, layout.ledger.x, layout.ledger.y),
    discs(),
    blades(),
    gateAndTray(),
    dialHead(k, P, dial),
    `<g data-part="needle">${L(needleAt(first.needle, dial, P, k), { tone: "hi", free: "start" })}</g>`,
    rail(k, P, -148, 148, layout.riderY),
    notches(k, P, layout.notches, layout.riderY),
    `<g data-part="rider">${rider(k, P, riderX, riderY)}</g>`,
    knob(k, P, knobSpec),
    `<g data-part="knob-mark">${L(knobMark(0, knobSpec, P, k), { tone: "hi" })}</g>`,
  ],
});

const live = clientScript({
  structureId: "v2",
  projection: P,
  layout,
  homes,
  needleSource: needleSource(dial),
  knobSource: knobSource(knobSpec),
  worldSource: worldOf.toString(),
  embed: { id: structure.id, joints: structure.joints },
});

const plate = k.plateHtml({
  fig: "Fig 2",
  title: "Receiving gauge",
  hint: "Hover to change the claim",
  readout: "loading",
  keys: [
    { mark: "lit", label: "Specimen: on the anvil only when the gates pass" },
    { mark: "raised", label: "Paper blocks stay. Ledger blocks wait until the dial opens" },
  ],
  caption:
    "The paper claim is the left stack. The ledger stack leaves the magazine only when quantity, population, definition, and sample size all match. Otherwise the gate stays shut, the needle stays on its pin, and the specimen sits in the hold tray. One stop asks a coarser question: whether a developer buy is usual, meaning at least 90 percent of creates. That stop does not match the two rates to each other.",
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Receiving gauge: arrows move from claim to claim" aria-valuemin="1" aria-valuemax="${structure.joints.length}" aria-valuenow="1">${svg}</div>`,
});

const file = theme === "light" ? "figure-light.html" : "figure.html";
const outDir = join(root, "gallery", "v2");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, file),
  k.pageHtml({
    title: "Receiving gauge",
    theme,
    width: 900,
    body: wrapFigure({ plate, backHref: "../index.html", styleNote: structure.joints[0].reason }),
    script: kitScript() + live,
  })
);
console.log("wrote", join("gallery", "v2", file));
