# Data & privacy: is my data safe with AI Narrator?

Short answer: AI Narrator sends **only the numbers you put into the visual**, and sends them **only to the AI provider you choose**. Nothing goes anywhere else. How safe that is depends mostly on **which provider you pick** and **what fields you drag in**. This page explains both, so you can decide for your own data.

## What leaves your report, and what doesn't

When you click **✨ Narrate** (or change the 🌐 language), the visual sends one request to your chosen AI provider containing:

| Sent | Not sent |
|---|---|
| The values of the fields **in this visual only**: up to 500 rows, after your slicers and filters are applied | The rest of your semantic model: other tables, columns or measures |
| The field names and number formats (e.g. "Answer Rate", "0.0%") | Data shown in **other visuals** on the page |
| Your **Extra instructions** text and the chosen language | Your report file, DAX, data source credentials or connection details |
| | Anything at all until someone **clicks** Narrate or changes the language |

**Example:** with *Week*, *Total RFS* and *Answer Rate* in the visual, the AI receives a small table of weekly totals. It doesn't receive agent names, customer records or anything else in the model, unless you put those fields into the visual.

## Where the data goes

- **Straight from Power BI to the AI provider, over HTTPS.** There's no middle server. The author of this visual never sees your data, and the visual has no tracking, analytics or telemetry. The code is in [`aiNarrator/src`](aiNarrator/src) if your IT team wants to check.
- **The reading-aloud part is local.** It uses the voices installed in Windows, so the audio is produced on your PC.
  - The exception is Microsoft "Online (Natural)" voices, if they appear in the 🗣 list. Those send the summary text to Microsoft's speech service.
- **The Own server option**, if you use it, goes to your server first, which then calls the AI provider.

## How each provider handles your data

Every provider has its own terms. These are the main points at the time of writing. **Check the provider's current policy before using sensitive data.**

| Provider | Used to train their AI? | Notes |
|---|---|---|
| **Azure OpenAI** | No | Runs inside **your own Azure tenant** and region, under your company's Microsoft agreement. **The best choice for company or regulated data.** |
| **Anthropic (Claude API)** | No, by default | Commercial API terms. Inputs may be kept for a limited time for safety and abuse monitoring. |
| **OpenAI API** | No, by default | Inputs may be kept for a limited time for abuse monitoring. |
| **OpenRouter** | Depends on the model host | OpenRouter forwards your request to the company that hosts the model, and **hosts' policies differ**. In OpenRouter's privacy settings, turn off providers that may train on or log your inputs. |
| **Google Gemini API** | Free tier: may be used to improve Google products. Paid tier: no | Use a paid (billed) key for business data. |

**DeepSeek and other models via OpenRouter:** which company processes your data, and in which country, depends on the host OpenRouter picks. If that matters, restrict hosts in your OpenRouter settings, or use a provider you have an agreement with.

## Your API key

- The key is saved **inside the report**, like any other Format setting. Anyone who has the `.pbix`/PBIP file, or who can view the published report and knows how to inspect it, could extract it.
- **Set a spending limit** on the key, and use a key made for this purpose only.
- For reports shared widely, use **Own server** mode (`ai-narrator-backend`). The key then stays on the server and never reaches the report.

## Recommendations by situation

| Situation | Recommendation |
|---|---|
| Aggregated KPIs (totals, rates, weekly trends) | Any provider with a paid key and no-training terms is generally fine. |
| Company-confidential figures | **Azure OpenAI** in your tenant, or **Own server** pointing at a provider your company has approved. |
| Personal data (employee or customer names, IDs) | **Don't put these fields in the visual.** If you must, get approval from your data-protection or IT team first (GDPR, DPDP and similar laws apply). |
| Highly sensitive or no-cloud-allowed data | Use **Own server** with a local model such as **Ollama**, so the data never leaves your network. Or don't use AI narration. |

## For Power BI admins

- AI Narrator is an **uncertified custom visual**, because it calls external AI services. Microsoft certification doesn't allow outbound calls.
- Tenant admins can allow or block uncertified visuals, or add AI Narrator to the **organizational visuals** list, so only an approved version is used.
- The visual declares exactly which addresses it may contact. They're under `privileges → WebAccess` in [`aiNarrator/capabilities.json`](aiNarrator/capabilities.json).

---

*AI Narrator is made by **Rishabh Bhardwaj** ([LinkedIn](https://www.linkedin.com/in/rishabh-data-analytics/)). This page is guidance, not legal advice. Follow your organisation's data policies.*
