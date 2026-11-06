// Live page script shared by the structure figures. The kit is inlined ahead of this string,
// so translateAlong and the needle helpers are globals inside the page.

export function clientScript({ structureId, projection, layout, homes, needleSource, knobSource, worldSource, embed }) {
  return `
const P = ${JSON.stringify(projection)};
const LAYOUT = ${JSON.stringify(layout)};
const HOMES = ${JSON.stringify(homes)};
const STRUCTURE = ${JSON.stringify(structureId)};
let pack = ${JSON.stringify(embed)};
const needleAt = ${needleSource};
const knobMark = ${knobSource};
const worldOf = ${worldSource};
const sim = new URLSearchParams(location.search).has("sim");
if (sim) document.documentElement.classList.add("sim");
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const reason = document.querySelector("[data-reason]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const joints = () => pack.joints || [];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
let index = 0;
let touring = !still.matches;
let idleTimer = 0;
let frame = 0;
let last = 0;
let clock = 0;
let visible = true;
let turn = 0;
const smooth = {};
function approach(key, to, dt, calm) {
  const from = smooth[key] || to.slice();
  const next = calm ? to.slice() : from.map((value, i) => value + (to[i] - value) * (1 - Math.exp(-dt / 0.28)));
  if (next.every((value, i) => Math.abs(value - to[i]) < 0.02)) {
    smooth[key] = to.slice();
    return to;
  }
  smooth[key] = next;
  return next;
}
function move(name, world) {
  const el = svg.querySelector('[data-part="' + name + '"]');
  const home = HOMES[name];
  if (!el || !home) return;
  el.setAttribute("transform", translateAlong(P, [world[0] - home[0], world[1] - home[1], world[2] - home[2]]));
}
function pct(value, missing) {
  if (missing || value == null || Number.isNaN(Number(value))) return "absent";
  return (Number(value) * 100).toFixed(1) + "%";
}
function applyJoint(joint, riderX, dt, calm) {
  const desired = worldOf(joint, riderX, LAYOUT);
  for (const name of Object.keys(desired)) {
    if (name === "turn") continue;
    const to = desired[name];
    if (name.startsWith("blade-") || name === "gate" || name === "token") {
      const el = name.startsWith("blade-")
        ? svg.querySelector('[data-blade="' + name.slice(6) + '"]')
        : svg.querySelector('[data-part="' + name + '"]');
      if (!el) continue;
      const world = approach(name, to, dt, calm);
      el.setAttribute("transform", translateAlong(P, world));
      continue;
    }
    move(name, approach(name, to, dt, calm));
  }
  turn = approach("turn", desired.turn, dt, calm)[0];
  const needle = svg.querySelector('[data-part="needle"] path');
  if (needle) needle.setAttribute("d", needleAt(turn));
  const mark = svg.querySelector('[data-part="knob-mark"] path');
  if (mark) mark.setAttribute("d", knobMark(index / Math.max(joints().length, 1)));
  const ledger = joint.localMissing && joint.mode === "raw-percent" ? "0% entered" : pct(joint.local, joint.localMissing);
  const paper = pct(joint.claim, false);
  const short = joint.verdict + " · " + ledger + " / " + paper;
  if (readout.textContent !== short) readout.textContent = short;
  const sentence = joint.title + ". " + joint.reason;
  if (reason && reason.textContent !== sentence) reason.textContent = sentence;
  stage.setAttribute("aria-valuenow", String(index + 1));
  stage.setAttribute("aria-valuetext", joint.title + ", " + short);
  publish(short);
}
let posted = "";
function publish(short) {
  const joint = joints()[index];
  if (!joint || window.parent === window) return;
  const payload = {
    source: "trench-figure",
    structure: STRUCTURE,
    index,
    count: joints().length,
    title: joint.title,
    verdict: joint.verdict,
    reason: joint.reason,
    short,
    touring
  };
  const key = JSON.stringify(payload);
  if (key === posted) return;
  posted = key;
  window.parent.postMessage(payload, "*");
}
function tick(now) {
  const list = joints();
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (touring && list.length) {
    clock += dt;
    index = Math.floor(clock / 3.4) % list.length;
  }
  const joint = list[index] || list[0];
  let settled = !touring;
  if (joint) {
    const riderX = LAYOUT.notches[index] ?? LAYOUT.notches[0];
    applyJoint(joint, riderX, dt, calm);
    const posed = worldOf(joint, riderX, LAYOUT);
    settled = !touring && Object.keys(posed).every((name) => {
      const to = posed[name];
      const at = smooth[name] || to;
      return at.every((value, i) => Math.abs(value - to[i]) < 0.02);
    });
  }
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
function run() {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
}
function steer(next, hold) {
  const list = joints();
  if (!list.length) return;
  touring = false;
  index = clamp(next, 0, list.length - 1);
  clock = index * 3.4;
  const joint = list[index];
  if (joint) applyJoint(joint, LAYOUT.notches[index] ?? LAYOUT.notches[0], 1, true);
  clearTimeout(idleTimer);
  if (!hold) idleTimer = setTimeout(() => { touring = !still.matches; run(); }, 4200);
  run();
}
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.source !== "trench-deck") return;
  if (data.cmd === "hello") {
    const joint = joints()[index];
    if (joint) applyJoint(joint, LAYOUT.notches[index] ?? LAYOUT.notches[0], 1, true);
    return;
  }
  if (data.cmd === "stop") steer(data.index, true);
  if (data.cmd === "next") steer(index + 1, true);
  if (data.cmd === "prev") steer(index - 1, true);
  if (data.cmd === "play") { touring = !still.matches; clearTimeout(idleTimer); run(); publish(""); posted = ""; const joint = joints()[index]; if (joint) applyJoint(joint, LAYOUT.notches[index] ?? LAYOUT.notches[0], 1, still.matches); }
  if (data.cmd === "pause") { touring = false; clearTimeout(idleTimer); publish(""); posted = ""; const joint = joints()[index]; if (joint) applyJoint(joint, LAYOUT.notches[index] ?? LAYOUT.notches[0], 1, true); }
});
new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) run();
}, { rootMargin: "120px 0px" }).observe(stage);
if (!sim) stage.addEventListener("pointermove", (event) => {
  const box = svg.getBoundingClientRect();
  const share = clamp((event.clientX - box.left) / box.width, 0, 1);
  steer(Math.round(share * (joints().length - 1)));
});
stage.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); steer(index + 1); }
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); steer(index - 1); }
  if (event.key === "Home") { event.preventDefault(); steer(0); }
  if (event.key === "End") { event.preventDefault(); steer(joints().length - 1); }
});
async function refresh() {
  try {
    const res = await fetch("/api/crossref");
    if (!res.ok) return;
    const body = await res.json();
    const found = (body.structures || []).find((item) => item.id === STRUCTURE);
    if (found && found.joints && found.joints.length) pack = found;
  } catch {}
}
refresh();
setInterval(refresh, 30000);
if (joints()[0]) applyJoint(joints()[0], LAYOUT.notches[0], 1, true);
run();
`;
}
