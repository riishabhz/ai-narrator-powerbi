<p align="center">
  <img src="AI-Narrator-logo.png" alt="AI Narrator logo" width="128">
</p>

# AI Narrator: Power BI custom visual

**AI Narrator** is a custom visual for Power BI. It turns the KPIs on your report into a short, spoken-style briefing written by AI, then reads it aloud.

<p align="center">
  <img src="docs/toolbar.png" alt="AI Narrator toolbar: Narrate, Replay, Stop, Voice and language picker" width="600">
</p>

**✨ Narrate** writes and reads the summary · **🔊 Replay** reads it again · **⏹ Stop** stops speaking · **🗣 Voice** switches voice · **🌐** changes the language

- **Writes the summary with AI.** Choose OpenRouter, Claude, OpenAI, Gemini or Azure OpenAI.
- **Reads it aloud** with the voices built into Windows. A 🗣 button switches between them.
- **Translates** into 26 languages from a 🌐 picker on the visual, including Hindi, Tamil, Arabic, Chinese and French.
- **Follows your slicers**, so it always describes what's currently on screen.
- **Understands your terms.** Add your KPI definitions and targets as extra instructions.

Import one file, paste an API key, and click Narrate. Nothing else to install or run.

> 🔒 **Is my data safe?** Only the fields in this visual are sent, and only to the AI provider you choose. There's no middle server and no tracking. See **[Data & privacy](DATA-PRIVACY.md)** for exactly what's sent, provider policies, and recommendations for sensitive data.

## Author

Made by **Rishabh Bhardwaj**: [LinkedIn](https://www.linkedin.com/in/rishabh-data-analytics/)

## Setup (2 minutes)

1. **Import the visual.** In Power BI Desktop, go to **Visualizations pane → `…` → Import a visual from a file** and pick **`AI-Narrator.pbiviz`**. Accept the warning about uncertified visuals.
2. **Add it to a page.** Click the new **AI Narrator** icon, then drag fields in:
   - **Categories** (optional): e.g. Region, Month
   - **Measures** (at least one): e.g. Total Sales, Profit
3. **Connect the AI.** Select the visual and go to **Format → AI connection**:
   - **AI provider:** pick one from the list
   - **API key:** paste your key
   - **Model:** leave it blank to use the default
4. **Click ✨ Narrate.** The summary appears and is read aloud. **🔊 Replay** reads it again and **⏹ Stop** stops it.

When a slicer or filter changes, the visual shows *"Data changed"*. Click Narrate again for a fresh summary. It doesn't call the AI on every filter change, which keeps costs down.

## Providers

| Provider | Where to get a key | Model (blank = default) |
|---|---|---|
| **OpenRouter** (recommended: one key for hundreds of models) | openrouter.ai → Keys | `anthropic/claude-opus-5.5`. For a cheaper one, try `deepseek/deepseek-v4.1-flash`. |
| **Anthropic (Claude)** | console.anthropic.com → API keys | `claude-opus-5-5`. For a cheaper and faster one, try `claude-haiku-5-5`. |
| **OpenAI** | platform.openai.com → API keys | Required: enter a model name |
| **Google Gemini** | aistudio.google.com → Get API key | Required: enter a model name |
| **Azure OpenAI** | Azure portal → your OpenAI resource → Keys | Your deployment name. Also fill in **Endpoint URL**, e.g. `https://YOUR-RESOURCE.openai.azure.com/openai/v1` |
| **Own server (advanced)** | See [the optional server](#optional-own-server) | |

**OpenCode Go doesn't work directly.** OpenCode's servers block calls from browser-based apps like Power BI visuals. I tested this, and the other providers above pass the same test. You can use the same DeepSeek model through OpenRouter (`deepseek/deepseek-v4.1-flash`), or go through the optional server below.

## Other Format pane settings

| Card | Setting | Default |
|---|---|---|
| Narration | Summary length | Medium (3-4 sentences) |
| | Extra instructions | e.g. *"Focus on underperforming regions"* |
| | Speak summary when ready | On |
| Voice & text | Voice language | `en-GB` (try `en-US`, `hi-IN`, …) |
| | Speed / Pitch | 1 / 1 |
| | Text size | 13 |

Voices come from Windows, so installed "Natural" voices sound best. You can add more under Windows **Settings → Time & language → Speech**.

## ⚠️ Know this about the API key

The key is saved inside the report, like any other Format setting. That means:
- **Anyone who gets the .pbix file can read it.**
- **If you publish the report, viewers' browsers receive it too**, and a technical viewer could extract it.

So:
- Use a key for **your own reports or testing**.
- **Set a spending limit** on the key in your provider's dashboard. OpenRouter and Anthropic both support this.
- Before sharing a report widely, use **Own server** mode, which keeps the key on a server instead.

The rows in the visual (up to 500) are sent to the AI provider you pick.

## Troubleshooting

| Message | Fix |
|---|---|
| "Paste your … API key" | Fill in **Format → AI connection → API key**. |
| "The API key was rejected (401)" | Wrong or expired key, or the key is for a different provider than the one selected. |
| "Not found (404). Check the model name" | The model name doesn't exist for that provider. Clear the box to use the default. |
| "Rate limit or credits exhausted (429)" | Add credits or wait a minute. |
| "Couldn't reach the AI service" | No internet connection, or your network blocks that provider. |
| Text shows but no sound | Check the Windows volume and output device, then click 🔊 Replay. |

## Optional: own server

`ai-narrator-backend/` is a small Node server for teams that don't want the key inside the report, or that want OpenCode Go or a local Ollama model. Run it with `npm install` and then `npm start` (see `providers.json` there). In the visual:
- Choose **Own server**.
- Set **Endpoint URL** to `http://localhost:8787`.
- Optionally put a provider name from `providers.json` (e.g. `opencode-go`) in **Model**.

## Files

| Path | What it is |
|---|---|
| `AI-Narrator.pbiviz` | The visual (v2.0). This is the only file most people need. |
| `aiNarrator/` | Source code: `src/ai.ts` (AI calls and prompt), `src/visual.ts`, `src/settings.ts`. Rebuild with `pbiviz package`. |
| `ai-narrator-backend/` | The optional server |
