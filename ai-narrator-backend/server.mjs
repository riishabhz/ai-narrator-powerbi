// AI Narrator backend: receives the data from the Power BI visual, asks an AI
// provider for a spoken-style summary, and returns the text. API keys stay here.
//
// Providers are configured in providers.json (re-read on every request, so you
// can edit it without restarting). Three provider types:
//   anthropic  - Claude, via the Anthropic SDK
//   openai     - any OpenAI-compatible Chat Completions API: OpenAI, Azure OpenAI,
//                Google Gemini, Ollama, LM Studio, OpenRouter, Groq, Mistral, ...
//   mock       - no AI; canned summary for testing the visual and the voice
//
//   npm install
//   npm start            (or: npm run mock  -> forces the mock provider)
//
// Env vars: PORT (default 8787), APP_KEY (optional shared key), CONFIG (path to
// providers.json), MOCK=1 (force mock), plus whatever API keys providers.json names.

import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const PORT = Number(process.env.PORT || 8787);
const APP_KEY = process.env.APP_KEY || "";
const FORCE_MOCK = process.env.MOCK === "1";
const CONFIG_PATH = process.env.CONFIG || fileURLToPath(new URL("./providers.json", import.meta.url));
const MAX_BODY = 2 * 1024 * 1024;
const USER_AGENT = "ai-narrator/1.0";
const SESSION_ID = crypto.randomUUID();

// Claude models that accept server-side refusal fallbacks (fallbacks: "default").
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

const DEFAULT_CONFIG = {
  default: "claude",
  providers: {
    claude: { type: "anthropic", model: "claude-opus-5-5", apiKey: "env:ANTHROPIC_API_KEY" },
    mock: { type: "mock" },
  },
};

// ------------------------------------------------------------------ config

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (!cfg.providers || typeof cfg.providers !== "object") throw new Error(`${CONFIG_PATH} has no "providers" object.`);
  return cfg;
}

/** "env:NAME" -> process.env.NAME; anything else is used as-is. */
function resolveSecret(value) {
  if (!value) return "";
  return value.startsWith("env:") ? process.env[value.slice(4)] || "" : value;
}

function isLocal(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url || "");
}

/** Why a provider can't be used yet, or null when it's ready. */
function notReady(p) {
  if (p.type === "mock") return null;
  if (p.type === "anthropic") return resolveSecret(p.apiKey || "env:ANTHROPIC_API_KEY") ? null : `API key missing (${p.apiKey || "env:ANTHROPIC_API_KEY"})`;
  if (p.type === "openai") {
    if (!p.baseUrl) return "baseUrl missing";
    if (!p.model || /CHANGE|YOUR-/i.test(p.model)) return "model not set";
    if (!isLocal(p.baseUrl) && !resolveSecret(p.apiKey)) return `API key missing (${p.apiKey || "no apiKey"})`;
    return null;
  }
  return `unknown type "${p.type}"`;
}

function pickProvider(cfg, requested) {
  if (FORCE_MOCK) return ["mock", { type: "mock" }];
  const name = (requested || "").trim() || cfg.default || Object.keys(cfg.providers)[0];
  const p = cfg.providers[name];
  if (!p) throw new UserError(`Unknown provider "${name}". Available: ${Object.keys(cfg.providers).join(", ")}.`);
  const problem = notReady(p);
  if (problem) throw new UserError(`Provider "${name}" isn't ready: ${problem}. Edit providers.json or set the env var.`);
  return [name, p];
}

class UserError extends Error {}

// ------------------------------------------------------------------ prompt

const LENGTHS = { short: "1 to 2 sentences", medium: "3 to 4 sentences", detailed: "5 to 7 sentences" };

const SYSTEM = `You write short spoken briefings about business data from a Power BI report.
Your text is read aloud by a text-to-speech voice, so:
- Write plain flowing sentences. No markdown, bullet points, headings, tables, emojis or symbols.
- Say numbers the way a presenter would: "about 1.2 million", "up 5 percent", "the 3rd of March". Round sensibly.
- Use each measure's format string to tell currencies and percentages apart (e.g. "£" or "0.0%").
- Lead with the single most important takeaway, then the supporting facts: totals, leaders and laggards, notable changes or outliers.
- Only state what the data shows. Never invent causes, targets or comparisons that aren't in the data.
- Talk about the business, never about the data itself: don't mention rows, columns, fields, measures, breakdowns, truncation, or what is missing from the data.
- Match the length to the data: if there are only one or two numbers, state them in one natural sentence and stop, even if a longer summary was requested.
- If "truncated" is true, you may say once that this covers the top results shown.
- Reply with the briefing text only.`;

function userPrompt({ data, length, instructions, language }) {
  return `Summarise this data in ${LENGTHS[length] || LENGTHS.medium}.\n` +
    `Write in the language for locale "${language || "en-GB"}".\n` +
    (instructions ? `Report author's extra instructions: ${instructions}\n` : "") +
    `\nData (columns, then rows in the same order):\n${JSON.stringify(data)}`;
}

/** Strip markdown leftovers that would be read aloud as symbols. */
function forSpeech(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/[*_#`>]+/g, "").replace(/\n{2,}/g, "\n").trim();
}

// ------------------------------------------------------------------ providers

async function callAnthropic(p, req) {
  const model = p.model || "claude-opus-5-5";
  const client = new Anthropic({ apiKey: resolveSecret(p.apiKey || "env:ANTHROPIC_API_KEY"), ...(p.baseUrl ? { baseURL: p.baseUrl } : {}) });
  const params = {
    model,
    max_tokens: p.maxTokens || 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt(req) }],
  };
  const effort = p.effort === undefined ? "low" : p.effort;   // short narration: favour speed
  if (effort) params.output_config = { effort };
  if (FALLBACK_MODELS.has(model) && p.fallbacks !== false) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";                             // if a request is declined, retry on a fallback model
  }
  const response = await client.beta.messages.create(params);
  if (response.stop_reason === "refusal") throw new UserError("The model declined to summarise this data.");
  return { text: response.content.filter(b => b.type === "text").map(b => b.text).join(""), model: response.model };
}

async function callOpenAICompatible(p, req) {
  const url = p.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const key = resolveSecret(p.apiKey);
  // "{session}" in a header value becomes a per-run ID (OpenCode Go asks for a stable x-opencode-session).
  const extra = Object.fromEntries(Object.entries(p.headers || {}).map(([k, v]) => [k, String(v).replace("{session}", SESSION_ID)]));
  const headers = { "Content-Type": "application/json", "User-Agent": USER_AGENT, ...extra };
  if (key) {
    if ((p.authHeader || "bearer").toLowerCase() === "bearer") headers.Authorization = `Bearer ${key}`;
    else headers[p.authHeader] = key;                         // e.g. Azure: "api-key"
  }
  const body = {
    model: p.model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt(req) },
    ],
    ...(p.extraBody || {}),
  };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(85000) });
  const raw = await res.text();
  if (!res.ok) throw new Error(`${res.status} from ${url}: ${raw.slice(0, 500)}`);
  let json;
  try { json = JSON.parse(raw); } catch { throw new Error(`Non-JSON reply from ${url}: ${raw.slice(0, 200)}`); }
  const content = json.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map(c => c.text || "").join("") : content || "";
  return { text, model: json.model || p.model };
}

function callMock(req) {
  const { data } = req;
  const m = data.columns.findIndex(c => c.role === "measure");
  const c = data.columns.findIndex(c => c.role === "category");
  const total = data.rows.reduce((s, r) => s + (Number(r[m]) || 0), 0);
  let text = `This is a test narration. The visual received ${data.rows.length} rows. ` +
    `Total ${data.columns[m].name} is ${Math.round(total).toLocaleString("en-GB")}.`;
  if (c >= 0 && data.rows.length) {
    const top = [...data.rows].sort((a, b) => (Number(b[m]) || 0) - (Number(a[m]) || 0))[0];
    text += ` The highest ${data.columns[c].name} is ${top[c]}.`;
  }
  return { text, model: "mock" };
}

async function narrate(req) {
  const [name, p] = pickProvider(loadConfig(), req.provider);
  const out = p.type === "anthropic" ? await callAnthropic(p, req)
    : p.type === "openai" ? await callOpenAICompatible(p, req)
    : callMock(req);
  const summary = forSpeech(out.text || "");
  if (!summary) throw new Error(`Provider "${name}" returned an empty summary.`);
  return { summary, provider: name, model: out.model };
}

// ------------------------------------------------------------------ HTTP

function validate(body) {
  const d = body && body.data;
  if (!d || !Array.isArray(d.columns) || !Array.isArray(d.rows)) return "Missing data.columns / data.rows.";
  if (!d.columns.some(c => c.role === "measure")) return "Add at least one measure to the visual.";
  if (d.rows.length > 1000) return "Too many rows (max 1000).";
  return null;
}

function send(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function providerList() {
  const cfg = loadConfig();
  return {
    default: FORCE_MOCK ? "mock" : cfg.default,
    providers: Object.entries(cfg.providers).map(([name, p]) => ({
      name, type: p.type, model: p.type === "mock" ? "mock" : p.model || (p.type === "anthropic" ? "claude-opus-5-5" : ""),
      ready: !notReady(p), problem: notReady(p) || undefined,
    })),
  };
}

const server = http.createServer((req, res) => {
  // Custom visuals run in a sandboxed iframe (origin "null"), so allow any origin.
  // Access-Control-Allow-Private-Network lets app.powerbi.com reach localhost in Chromium.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-key");
  res.setHeader("Access-Control-Allow-Private-Network", "true");

  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  if (req.method === "GET" && (req.url === "/health" || req.url === "/providers")) {
    try { return send(res, 200, { ok: true, ...providerList() }); }
    catch (e) { return send(res, 500, { ok: false, error: e.message }); }
  }
  if (req.method !== "POST" || req.url !== "/narrate") return send(res, 404, { error: "Not found" });
  if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) return send(res, 401, { error: "Wrong or missing app key." });

  let raw = "";
  let tooBig = false;
  req.on("data", chunk => {
    raw += chunk;
    if (raw.length > MAX_BODY) { tooBig = true; req.destroy(); }
  });
  req.on("end", async () => {
    if (tooBig) return;
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "Invalid JSON." }); }
    const problem = validate(body);
    if (problem) return send(res, 400, { error: problem });

    const started = Date.now();
    try {
      const out = await narrate(body);
      console.log(`[narrate] ${out.provider} (${out.model}): ${body.data.rows.length} rows -> ${out.summary.length} chars in ${Date.now() - started} ms`);
      send(res, 200, out);
    } catch (e) {
      console.error("[narrate] failed:", e.message);
      const status = e instanceof UserError ? 400 : 502;
      send(res, status, { error: e.message || "Summary failed." });
    }
  });
});

server.listen(PORT, () => {
  console.log(`AI Narrator backend on http://localhost:${PORT}${APP_KEY ? " (app key required)" : ""}`);
  try {
    const { default: def, providers } = providerList();
    console.log(`Config: ${fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : "built-in defaults (no providers.json)"}`);
    for (const p of providers) {
      console.log(`  ${p.name === def ? "*" : " "} ${p.name.padEnd(14)} ${p.type.padEnd(9)} ${String(p.model).padEnd(28)} ${p.ready ? "ready" : "NOT READY: " + p.problem}`);
    }
    console.log("  (* = default; the visual's Provider box can pick another)");
  } catch (e) {
    console.error("Could not read providers config:", e.message);
  }
});
