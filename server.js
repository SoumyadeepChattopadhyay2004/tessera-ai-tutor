"use strict";
const http = require("http");
const https = require("https");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const { SYSTEM, mapPrompt, taskPrompt, assessPrompt } = require("./prompts");

// ---- tiny .env loader (no dependencies) ----
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (_) {}

const PORT = +process.env.PORT || 3000;
const PROVIDER = (process.env.PROVIDER || "gemini").toLowerCase(); // "gemini" (free tier) or "anthropic"
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const GEMINI_BASE = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const WORKSPACE_ID = process.env.ANTHROPIC_WORKSPACE_ID; // only needed if the Anthropic key is not scoped to a workspace
const MODEL = process.env.MODEL || "claude-sonnet-5-5";
const BASE = new URL(process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com");
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || "";
const FORCE_IPV4 = /^(1|true)$/i.test(process.env.FORCE_IPV4 || "");
const PUBLIC = path.join(__dirname, "public");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const TIMEOUT_MS = 90000;

// ---- helpers ----
const hits = new Map(); // naive per-IP rate limit: 40 requests / minute
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 1000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k);
  return arr.length > 40;
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req, max = 100000) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > max) { reject(Object.assign(new Error("Request too large"), { status: 413 })); req.destroy(); }
    });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); } });
    req.on("error", reject);
  });
}

function parseJSON(text) {
  const s = text.replace(/```json|```/g, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error("The AI returned an unexpected reply. Please try again.");
  try { return JSON.parse(s.slice(a, b + 1)); }
  catch { throw new Error("The AI returned malformed data. Please try again."); }
}

// ---- HTTP helper (supports HTTP(S)_PROXY and FORCE_IPV4) ----
function postJSON(target, extraHeaders, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const secure = target.protocol === "https:";
    const lib = secure ? https : http;
    const opts = {
      hostname: target.hostname,
      port: target.port || (secure ? 443 : 80),
      path: target.pathname + target.search,
      method: "POST",
      headers: { "content-type": "application/json", "content-length": data.length, ...extraHeaders },
      ...(FORCE_IPV4 ? { family: 4 } : {}),
    };
    let done = false;
    const fail = (e) => { if (!done) { done = true; reject(e); } };
    const go = (extra) => {
      const req = lib.request({ ...opts, ...extra }, (res) => {
        let b = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          if (done) return; done = true;
          let json;
          try { json = JSON.parse(b); } catch { json = { error: { message: b.slice(0, 200) || "Empty response" } }; }
          resolve({ status: res.statusCode, json });
        });
      });
      req.setTimeout(TIMEOUT_MS, () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT", timedOut: true })));
      req.on("error", fail);
      req.end(data);
    };
    if (PROXY && secure) {
      // tunnel through an HTTP proxy with CONNECT
      let p;
      try { p = new URL(/^\w+:\/\//.test(PROXY) ? PROXY : "http://" + PROXY); } catch { return fail(Object.assign(new Error("bad proxy"), { code: "EBADPROXY" })); }
      const ph = { Host: `${opts.hostname}:${opts.port}` };
      if (p.username) ph["Proxy-Authorization"] = "Basic " + Buffer.from(`${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`).toString("base64");
      const c = http.request({ hostname: p.hostname, port: p.port || 80, method: "CONNECT", path: `${opts.hostname}:${opts.port}`, headers: ph });
      c.setTimeout(20000, () => c.destroy(Object.assign(new Error("proxy timeout"), { code: "ETIMEDOUT" })));
      c.on("connect", (r, socket) => {
        if (r.statusCode !== 200) { socket.destroy(); return fail(Object.assign(new Error("proxy refused: " + r.statusCode), { code: "EPROXY" + r.statusCode })); }
        go({ createConnection: () => tls.connect({ socket, servername: opts.hostname }) });
      });
      c.on("error", fail);
      c.end();
    } else go({});
  });
}

// ---- providers: each returns the model's raw text ----
async function callAnthropic(user, maxTokens) {
  if (!API_KEY) throw Object.assign(new Error("ANTHROPIC_API_KEY is not set. Add it to .env (or use PROVIDER=gemini)."), { status: 500 });
  const url = new URL(BASE.pathname.replace(/\/$/, "") + "/v1/messages", BASE);
  const headers = { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", ...(WORKSPACE_ID ? { "anthropic-workspace-id": WORKSPACE_ID } : {}) };
  const { status, json } = await withNet(BASE.host, () => postJSON(url, headers, { model: MODEL, max_tokens: maxTokens, system: SYSTEM, messages: [{ role: "user", content: user }] }));
  if (status < 200 || status >= 300) throw apiError("Anthropic", status, json?.error?.message);
  if (json.stop_reason === "max_tokens") throw new Error("The AI reply was cut off. Please try again.");
  return (json.content || []).map((c) => c.text || "").join("");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Models tried in order when the preferred one is overloaded (503) or out of quota (429). Override with GEMINI_FALLBACK_MODELS=a,b
const GEMINI_MODELS = [GEMINI_MODEL, ...(process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.7-flash,gemini-3.5-flash").split(",").map((m) => m.trim()).filter(Boolean)].filter((m, i, a) => a.indexOf(m) === i);

async function callGemini(user, maxTokens) {
  if (!GEMINI_KEY) throw Object.assign(new Error("GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey and add it to .env."), { status: 500 });
  let last;
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const url = new URL(`/v1beta/models/${encodeURIComponent(model)}:generateContent`, GEMINI_BASE);
      const generationConfig = { maxOutputTokens: Math.max(maxTokens, 8192), temperature: 0.7, responseMimeType: "application/json" };
      // Gemini 2.5 Flash "thinks" by default and thinking tokens eat the output budget; switch it off (newer models get a larger budget instead).
      if (/^gemini-2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      const body = { systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig };
      const { status, json } = await withNet(url.host, () => postJSON(url, { "x-goog-api-key": GEMINI_KEY }, body));
      if (status >= 200 && status < 300) {
        const cand = json.candidates && json.candidates[0];
        if (!cand) throw new Error("Gemini returned no answer" + (json.promptFeedback?.blockReason ? ` (blocked: ${json.promptFeedback.blockReason})` : "") + ". Try rephrasing.");
        if (cand.finishReason === "MAX_TOKENS") throw new Error("The AI reply was cut off. Please try again.");
        if (model !== GEMINI_MODELS[0]) console.log(`(answered by fallback model ${model})`);
        return (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
      }
      last = { status, msg: json?.error?.message };
      console.log(`Gemini ${model} -> ${status}${attempt === 0 && (status === 503 || status === 500 || status === 504) ? ", retrying" : ""}`);
      if (status === 503 || status === 500 || status === 504) { if (attempt === 0) await sleep(1500); continue; } // transient: retry once, then next model
      if (status === 429 || status === 404) break; // quota or unknown model: go straight to the next model
      throw apiError("Gemini", status, json?.error?.message); // 400/401/403: our problem, not transient
    }
  }
  if (last && (last.status === 503 || last.status === 500 || last.status === 504))
    throw Object.assign(new Error("Google's Gemini servers are overloaded right now. Wait a minute and try again."), { status: 503 });
  throw apiError("Gemini", last?.status || 502, last?.msg);
}

async function withNet(host, fn) {
  try { return await fn(); }
  catch (e) {
    if (e.timedOut) throw Object.assign(new Error("The AI took too long. Please try again."), { status: 504 });
    const hint = PROXY ? " (using proxy " + PROXY.replace(/\/\/[^@]*@/, "//") + ")" : "";
    throw Object.assign(new Error(`Cannot reach ${host}${hint}: ${e.code || e.message}. Check internet, VPN, proxy or firewall; try FORCE_IPV4=1.`), { status: 502 });
  }
}

function apiError(who, status, msg) {
  if (status === 429) return Object.assign(new Error(`${who} rate limit reached (free tiers allow only a few requests per minute). Wait a minute and try again.`), { status: 429 });
  return Object.assign(new Error(`${who} API ${status}: ${msg || "request failed"}`), { status: 502 });
}

async function askModel(user, maxTokens = 1500) {
  const text = PROVIDER === "anthropic" ? await callAnthropic(user, maxTokens) : await callGemini(user, maxTokens);
  return parseJSON(text);
}

const str = (v, n) => String(v ?? "").slice(0, n);
const cleanNode = (n = {}) => ({ name: str(n.name, 80), core: str(n.core, 400), misconception: str(n.misconception, 400) });
const none = (v) => (!v || /^(null|none|n\/a|no misconception)\.?$/i.test(String(v).trim()) ? null : String(v));

// ---- API handlers ----
const routes = {
  "/api/map": async (b) => {
    const topic = str(b.topic, 200).trim();
    if (!topic) throw Object.assign(new Error("Topic is required"), { status: 400 });
    const r = await askModel(mapPrompt({ topic, level: str(b.level, 60) || "college intermediate", notes: str(b.notes, 6000).trim() }), 3500);
    const seen = new Set();
    r.nodes = (Array.isArray(r.nodes) ? r.nodes : []).filter((n) => n && n.id && n.name && !seen.has(n.id) && seen.add(n.id)).slice(0, 10);
    if (r.nodes.length < 3) throw new Error("Could not build a valid map. Try rephrasing the topic.");
    r.edges = (Array.isArray(r.edges) ? r.edges : []).filter((e) => e && seen.has(e.a) && seen.has(e.b) && e.a !== e.b);
    return r;
  },
  "/api/task": async (b) => {
    const r = await askModel(taskPrompt({ topic: str(b.topic, 200), node: cleanNode(b.node) }), 800);
    if (!r.scenario || !r.question) throw new Error("Could not create a scenario. Try again.");
    return r;
  },
  "/api/assess": async (b) => {
    const thread = (Array.isArray(b.thread) ? b.thread : []).slice(-12).map((t) => ({ learner: t.learner ? str(t.learner, 3000) : undefined, assessor_followup: t.assessor_followup ? str(t.assessor_followup, 500) : undefined }));
    if (!thread.length) throw Object.assign(new Error("Answer is required"), { status: 400 });
    const r = await askModel(assessPrompt({ topic: str(b.topic, 200), node: cleanNode(b.node), mode: ["e", "c", "a"].includes(b.mode) ? b.mode : "e", question: str(b.question, 2000), thread, relation: b.relation }), 1000);
    r.score = Math.max(0, Math.min(100, Math.round(+r.score || 0)));
    r.level = ["Recalled", "Understood", "Transferred"].includes(r.level) ? r.level : r.score >= 85 ? "Transferred" : r.score >= 50 ? "Understood" : "Recalled";
    r.misconception = none(r.misconception);
    return r;
  },
};

// ---- server ----
http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress;
  try {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (req.method === "POST" && routes[url]) {
      if (limited(ip)) return send(res, 429, { error: "Too many requests. Please wait a minute." });
      return send(res, 200, await routes[url](await readBody(req)));
    }
    if (req.method === "GET") {
      const file = path.normalize(path.join(PUBLIC, url === "/" ? "index.html" : url));
      if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(405); res.end();
  } catch (e) {
    console.error(e.message);
    send(res, e.status || 500, { error: e.message });
  }
}).listen(PORT, () => {
  const ok = PROVIDER === "anthropic" ? API_KEY : GEMINI_KEY;
  console.log(`Tessera running at http://localhost:${PORT} (provider: ${PROVIDER}, model: ${PROVIDER === "anthropic" ? MODEL : GEMINI_MODEL}${ok ? "" : ", NO API KEY SET"}${PROXY ? ", proxy on" : ""})`);
});