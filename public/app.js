"use strict";
const $ = (s) => document.querySelector(s);
const h = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const KINDS = [["e", "Explain", "--e"], ["c", "Connect", "--c"], ["a", "Apply", "--a"]];

// ---- learner model: persisted in localStorage ----
function load() { try { return JSON.parse(localStorage.getItem("tessera")); } catch { return null; } }
function save() { try { localStorage.setItem("tessera", JSON.stringify(S)); } catch {} }
let S = load() || { map: null, m: {}, led: [] };
let sel = null, mode = "e", thread = [], task = null, ei = 0, busy = false;

async function api(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error(j.error || "Request failed (" + r.status + ")");
  return j;
}

const node = (id) => S.map.nodes.find((n) => n.id === id);
const mv = (id) => S.m[id] || (S.m[id] = { e: 0, c: 0, a: 0 });
const avg = (id) => { const m = mv(id); return Math.round((m.e + m.c + m.a) / 3); };
const edgesOf = (id) => S.map.edges.filter((e) => e.a === id || e.b === id);

// ---- setup ----
async function gen() {
  const topic = $("#topic").value.trim();
  if (!topic) return;
  $("#go").disabled = true; $("#go").textContent = "Mapping…"; $("#err").textContent = "";
  try {
    const map = await api("/api/map", { topic, level: $("#lvl").value, notes: $("#notes").value });
    S = { map, m: {}, led: [] }; save(); sel = null; start();
  } catch (e) { $("#err").textContent = e.message; }
  $("#go").disabled = false; $("#go").textContent = "Build my concept map";
}

function start() {
  $("#setup").style.display = S.map ? "none" : "";
  $("#main").style.display = S.map ? "" : "none";
  $("#reset").style.display = S.map ? "" : "none";
  if (S.map) draw();
}

function resetAll() {
  if (!confirm("Start a new topic? Your current progress will be cleared.")) return;
  S = { map: null, m: {}, led: [] }; save(); sel = null; thread = []; task = null; start();
}

// ---- concept map rendering ----
function pos(i, n) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [300 + 190 * Math.cos(a), 262 + 180 * Math.sin(a)]; }

function draw() {
  const N = S.map.nodes, P = {};
  N.forEach((n, i) => (P[n.id] = pos(i, N.length)));
  const next = N.filter((n) => n.id !== sel).sort((a, b) => avg(a.id) - avg(b.id))[0];
  let s = "";
  S.map.edges.forEach((e) => {
    const a = P[e.a], b = P[e.b], hl = sel && (e.a === sel || e.b === sel);
    s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${hl ? "var(--acc)" : "var(--line)"}" stroke-width="${hl ? 2.5 : 1.5}"/>`;
    if (hl) s += `<text class="rel" x="${(a[0] + b[0]) / 2}" y="${(a[1] + b[1]) / 2 - 4}" paint-order="stroke" stroke="var(--card)" stroke-width="4">${h(e.rel)}</text>`;
  });
  N.forEach((n) => {
    const [x, y] = P[n.id], m = mv(n.id), flag = S.led.some((l) => l.id === n.id);
    s += `<g class="node" data-id="${h(n.id)}">`;
    if (next && n.id === next.id && avg(n.id) < 80) s += `<circle cx="${x}" cy="${y}" r="52" fill="none" stroke="var(--acc)" stroke-dasharray="4 5" opacity=".7"/>`;
    s += `<circle class="core" cx="${x}" cy="${y}" r="29" fill="var(--card)" stroke="${sel === n.id ? "var(--acc)" : "var(--line)"}" stroke-width="${sel === n.id ? 4 : 2}"/>`;
    KINDS.forEach(([k, , c], j) => {
      const r = 34 + j * 5, C = 2 * Math.PI * r;
      s += `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="var(--line)" stroke-width="3.5" opacity=".6"/>` +
        `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="var(${c})" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${(C * m[k]) / 100} ${C}" transform="rotate(-90 ${x} ${y})"/>`;
    });
    s += `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="var(--ink)">${avg(n.id)}</text>`;
    if (flag) s += `<text x="${x + 26}" y="${y - 28}" font-size="16">⚠️</text>`;
    s += `<text class="lbl" x="${x}" y="${y + 64}">${h(n.name)}</text></g>`;
  });
  $("#g").innerHTML = s;
  $("#title").textContent = S.map.title || "Concept map";
  const all = N.reduce((t, n) => t + avg(n.id), 0) / N.length;
  $("#score").innerHTML = `Understanding depth: <b>${Math.round(all)}%</b>`;
  $("#led").innerHTML = S.led.length
    ? S.led.map((l) => `<div class="led"><b>${h(node(l.id)?.name)}</b>: ${h(l.t)}</div>`).join("")
    : '<span class="small mut">No misconceptions detected yet. They appear here when your answers reveal a flawed mental model, and clear once you fix them.</span>';
  panel();
}

// ---- challenge panel ----
function pick(id) { sel = id; mode = "e"; thread = []; task = null; ei = 0; draw(); }
function setMode(m) { mode = m; thread = []; task = null; panel(); }

function currentEdge() { const es = edgesOf(sel); return es.length ? es[ei % es.length] : null; }

function question() {
  const n = node(sel);
  if (mode === "e") return `Explain “${n.name}” to Pip, a curious 12-year-old who keeps asking “but why?”. Use your own words and an analogy — no jargon dumps.`;
  if (mode === "c") {
    const e = currentEdge();
    if (!e) return null;
    const o = node(e.a === sel ? e.b : e.a);
    return `How are “${n.name}” and “${o.name}” connected? What would change in one if the other changed or disappeared?`;
  }
  return task ? `${task.scenario}\n\n${task.question}` : null;
}

function panel() {
  const P = $("#panel");
  if (!sel) {
    P.innerHTML = `<h3>Click a concept to begin</h3>
      <p class="mut">Each concept has three rings, and a concept only counts as learned when all three fill up:</p>
      <p><b style="color:var(--e)">Explain</b> — teach it to a confused 12-year-old. Pip asks follow-ups that target exactly what you glossed over.</p>
      <p><b style="color:var(--c)">Connect</b> — explain how two ideas influence each other; the relationships are what make knowledge stick.</p>
      <p><b style="color:var(--a)">Apply</b> — solve a brand-new real-world scenario that isn't in any textbook.</p>
      <p class="small mut">Unlike a chatbot that just answers, Tessera hides the answer, grades your <i>reasoning</i>, names your specific misconception, and keeps a persistent model of what you really understand.</p>`;
    return;
  }
  const n = node(sel), m = mv(sel), q = question();
  let x = `<h3>${h(n.name)}</h3>` + KINDS.map(([k, l, c]) => `<div class="bar"><span style="width:58px">${l}</span><i><b style="width:${m[k]}%;background:var(${c})"></b></i><span>${m[k]}</span></div>`).join("");
  x += `<details><summary>Peek at the key idea (spoils the challenge)</summary>${h(n.core)}</details>`;
  x += `<div class="tabs">${KINDS.map(([k, l]) => `<button data-mode="${k}" class="${mode === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
  if (mode === "c") {
    const es = edgesOf(sel);
    x += `<select id="edgeSel">${es.map((e, i) => { const o = node(e.a === sel ? e.b : e.a); return `<option ${i === ei % es.length ? "selected" : ""}>Link to ${h(o.name)}</option>`; }).join("")}</select>`;
  }
  if (mode === "c" && !q) x += `<p class="small mut">This concept has no recorded links. Try Explain or Apply.</p>`;
  if (mode === "a" && !task) x += `<p class="small mut">You'll get a fresh scenario that needs “${h(n.name)}” to solve.</p><button class="p" id="newTask" ${busy ? "disabled" : ""}>${busy ? "Inventing…" : "Give me a new scenario"}</button>`;
  if (q) x += `<div class="msg ai" style="white-space:pre-wrap"><b>${mode === "e" ? "🧒 Pip" : mode === "c" ? "🔗 Challenge" : "🌍 Scenario"}</b><br>${h(q)}</div>`;
  thread.forEach((t) => {
    x += t.r === "you"
      ? `<div class="msg you">${h(t.t)}</div>`
      : `<div class="msg ai"><span class="pill">${h(t.level)} · ${t.score}</span>
         <p class="small ok" style="margin:6px 0 0">✔ ${h(t.solid)}</p>
         <p class="small" style="margin:4px 0 0">△ ${h(t.gap)}</p>
         ${t.misconception ? `<p class="small warn" style="margin:4px 0 0">⚠ Misconception: ${h(t.misconception)}</p>` : ""}
         <p style="margin:8px 0 0"><b>${mode === "e" ? "🧒 Pip" : "Next"}:</b> ${h(t.followUp)}</p></div>`;
  });
  if (q) x += `<textarea id="ans" placeholder="${thread.length ? "Answer the follow-up…" : "Write your answer…"}" ${busy ? "disabled" : ""}></textarea>
    <div class="row"><button class="p" id="submit" ${busy ? "disabled" : ""}>${busy ? "Assessing your reasoning…" : "Submit"}</button></div><div id="perr" class="warn small"></div>`;
  P.innerHTML = x;
}

async function newTask() {
  busy = true; panel();
  try { task = await api("/api/task", { topic: S.map.title, node: node(sel) }); }
  catch (e) { alert(e.message); }
  busy = false; panel();
}

async function submit() {
  const v = $("#ans").value.trim();
  if (!v || busy) return;
  const id = sel, md = mode, n = node(id), q = question();
  thread.push({ r: "you", t: v });
  busy = true; panel();
  const hist = thread.map((t) => (t.r === "you" ? { learner: t.t } : { assessor_followup: t.followUp }));
  try {
    const r = await api("/api/assess", { topic: S.map.title, node: n, mode: md, question: q, thread: hist, relation: md === "c" ? currentEdge() : undefined });
    thread.push({ r: "ai", score: r.score, level: r.level || "Understood", solid: r.solid, gap: r.gap, misconception: r.misconception, followUp: r.followUp });
    // update the learner model: blend new evidence with prior mastery
    const m = mv(id);
    m[md] = m[md] ? Math.round(m[md] * 0.4 + r.score * 0.6) : r.score;
    if (r.misconception && !S.led.some((l) => l.id === id && l.t === r.misconception)) S.led.push({ id, t: r.misconception });
    else if (!r.misconception && r.score >= 80) S.led = S.led.filter((l) => l.id !== id);
    save(); busy = false; draw();
  } catch (e) {
    thread.pop(); busy = false; panel();
    $("#perr").textContent = e.message; $("#ans").value = v;
  }
}

// ---- events (delegated so re-rendering never breaks handlers) ----
$("#go").addEventListener("click", gen);
$("#topic").addEventListener("keydown", (e) => { if (e.key === "Enter") gen(); });
$("#reset").addEventListener("click", resetAll);
$("#g").addEventListener("click", (e) => { const g = e.target.closest(".node"); if (g) pick(g.dataset.id); });
$("#panel").addEventListener("click", (e) => {
  const t = e.target;
  if (t.dataset.mode) setMode(t.dataset.mode);
  else if (t.id === "newTask") newTask();
  else if (t.id === "submit") submit();
});
$("#panel").addEventListener("change", (e) => { if (e.target.id === "edgeSel") { ei = e.target.selectedIndex; thread = []; panel(); } });

start();