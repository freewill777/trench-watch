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

// Figure. An open comparator: two pans, a dial, a magazine of spare blocks.
// The dial always reads. It never asks whether the two stacks were cut to the same drawing.
//
// Parts: 4 pads, 4 stems, plate, groove, 4 screw rings, 4 screw dots, ruler, ticks,
// label, 2 racks, 2 pans, 10 paper blocks, 10 ledger blocks, gantry posts, beam, arm,
// dial, bezel, ticks, needle, knob, rider, rail, notch dots.

const HERE = dirname(fileURLToPath(import.meta.url));
const root = resolve(HERE, "../..");
const theme = process.argv.includes("--light") ? "light" : "dark";
const WIDTH = 780;
const HEIGHT = 470;

const PLATE = { x: -168, y: -96, w: 336, d: 184, r: 8 };
const layout = {
  blocks: BLOCKS,
  pitch: PITCH,
  panZ: PAN_Z,
  rackZ: RACK_Z,
  paper: { x: -46, y: 0 },
  ledger: { x: 30, y: 0 },
  paperRack: { x0: -148, y: -72, step: 13 },
  ledgerRack: { x0: -148, y: -54, step: 13 },
  riderY: 70,
  notches: [-104, -52, 0, 52, 104],
};
const dial = { x: 124, y: -24, z: 56, h: 10, r: 18 };
const knobSpec = { x: -136, y: 58, z: 8, r: 7 };

const snapshot = runCrossref(root);
const structure = snapshot.structures.find((item) => item.id === "v1");
const first = structure.joints[0];
const homes = worldOf(first, layout.notches[0], layout);

const P = k.fitProjection(
  [
    ...k.boxCorners(PLATE, -17, 0),
    [dial.x + dial.r, dial.y, dial.z + dial.h + 4],
    [layout.paper.x, layout.paper.y, 56],
    [layout.ledger.x, layout.ledger.y, 56],
    [-148, -78, 10],
    [layout.notches[0], layout.riderY, 12],
    [layout.notches.at(-1), layout.riderY, 12],
  ],
  WIDTH,
  HEIGHT,
  { pad: 34, azimuth: 42 }
);

const L = (d, style) => k.lineSvg(d, style);
const S = (paths, style) => k.solidSvg(paths, style);

function gantry() {
  const out = [];
  for (const [x, y] of [[-96, -36], [78, -36]]) {
    out.push(S(k.cylinder(x, y, 3.2, 0, 10, P, 20), { tone: "mid" }));
    out.push(S(k.cylinder(x, y, 4.4, 10, 1.8, P, 20), { tone: "mid" }));
    out.push(k.dotsSvg([k.iso([x, y, 11.8], P)], { size: 0.4 }));
  }
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

const [riderX, riderY, riderZ] = homes.rider;
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "An open comparator on a surface plate. Paper blocks stack on the left pan and ledger blocks on the right. Spare blocks wait on two racks. A rider marks which claim is loaded. The dial always turns by the difference, including when a missing ledger rate was entered as zero.",
  body: [
    bench(k, P, PLATE, "V1"),
    rack(k, P, layout.paperRack),
    rack(k, P, layout.ledgerRack),
    gantry(),
    pan(k, P, layout.paper.x, layout.paper.y),
    pan(k, P, layout.ledger.x, layout.ledger.y),
    discs(),
    dialHead(k, P, dial),
    `<g data-part="needle">${L(needleAt(first.needle, dial, P, k), { tone: "lit", free: "start" })}</g>`,
    rail(k, P, -124, 124, layout.riderY),
    notches(k, P, layout.notches, layout.riderY),
    `<g data-part="rider">${rider(k, P, riderX, riderY)}</g>`,
    knob(k, P, knobSpec),
    `<g data-part="knob-mark">${L(knobMark(0, knobSpec, P, k), { tone: "hi" })}</g>`,
  ],
});

const live = clientScript({
  structureId: "v1",
  projection: P,
  layout,
  homes,
  needleSource: needleSource(dial),
  knobSource: knobSource(knobSpec),
  worldSource: worldOf.toString(),
  embed: { id: structure.id, joints: structure.joints },
});

const plate = k.plateHtml({
  fig: "Fig 1",
  title: "Open comparator",
  hint: "Hover to change the claim",
  readout: "loading",
  keys: [
    { mark: "lit", label: "Needle: the difference, read on every stop" },
    { mark: "raised", label: "Paper blocks on the left, ledger blocks on the right" },
  ],
  caption:
    "Five claims sit on this comparator. Each stop stacks the paper's rate on the left pan and the ledger's rate on the right, in tenths, and the needle turns by their difference in percentage points. A rate the ledger never counted is stacked as zero. The machine does not check that the two rates count the same event.",
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Open comparator: arrows move from claim to claim" aria-valuemin="1" aria-valuemax="${structure.joints.length}" aria-valuenow="1">${svg}</div>`,
});

const file = theme === "light" ? "figure-light.html" : "figure.html";
const outDir = join(root, "gallery", "v1");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, file),
  k.pageHtml({
    title: "Open comparator",
    theme,
    width: 860,
    body: wrapFigure({ plate, backHref: "../index.html", styleNote: structure.joints[0].reason }),
    script: kitScript() + live,
  })
);
console.log("wrote", join("gallery", "v1", file));
