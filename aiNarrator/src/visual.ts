"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";
import { narrate, settingsProblem, NarrationPayload, ProviderId, UserFacingError, LANGUAGES, languageName, VERSION } from "./ai";

const MAX_ROWS_SENT = 500;

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private voiceBtn: HTMLButtonElement;
    private langSelect: HTMLSelectElement;
    private sessionLang: string | null = null;   // a viewer's pick on the visual; not saved
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private root: HTMLElement;
    private narrateBtn: HTMLButtonElement;
    private speakBtn: HTMLButtonElement;
    private stopBtn: HTMLButtonElement;
    private status: HTMLDivElement;
    private summaryEl: HTMLDivElement;

    private payload: NarrationPayload | null = null;
    private payloadKey = "";
    private summaryKey = "";
    private summary = "";
    private via = "";
    private busy = false;
    private voices: SpeechSynthesisVoice[] = [];

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.formattingSettingsService = new FormattingSettingsService();
        // Format pane must work before any data is added (update() may not have run yet).
        this.formattingSettings = new VisualFormattingSettingsModel();

        this.root = document.createElement("div");
        this.root.className = "ai-narrator";

        const toolbar = document.createElement("div");
        toolbar.className = "toolbar";
        this.narrateBtn = this.button("✨ Narrate", `Generate an AI summary of this data and read it aloud (AI Narrator v${VERSION})`, () => this.narrate());
        this.speakBtn = this.button("🔊 Replay", "Read the summary aloud again", () => this.speak(this.summary));
        this.stopBtn = this.button("⏹ Stop", "Stop speaking", () => this.stopSpeaking());
        this.voiceBtn = this.button("🗣 Voice", "Switch to the next voice and hear a sample (saved with the report)", () => this.nextVoice());
        this.langSelect = document.createElement("select");
        this.langSelect.className = "lang";
        this.langSelect.title = "Language: the summary is rewritten and read aloud in this language";
        this.langSelect.setAttribute("aria-label", "Narration language");
        for (const l of LANGUAGES) {
            const o = document.createElement("option");
            o.value = l.code;
            o.textContent = `🌐 ${l.name}`;
            this.langSelect.appendChild(o);
        }
        this.langSelect.addEventListener("click", e => e.stopPropagation());
        this.langSelect.addEventListener("change", () => {
            this.sessionLang = this.langSelect.value;
            if (this.payload && !settingsProblem(this.connection())) void this.narrate();
        });
        toolbar.append(this.narrateBtn, this.speakBtn, this.stopBtn, this.voiceBtn, this.langSelect);

        this.status = document.createElement("div");
        this.status.className = "status";
        this.status.setAttribute("role", "status");

        this.summaryEl = document.createElement("div");
        this.summaryEl.className = "summary";
        this.summaryEl.setAttribute("aria-live", "polite");

        this.root.append(toolbar, this.status, this.summaryEl);
        options.element.appendChild(this.root);

        if (this.speechSupported()) {
            this.voices = window.speechSynthesis.getVoices();
            window.speechSynthesis.onvoiceschanged = () => { this.voices = window.speechSynthesis.getVoices(); };
        }
        this.refreshButtons();
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);
        try {
            const dataView = options.dataViews && options.dataViews[0];
            this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
            this.root.style.fontSize = `${this.formattingSettings.voiceCard.fontSize.value}px`;
            this.langSelect.value = this.lang();

            this.payload = this.extract(dataView);
            this.payloadKey = this.payload ? JSON.stringify(this.payload) : "";

            const setupProblem = settingsProblem(this.connection());
            if (!this.payload) {
                this.setStatus("Add at least one measure (and optionally categories) to the field wells.");
            } else if (setupProblem) {
                this.setStatus(setupProblem);
            } else if (!this.summary) {
                this.setStatus(`${this.payload.rows.length} row(s) ready. Press ✨ Narrate.`);
            } else if (this.summaryKey !== this.payloadKey) {
                this.setStatus("Data or filters changed. Press ✨ Narrate for an updated summary.");
            } else {
                this.setStatus(this.via);
            }
            this.refreshButtons();
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    public destroy(): void {
        this.stopSpeaking();
    }

    // ---------------------------------------------------------------- data

    /** Turn the table dataView into a compact columns + rows payload. */
    private extract(dataView: DataView | undefined): NarrationPayload | null {
        const table = dataView && dataView.table;
        if (!table || !table.columns || !table.columns.length) return null;

        const columns = table.columns.map(c => ({
            name: c.displayName,
            role: (c.roles && c.roles["measure"] ? "measure" : "category") as "category" | "measure",
            format: c.format || undefined
        }));
        if (!columns.some(c => c.role === "measure")) return null;

        const rows = (table.rows || []).slice(0, MAX_ROWS_SENT).map(r =>
            r.map(v => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | number | boolean | null)))
        );
        return { columns, rows, truncated: (table.rows || []).length > MAX_ROWS_SENT };
    }

    // ---------------------------------------------------------------- AI call

    /** Current narration language: the viewer's pick on the visual, else the report default. */
    private lang(): string {
        const fromPane = this.formattingSettings.voiceCard.language.value;
        const saved = String((fromPane && fromPane.value) || "en-GB");
        const valid = LANGUAGES.some(l => l.code === saved) ? saved : "en-GB";
        return this.sessionLang || valid;
    }

    /** The AI connection settings from the Format pane. */
    private connection() {
        const c = this.formattingSettings.connectionCard;
        return {
            provider: String(c.provider.value?.value || "openrouter") as ProviderId,
            apiKey: (c.apiKey.value || "").trim(),
            model: (c.model.value || "").trim(),
            baseUrl: (c.baseUrl.value || "").trim()
        };
    }

    private async narrate(): Promise<void> {
        if (!this.payload || this.busy) return;
        const conn = this.connection();
        const problem = settingsProblem(conn);
        if (problem) { this.setStatus(problem, true); return; }
        const s = this.formattingSettings.narrationCard;

        this.stopSpeaking();
        this.busy = true;
        this.refreshButtons();
        const lang = this.lang();
        this.setStatus(lang.startsWith("en") ? "Writing summary…" : `Writing summary in ${languageName(lang)}…`);
        const requestedKey = this.payloadKey;

        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 90000);
        try {
            const result = await narrate({
                ...conn,
                data: this.payload,
                length: String(s.length.value.value),
                instructions: s.instructions.value || "",
                language: lang
            }, controller.signal);
            this.summary = result.summary;
            this.summaryKey = requestedKey;
            this.summaryEl.textContent = this.summary;   // textContent: never inject HTML
            this.summaryEl.lang = lang;
            this.via = `via ${result.via}`;
            if (!this.hasVoiceFor(lang)) {
                this.via += ` · No ${languageName(lang)} voice on this PC, so it can't be read aloud. Add one in Windows Settings → Time & language → Speech.`;
            }
            this.setStatus(this.summaryKey === this.payloadKey ? this.via : "Data changed while writing. Press ✨ Narrate again.");
            if (s.autoSpeak.value && this.hasVoiceFor(lang)) this.speak(this.summary);
        } catch (e) {
            const err = e as Error;
            const msg = err.name === "AbortError" || /abort/i.test(err.message) ? "The AI took too long to answer."
                : err instanceof UserFacingError ? err.message
                : /failed to fetch|networkerror|load failed/i.test(err.message) ? "Couldn't reach the AI service. Check your internet connection (and for Azure/own server, the endpoint URL)."
                : err.message;
            this.setStatus(msg, true);
        } finally {
            window.clearTimeout(timer);
            this.busy = false;
            this.refreshButtons();
        }
    }

    // ---------------------------------------------------------------- speech

    private speechSupported(): boolean {
        return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
    }

    private speak(text: string, langOverride?: string): void {
        if (!text) return;
        if (!this.speechSupported()) { this.setStatus("Speech isn't supported in this host. The summary is shown as text.", true); return; }
        this.stopSpeaking();

        const v = this.formattingSettings.voiceCard;
        const lang = langOverride || this.summaryEl.lang || this.lang();
        const voice = this.pickVoice(lang);
        // Chromium cuts long utterances off after ~15s, so queue one sentence at a time.
        // Sentence ends: . ! ? । ॥ ؟ ۔ followed by a space (so "90.8" stays whole), or CJK 。！？ directly.
        const parts = text.split(/(?<=[.!?।॥؟۔]["')\]]*)\s+|(?<=[。！？」』])/).map(p => p.trim()).filter(Boolean);
        const sentences = parts.length ? parts : [text];
        sentences.forEach((sentence, i) => {
            const u = new SpeechSynthesisUtterance(sentence.trim());
            u.lang = lang;
            if (voice) u.voice = voice;
            u.rate = Math.min(2, Math.max(0.5, v.rate.value || 1));
            u.pitch = Math.min(2, Math.max(0, v.pitch.value ?? 1));
            if (i === sentences.length - 1) u.onend = () => this.refreshButtons();
            window.speechSynthesis.speak(u);
        });
        this.refreshButtons();
    }

    private langPrefix(lang: string): string {
        return (lang || "").toLowerCase().replace("_", "-").split("-")[0];
    }

    /** Voices that speak the given language. */
    private voicesFor(lang: string): SpeechSynthesisVoice[] {
        if (!this.voices.length && this.speechSupported()) this.voices = window.speechSynthesis.getVoices();
        const prefix = this.langPrefix(lang);
        return this.voices.filter(x => this.langPrefix(x.lang) === prefix);
    }

    private hasVoiceFor(lang: string): boolean {
        // If the browser hasn't listed voices yet, don't block speaking.
        return !this.speechSupported() || !this.voices.length || this.voicesFor(lang).length > 0;
    }

    /** Voices for the chosen language (falls back to all voices). */
    private candidateVoices(lang: string): SpeechSynthesisVoice[] {
        const matching = this.voicesFor(lang);
        return matching.length ? matching : this.voices;
    }

    private shortVoiceName(v: SpeechSynthesisVoice): string {
        return v.name.replace(/^Microsoft\s+/i, "").replace(/\s*Online \(Natural\)/i, " (natural)").replace(/\s+-\s+.*$/, "");
    }

    /** Cycle to the next voice, preview it, and save the choice into the report. */
    private nextVoice(): void {
        if (!this.speechSupported()) { this.setStatus("Speech isn't supported in this host.", true); return; }
        const v = this.formattingSettings.voiceCard;
        const lang = this.lang();
        const list = this.candidateVoices(lang);
        if (!list.length) { this.setStatus("No voices found on this computer. Add some in Windows Settings → Time & language → Speech.", true); return; }
        const current = this.pickVoice(lang);
        const idx = current ? list.findIndex(x => x.name === current.name) : -1;
        const next = list[(idx + 1) % list.length];

        v.voiceName.value = next.name;   // apply immediately, then persist
        this.host.persistProperties({
            merge: [{ objectName: "voice", selector: null, properties: { voiceName: next.name } }]
        });
        this.via = `Voice: ${this.shortVoiceName(next)} (${list.indexOf(next) + 1} of ${list.length})`;
        this.setStatus(this.via);
        this.speak(`Hi, I'm ${this.shortVoiceName(next).replace(/\s*\(natural\)/, "")}.`, next.lang);
    }

    private pickVoice(lang: string): SpeechSynthesisVoice | undefined {
        if (!this.voices.length && this.speechSupported()) this.voices = window.speechSynthesis.getVoices();
        const wanted = (this.formattingSettings.voiceCard.voiceName.value || "").trim().toLowerCase();
        if (wanted) {
            const chosen = this.voices.find(x => x.name.toLowerCase() === wanted)
                || this.voices.find(x => x.name.toLowerCase().includes(wanted));
            // Use the chosen voice only if it speaks this language (e.g. not an English voice for Hindi text).
            if (chosen && this.langPrefix(chosen.lang) === this.langPrefix(lang)) return chosen;
        }
        const l = lang.toLowerCase();
        const prefix = l.split("-")[0];
        return this.voices.find(x => x.lang.toLowerCase() === l && /natural|neural|online/i.test(x.name))
            || this.voices.find(x => x.lang.toLowerCase() === l)
            || this.voices.find(x => x.lang.toLowerCase().startsWith(prefix));
    }

    private stopSpeaking(): void {
        if (this.speechSupported()) window.speechSynthesis.cancel();
        this.refreshButtons();
    }

    // ---------------------------------------------------------------- UI helpers

    private button(label: string, title: string, onClick: () => void): HTMLButtonElement {
        const b = document.createElement("button");
        b.textContent = label;
        b.title = title;
        b.setAttribute("aria-label", title);
        b.addEventListener("click", e => { e.stopPropagation(); onClick(); });
        return b;
    }

    private setStatus(text: string, isError = false): void {
        this.status.textContent = text;
        this.status.classList.toggle("error", isError);
    }

    private refreshButtons(): void {
        this.narrateBtn.disabled = this.busy || !this.payload;
        this.narrateBtn.textContent = this.busy ? "⏳ Writing…" : "✨ Narrate";
        this.speakBtn.disabled = !this.summary;
        this.voiceBtn.disabled = !this.speechSupported();
        this.stopBtn.disabled = !(this.speechSupported() && window.speechSynthesis.speaking);
        // speechSynthesis.speaking flips shortly after speak(); re-check once.
        if (this.speechSupported()) window.setTimeout(() => { this.stopBtn.disabled = !window.speechSynthesis.speaking; }, 300);
    }
}
