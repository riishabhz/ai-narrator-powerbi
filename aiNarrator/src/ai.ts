"use strict";

// Calls the AI provider straight from the visual (no backend needed).
// Every host used here must also be listed under privileges → WebAccess in capabilities.json.

import Anthropic from "@anthropic-ai/sdk";

export type ProviderId = "openrouter" | "anthropic" | "openai" | "gemini" | "azure" | "server";

export interface NarrationPayload {
    columns: { name: string; role: "category" | "measure"; format?: string }[];
    rows: (string | number | boolean | null)[][];
    truncated: boolean;
}

export interface NarrationRequest {
    provider: ProviderId;
    apiKey: string;
    model: string;
    baseUrl: string;
    data: NarrationPayload;
    length: string;
    instructions: string;
    language: string;
}

export interface NarrationResult {
    summary: string;
    via: string;
}

interface ProviderInfo {
    label: string;
    defaultModel: string;       // "" = the user must enter one
    needsBaseUrl: boolean;
    keyHelp: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
    openrouter: { label: "OpenRouter", defaultModel: "anthropic/claude-opus-5.5", needsBaseUrl: false, keyHelp: "openrouter.ai → Keys" },
    anthropic: { label: "Anthropic (Claude)", defaultModel: "claude-opus-5-5", needsBaseUrl: false, keyHelp: "console.anthropic.com → API keys" },
    openai: { label: "OpenAI", defaultModel: "", needsBaseUrl: false, keyHelp: "platform.openai.com → API keys" },
    gemini: { label: "Google Gemini", defaultModel: "", needsBaseUrl: false, keyHelp: "aistudio.google.com → Get API key" },
    azure: { label: "Azure OpenAI", defaultModel: "", needsBaseUrl: true, keyHelp: "Azure portal → your OpenAI resource → Keys" },
    server: { label: "Own server (advanced)", defaultModel: "", needsBaseUrl: true, keyHelp: "the APP_KEY of your AI Narrator server, if it has one" }
};

// Claude models that accept server-side refusal fallbacks.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

const LENGTHS: Record<string, string> = {
    short: "1 to 2 sentences",
    medium: "3 to 4 sentences",
    detailed: "5 to 7 sentences"
};

const SYSTEM = `You write short spoken briefings about business data from a Power BI report.
Your text is read aloud by a text-to-speech voice, so:
- Write plain flowing sentences. No markdown, bullet points, headings, tables, emojis or symbols.
- Say numbers the way a presenter would: "about 1.2 million", "up 5 percent", "the 3rd of March". Round sensibly.
- Use each measure's format string to tell currencies and percentages apart (e.g. "£" or "0.0%").
- Lead with the single most important takeaway, then the supporting facts: totals, leaders and laggards, notable changes or outliers.
- Only state what the data shows. Never invent causes, targets or comparisons that aren't in the data.
- Talk about the business, never about the data itself: don't mention rows, columns, fields, measures, breakdowns, truncation, or what is missing from the data.
- Match the length to the data: if there are only one or two numbers, state them in one natural sentence and stop, even if a longer summary was requested.
- Reply with the briefing text only.`;

export const VERSION = "2.2.2";

/** Narration languages: the AI writes in this language and the voice speaks it. */
export const LANGUAGES: { code: string; name: string }[] = [
    { code: "en-GB", name: "English (UK)" },
    { code: "en-US", name: "English (US)" },
    { code: "en-IN", name: "English (India)" },
    { code: "hi-IN", name: "Hindi" },
    { code: "bn-IN", name: "Bengali" },
    { code: "ta-IN", name: "Tamil" },
    { code: "te-IN", name: "Telugu" },
    { code: "mr-IN", name: "Marathi" },
    { code: "gu-IN", name: "Gujarati" },
    { code: "kn-IN", name: "Kannada" },
    { code: "ml-IN", name: "Malayalam" },
    { code: "pa-IN", name: "Punjabi" },
    { code: "ur-PK", name: "Urdu" },
    { code: "ar-SA", name: "Arabic" },
    { code: "zh-CN", name: "Chinese (Mandarin)" },
    { code: "ja-JP", name: "Japanese" },
    { code: "ko-KR", name: "Korean" },
    { code: "fr-FR", name: "French" },
    { code: "de-DE", name: "German" },
    { code: "es-ES", name: "Spanish" },
    { code: "it-IT", name: "Italian" },
    { code: "pt-BR", name: "Portuguese (Brazil)" },
    { code: "nl-NL", name: "Dutch" },
    { code: "pl-PL", name: "Polish" },
    { code: "tr-TR", name: "Turkish" },
    { code: "ru-RU", name: "Russian" }
];

export function languageName(code: string): string {
    const hit = LANGUAGES.find(l => l.code.toLowerCase() === (code || "").toLowerCase());
    return hit ? hit.name : code || "English (UK)";
}

function cell(v: unknown): string {
    if (v === null || v === undefined || v === "") return "(blank)";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Present the figures the way a person would write them, not as a technical schema. */
function describeData(data: NarrationPayload): { text: string; tiny: boolean } {
    const measures = data.columns.map((c, i) => ({ ...c, i })).filter(c => c.role === "measure");
    const categories = data.columns.map((c, i) => ({ ...c, i })).filter(c => c.role === "category");
    const formats = measures.filter(m => m.format).map(m => `${m.name} uses number format "${m.format}"`);
    const formatNote = formats.length ? `\n(${formats.join("; ")}.)` : "";

    if (!categories.length) {
        const row = data.rows[0] || [];
        const lines = measures.map(m => `- ${m.name}: ${cell(row[m.i])}`);
        return { text: `Current figures:\n${lines.join("\n")}${formatNote}`, tiny: measures.length <= 2 };
    }
    const order = [...categories, ...measures];
    const header = order.map(c => cell(c.name)).join(", ");
    const body = data.rows.map(r => order.map(c => cell(r[c.i])).join(", ")).join("\n");
    const cut = data.truncated ? "\n(Only the first rows are shown.)" : "";
    return { text: `Figures by ${categories.map(c => c.name).join(" and ")}:\n${header}\n${body}${formatNote}${cut}`, tiny: false };
}

function languageInstruction(code: string): string {
    const english: Record<string, string> = { "en-gb": "British English", "en-us": "American English", "en-in": "Indian English" };
    const key = (code || "en-GB").toLowerCase();
    if (key.startsWith("en")) return `Write in ${english[key] || "English"}.`;
    const name = languageName(code);
    return `Write the whole briefing in ${name} (${code}), using that language's own script, as a native ${name}-speaking presenter would say it aloud. ` +
        `Translate the KPI names naturally; keep a short abbreviation (like RFS or AHT) as-is only if it has no natural translation. ` +
        `Say the numbers the way a ${name} speaker would.`;
}

function userPrompt(r: NarrationRequest): string {
    const { text, tiny } = describeData(r.data);
    const length = tiny ? "one natural sentence" : (LENGTHS[r.length] || LENGTHS.medium);
    return `These are the figures currently shown on a Power BI report page (already filtered by the page's slicers).\n\n` +
        `${text}\n\n` +
        `Write a spoken briefing of ${length} about what these numbers say about the business. ` +
        `Do not comment on the data itself, how it is structured, or what is missing from it. ` +
        languageInstruction(r.language) +
        (r.instructions ? `\nAlso follow these instructions from the report author: ${r.instructions}` : "");
}

/** Strip markdown leftovers that a voice would read out as symbols. */
function forSpeech(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/[*_#`>]+/g, "").replace(/\n{2,}/g, "\n").trim();
}

export class UserFacingError extends Error { }

/** Check the settings before calling anything; returns a message for the user, or null. */
export function settingsProblem(r: Pick<NarrationRequest, "provider" | "apiKey" | "model" | "baseUrl">): string | null {
    const info = PROVIDERS[r.provider];
    if (!info) return "Choose an AI provider in Format → AI connection.";
    if (r.provider !== "server" && !r.apiKey) return `Paste your ${info.label} API key in Format → AI connection (get one at ${info.keyHelp}).`;
    if (!r.model && !info.defaultModel && r.provider !== "server") return `Enter a model name for ${info.label} in Format → AI connection.`;
    if (info.needsBaseUrl && !r.baseUrl) return `Enter the ${r.provider === "azure" ? "Azure endpoint (https://YOUR-RESOURCE.openai.azure.com/openai/v1)" : "server URL"} in Format → AI connection.`;
    return null;
}

export async function narrate(r: NarrationRequest, signal: AbortSignal): Promise<NarrationResult> {
    const problem = settingsProblem(r);
    if (problem) throw new UserFacingError(problem);
    const model = r.model || PROVIDERS[r.provider].defaultModel;

    let text: string;
    let usedModel = model;
    switch (r.provider) {
        case "anthropic": ({ text, model: usedModel } = await callAnthropic(r, model, signal)); break;
        case "openrouter": ({ text, model: usedModel } = await callChatCompletions("https://openrouter.ai/api/v1", { Authorization: `Bearer ${r.apiKey}`, "X-Title": "AI Narrator" }, r, model, signal)); break;
        case "openai": ({ text, model: usedModel } = await callChatCompletions("https://api.openai.com/v1", { Authorization: `Bearer ${r.apiKey}` }, r, model, signal)); break;
        case "gemini": ({ text, model: usedModel } = await callChatCompletions("https://generativelanguage.googleapis.com/v1beta/openai", { Authorization: `Bearer ${r.apiKey}` }, r, model, signal)); break;
        case "azure": ({ text, model: usedModel } = await callChatCompletions(r.baseUrl, { "api-key": r.apiKey }, r, model, signal)); break;
        case "server": return callOwnServer(r, signal);
        default: throw new UserFacingError("Unknown AI provider.");
    }
    const summary = forSpeech(text);
    if (!summary) throw new Error("The AI returned an empty summary.");
    return { summary, via: `${PROVIDERS[r.provider].label} · ${usedModel} · v${VERSION}` };
}

async function callAnthropic(r: NarrationRequest, model: string, signal: AbortSignal): Promise<{ text: string; model: string }> {
    // The key is the report author's own; it lives in the report's format settings.
    const client = new Anthropic({ apiKey: r.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
    const params: Record<string, unknown> = {
        model,
        max_tokens: 4000,
        output_config: { effort: "low" },       // short narration: favour speed
        system: SYSTEM,
        messages: [{ role: "user", content: userPrompt(r) }]
    };
    if (FALLBACK_MODELS.has(model)) {
        params.betas = ["server-side-fallback-2026-07-01"];
        params.fallbacks = "default";           // if a request is declined, retry on a fallback model
    }
    try {
        const response = await client.beta.messages.create(
            params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, { signal });
        if (response.stop_reason === "refusal") throw new UserFacingError("Claude declined to summarise this data.");
        const text = response.content
            .map(b => (b.type === "text" ? b.text : ""))
            .join("");
        return { text, model: response.model };
    } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new UserFacingError("Anthropic rejected the API key. Check it in Format → AI connection.");
        if (e instanceof Anthropic.NotFoundError) throw new UserFacingError(`Anthropic doesn't recognise the model "${model}".`);
        if (e instanceof Anthropic.RateLimitError) throw new UserFacingError("Anthropic rate limit reached. Wait a moment and try again.");
        if (e instanceof Anthropic.APIError) throw new UserFacingError(`Anthropic error ${e.status ?? ""}: ${e.message}`);
        throw e;
    }
}

async function callChatCompletions(baseUrl: string, auth: Record<string, string>, r: NarrationRequest, model: string, signal: AbortSignal): Promise<{ text: string; model: string }> {
    const url = baseUrl.replace(/\/+$/, "").replace(/\/chat\/completions$/, "") + "/chat/completions";
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: SYSTEM },
                { role: "user", content: userPrompt(r) }
            ]
        }),
        signal
    });
    const raw = await res.text();
    if (!res.ok) {
        let message = raw.slice(0, 300);
        try {
            const j = JSON.parse(raw);
            const err = Array.isArray(j) ? j[0]?.error : j.error;
            message = err?.message || message;
        } catch { /* not JSON */ }
        if (res.status === 401 || res.status === 403) throw new UserFacingError(`The API key was rejected (${res.status}): ${message}`);
        if (res.status === 404) throw new UserFacingError(`Not found (404). Check the model name "${model}"${r.provider === "azure" ? " and endpoint" : ""}: ${message}`);
        if (res.status === 429) throw new UserFacingError(`Rate limit or credits exhausted (429): ${message}`);
        throw new UserFacingError(`AI error ${res.status}: ${message}`);
    }
    const json = JSON.parse(raw);
    const content = json.choices?.[0]?.message?.content;
    const text = Array.isArray(content) ? content.map((c: { text?: string }) => c.text || "").join("") : (content || "");
    return { text, model: json.model || model };
}

async function callOwnServer(r: NarrationRequest, signal: AbortSignal): Promise<NarrationResult> {
    const res = await fetch(`${r.baseUrl.replace(/\/+$/, "")}/narrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-app-key": r.apiKey || "" },
        body: JSON.stringify({ data: r.data, provider: r.model, length: r.length, instructions: r.instructions, language: r.language }),
        signal
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.summary) throw new UserFacingError(body.error || `Server returned HTTP ${res.status}`);
    return { summary: String(body.summary), via: body.provider ? `${body.provider} · ${body.model || ""}` : "own server" };
}
