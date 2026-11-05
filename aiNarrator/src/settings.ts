"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { PROVIDERS, ProviderId, LANGUAGES } from "./ai";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

const providerOptions: powerbi.IEnumMember[] = (Object.keys(PROVIDERS) as ProviderId[])
    .map(id => ({ value: id, displayName: PROVIDERS[id].label }));

const languageOptions: powerbi.IEnumMember[] = LANGUAGES.map(l => ({ value: l.code, displayName: l.name }));

const lengthOptions: powerbi.IEnumMember[] = [
    { value: "short", displayName: "Short (1-2 sentences)" },
    { value: "medium", displayName: "Medium (3-4 sentences)" },
    { value: "detailed", displayName: "Detailed (5-7 sentences)" }
];

class ConnectionCard extends FormattingSettingsCard {
    provider = new formattingSettings.ItemDropdown({
        name: "provider",
        displayName: "AI provider",
        items: providerOptions,
        value: providerOptions[0]
    });

    apiKey = new formattingSettings.TextInput({
        name: "apiKey",
        displayName: "API key",
        placeholder: "Paste your API key",
        value: ""
    });

    model = new formattingSettings.TextInput({
        name: "model",
        displayName: "Model (blank = default)",
        placeholder: "e.g. anthropic/claude-opus-5.5",
        value: ""
    });

    baseUrl = new formattingSettings.TextInput({
        name: "baseUrl",
        displayName: "Endpoint URL (Azure / own server only)",
        placeholder: "https://…",
        value: ""
    });

    name: string = "connection";
    displayName: string = "AI connection";
    slices: Array<FormattingSettingsSlice> = [this.provider, this.apiKey, this.model, this.baseUrl];
}

class NarrationCard extends FormattingSettingsCard {
    length = new formattingSettings.ItemDropdown({
        name: "length",
        displayName: "Summary length",
        items: lengthOptions,
        value: lengthOptions[1]
    });

    instructions = new formattingSettings.TextInput({
        name: "instructions",
        displayName: "Extra instructions",
        placeholder: "e.g. Focus on underperforming regions",
        value: ""
    });

    autoSpeak = new formattingSettings.ToggleSwitch({
        name: "autoSpeak",
        displayName: "Speak summary when ready",
        value: true
    });

    name: string = "narration";
    displayName: string = "Narration";
    slices: Array<FormattingSettingsSlice> = [this.length, this.instructions, this.autoSpeak];
}

class VoiceCard extends FormattingSettingsCard {
    language = new formattingSettings.ItemDropdown({
        name: "language",
        displayName: "Default language",
        items: languageOptions,
        value: languageOptions[0]
    });

    voiceName = new formattingSettings.TextInput({
        name: "voiceName",
        displayName: "Voice (name contains)",
        placeholder: "e.g. Sonia, Ryan, Libby — or use 🗣 on the visual",
        value: ""
    });

    rate = new formattingSettings.NumUpDown({
        name: "rate",
        displayName: "Speed (0.5 - 2)",
        value: 1,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 2 }
        }
    });

    pitch = new formattingSettings.NumUpDown({
        name: "pitch",
        displayName: "Pitch (0 - 2)",
        value: 1,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 2 }
        }
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Text size",
        value: 13
    });

    name: string = "voice";
    displayName: string = "Voice & text";
    slices: Array<FormattingSettingsSlice> = [this.language, this.voiceName, this.rate, this.pitch, this.fontSize];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    connectionCard = new ConnectionCard();
    narrationCard = new NarrationCard();
    voiceCard = new VoiceCard();
    cards = [this.connectionCard, this.narrationCard, this.voiceCard];
}
