// Shared bench parts for the structure figures. World units are about a pixel of the real instrument.

export const DISC_H = 3.2;
export const PITCH = 3.5;
export const PAN_Z = 4;
export const RACK_Z = 2.2;
export const BLOCKS = 10;

export function byDepth(k, P, points) {
  return [...points].sort((a, b) => k.depthOf([a[0], a[1], a[2] || 0], P) - k.depthOf([b[0], b[1], b[2] || 0], P));
}

export function bench(k, P, plate, mark) {
  const plateH = 12;
  const footH = 5;
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const D = (points, style) => k.dotsSvg(points, style);
  const at = (point) => k.iso(point, P);
  const out = [`<path class="iso-halo" d="${k.haloOf(plate, -plateH - footH, plateH, P)}"/>`];
  for (const [x, y] of byDepth(k, P, k.corners(plate, 24))) {
    out.push(S(k.cylinder(x, y, 7, -plateH - footH, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.2, -plateH - footH + 1.6, footH - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(plate, -plateH, plateH, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(plate, 6), 0, P), { tone: "lo" }));
  const screws = k.corners(plate, 11);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0.05, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0.05])), { size: 0.5 }));
  const strip = { x: plate.x + 18, y: plate.y + plate.d - 16, w: plate.w - 36, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }));
  const label = { x: plate.x + 16, y: plate.y + 14, w: 28, d: 16, r: 1.2 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 3, 0.2), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(label, 0.8, P, 3), { tone: "lo" }));
  for (const inset of [3.2, 5.2, 7.2]) {
    out.push(L(k.lineOnTop([label.x + 2, label.y + inset], [label.x + label.w - 2, label.y + inset], 0.85, P), { tone: "faint", free: true }));
  }
  out.push(k.faceTextSvg(k.topMatrix([label.x + label.w / 2, label.y + 12.2], 0.9, P, "x"), mark, { size: 3.2, tone: "mid", anchor: "middle" }));
  return out.join("");
}

export function pan(k, P, x, y) {
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const D = (points, style) => k.dotsSvg(points, style);
  const at = (point) => k.iso(point, P);
  return [
    S(k.cylinder(x, y, 12, 0.4, 1.2, P, 36), { tone: "mid" }),
    S(k.cylinder(x, y, 10.2, 1.6, 2.4, P, 36, 0.4), { tone: "hi", crease: "lo" }),
    L(k.ring(x, y, 6.4, PAN_Z, P, 28), { tone: "lo" }),
    D([at([x, y, PAN_Z])], { size: 0.45, tone: "mid" }),
  ].join("");
}

export function disc(k, P, x, y, z, tone) {
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  return [
    S(k.cylinder(x, y, 6.4, z, DISC_H, P, 32, 0.35), { tone, crease: "lo" }),
    L(k.ring(x, y, 4.2, z + DISC_H, P, 24), { tone: "faint" }),
  ].join("");
}

export function rack(k, P, spec) {
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const D = (points, style) => k.dotsSvg(points, style);
  const at = (point) => k.iso(point, P);
  const plan = { x: spec.x0 - 8, y: spec.y - 8, w: (BLOCKS - 1) * spec.step + 16, d: 16, r: 2 };
  const seats = [];
  for (let i = 0; i < BLOCKS; i++) seats.push(at([spec.x0 + i * spec.step, spec.y, RACK_Z]));
  return [
    S(k.slabOf(plan, 0, RACK_Z, P, 4, 0.4), { tone: "lo" }),
    L(k.planOutline(k.insetPlan(plan, 1.4), RACK_Z, P, 3), { tone: "faint" }),
    D(seats, { size: 0.35, tone: "lo" }),
  ].join("");
}

export function dialHead(k, P, dial) {
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const { x, y, z, r } = dial;
  const top = z + dial.h;
  const out = [];
  out.push(S(k.cylinder(x, y, 3.1, 0, z - 6, P, 24), { tone: "mid" }));
  out.push(L(k.sideArc(x, y, 3.1, 18, P, 14), { tone: "lo" }));
  out.push(L(k.sideArc(x, y, 3.1, z - 14, P, 14), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, 5.2, z - 6, 6, P, 28), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, r, z, dial.h, P, 64, 0.8), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(x, y, r, top - 3.2, top, 84, P, 0.3), { tone: "lo" }));
  out.push(L(k.sideArc(x, y, r, top - 3.2, P, 40), { tone: "faint" }));
  out.push(L(k.ring(x, y, r - 2.2, top, P, 64), { tone: "lo" }));
  const ticks = k.radialTicks(x, y, r - 3, 40, 5, top, [1.3, 2.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(L(k.ring(x, y, 1.6, top, P, 16), { tone: "mid" }));
  out.push(k.dotsSvg([k.iso([x, y, top], P)], { size: 0.45, tone: "hi" }));
  return out.join("");
}

export function needleAt(turn, dial, P, k) {
  const angle = turn * Math.PI * 2;
  const top = dial.z + dial.h;
  return k.lineOnTop(
    [dial.x - Math.sin(angle) * 3.4, dial.y + Math.cos(angle) * 3.4],
    [dial.x + Math.sin(angle) * (dial.r - 2.2), dial.y - Math.cos(angle) * (dial.r - 2.2)],
    top + 0.2,
    P
  );
}

export function needleSource(dial) {
  const top = dial.z + dial.h;
  return `function needleAt(turn) {
    const angle = turn * Math.PI * 2;
    const x = ${dial.x}, y = ${dial.y}, r = ${dial.r}, top = ${top};
    return lineOnTop([x - Math.sin(angle) * 3.4, y + Math.cos(angle) * 3.4], [x + Math.sin(angle) * (r - 2.2), y - Math.cos(angle) * (r - 2.2)], top + 0.2, P);
  }`;
}

export function knob(k, P, spec) {
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const { x, y, z, r } = spec;
  return [
    S(k.cylinder(x, y, r + 1.4, 0, 2, P, 28), { tone: "lo" }),
    S(k.cylinder(x, y, r, 2, z - 2, P, 32), { tone: "mid" }),
    L(k.knurl(x, y, r, 2, z, 28, P, 0), { tone: "lo" }),
    L(k.ring(x, y, r - 1.2, z, P, 24), { tone: "lo" }),
    k.dotsSvg([k.iso([x, y, z], P)], { size: 0.5, tone: "hi" }),
  ].join("");
}

export function knobMark(turn, spec, P, k) {
  const angle = turn * Math.PI * 2;
  return k.lineOnTop(
    [spec.x, spec.y],
    [spec.x + Math.cos(angle) * (spec.r - 1.2), spec.y + Math.sin(angle) * (spec.r - 1.2)],
    spec.z,
    P
  );
}

export function knobSource(spec) {
  return `function knobMark(turn) {
    const angle = turn * Math.PI * 2;
    const x = ${spec.x}, y = ${spec.y}, r = ${spec.r - 1.2}, z = ${spec.z};
    return lineOnTop([x, y], [x + Math.cos(angle) * r, y + Math.sin(angle) * r], z, P);
  }`;
}

export function rider(k, P, x, y) {
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  return [
    S(k.slabOf({ x: x - 6, y: y - 5, w: 12, d: 10, r: 2 }, 3.2, 4, P, 3, 0.4), { tone: "hi", crease: "lo" }),
    L(k.lineOnTop([x, y - 4], [x, y + 4], 7.25, P), { tone: "mid", free: true }),
  ].join("");
}

export function rail(k, P, fromX, toX, y) {
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const D = (points, style) => k.dotsSvg(points, style);
  const at = (point) => k.iso(point, P);
  const x0 = fromX + 3;
  const x1 = toX - 3;
  return [
    S(k.slabOf({ x: fromX, y: y - 3, w: toX - fromX, d: 6, r: 1.2 }, 0, 3.2, P, 3, 0.4), { tone: "mid" }),
    L(k.lineOnTop([x0, y], [x1, y], 3.25, P), { tone: "faint" }),
    D([at([x0, y, 3.25]), at([x1, y, 3.25])], { size: 0.55 }),
  ].join("");
}

export function notches(k, P, xs, y) {
  return k.dotsSvg(xs.map((x) => k.iso([x, y + 6, 0.2], P)), { size: 0.55, tone: "mid" });
}
