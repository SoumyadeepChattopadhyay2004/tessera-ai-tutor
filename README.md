# Tessera

**An AI learning companion that tests whether you *understand*, not whether you can recall.**

Tessera turns any topic (or your own notes) into a concept map, then challenges you three ways: teach it to a curious kid, explain how ideas connect, and apply it to a situation you have never seen. It grades your *reasoning*, names the specific misconception behind a wrong answer, and keeps a running model of what you really know.

## The problem

Most learners can recite definitions but cannot explain *why* something works, link it to related ideas, or use it somewhere new. Rereading, highlighting and chatbots that simply hand over the answer all feel productive while building shallow knowledge. Learners rarely get feedback on the thing that matters: the quality of their mental model.

## What Tessera does differently

A general chatbot answers questions. Tessera does the opposite: it hides the answer and asks *you* to reason, then diagnoses how you are thinking.

| | Typical chatbot | Tessera |
|---|---|---|
| Who explains? | The AI | **You**, to a confused 12-year-old |
| Feedback | Right / wrong, or a full answer | The exact **misconception** behind your answer |
| Memory | Chat history | A persistent **learner model** per concept and skill |
| Practice material | Textbook-style examples | **Freshly invented scenarios**, so you cannot pattern-match |
| Structure | Linear text | An interactive **concept map** you fill in |

### The three rings

Every concept has three progress rings. A concept counts as learned only when all three fill up.

1. **Explain** (orange): teach the concept to *Pip*, a curious 12-year-old who keeps asking "but why?". Pip's follow-up targets exactly what you glossed over, so each answer becomes a multi-turn dialogue.
2. **Connect** (teal): explain how two linked concepts affect each other, and what would change if one disappeared. Relationships are what make knowledge stick.
3. **Apply** (green): solve a brand-new real-world scenario, invented on the spot in an unusual domain, with the concept's name left out.

### Learner model and misconception ledger

- Each answer is scored 0 to 100 and labelled **Recalled**, **Understood** or **Transferred**.
- Scores blend into per-concept, per-skill mastery over time rather than being overwritten.
- When an answer reveals a flawed belief, it goes into the **misconception ledger** and the concept is flagged on the map. The flag clears once you later answer that concept well.
- A dashed halo on the map suggests your weakest concept as the next step.

## How it works

```
Browser (vanilla JS, SVG map, localStorage learner model)
   |  POST /api/map      topic + level + optional notes
   |  POST /api/task     concept -> new scenario
   |  POST /api/assess   answer + dialogue so far -> structured grade
   v
Node server (server.js)  validation, rate limiting, prompts, JSON repair
   v
Google Gemini API (default)   or   Anthropic API (optional)
```

- **Structured outputs:** every model call is forced to return JSON (score, level, what is solid, the key gap, the misconception, the next probing question), so the UI can drive a learner model instead of just showing chat text.
- **Hidden rubric:** each concept stores its key mechanism and its most common misconception. These are sent to the model when grading but never shown to the learner until they choose to peek.
- **Adaptive follow-ups:** the assessor sees the whole dialogue, so Pip's next question responds to what you actually said. A strong answer gets a harder "what if" instead.
- **Resilience:** automatic retry on temporary overload (HTTP 503), fallback to other Gemini models if one is overloaded or out of quota, JSON repair of model output, proxy and IPv4 options for restrictive networks.
- **Safety and hygiene:** the API key stays on the server and never reaches the browser, request size limits, per-IP rate limiting, path-traversal protection, and HTML escaping of all model output.

## Project structure

```
tessera/
├── server.js          Zero-dependency Node server and provider layer
├── prompts.js         All pedagogy: map design, scenario generation, assessment rubric
├── package.json
├── .env.example       Configuration template (copy to .env)
└── public/
    ├── index.html
    ├── style.css
    └── app.js         Concept map, learner model, dialogue panel
```

## Run it locally

Requirements: Node.js 18 or newer and a free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

```bash
git clone <your-repo-url>
cd tessera
cp .env.example .env        # Windows: copy .env.example .env
# edit .env and set GEMINI_API_KEY
npm start
```

Open http://localhost:3000. There is nothing to `npm install`; the project has no dependencies.

### Configuration (`.env`)

| Variable | Purpose | Default |
|---|---|---|
| `PROVIDER` | `gemini` or `anthropic` | `gemini` |
| `GEMINI_API_KEY` | Your Google AI Studio key | none |
| `GEMINI_MODEL` | Preferred Gemini model | `gemini-3.8-flash` |
| `GEMINI_FALLBACK_MODELS` | Comma-separated models tried if the first is overloaded or out of quota | `gemini-3.7-flash,gemini-3.5-flash` |
| `ANTHROPIC_API_KEY`, `MODEL` | Used when `PROVIDER=anthropic` | none |
| `ANTHROPIC_WORKSPACE_ID` | Only if your Anthropic key is not scoped to a workspace | none |
| `PORT` | Server port | `3000` |
| `HTTPS_PROXY`, `FORCE_IPV4` | Network troubleshooting | none |

Free-tier model availability and limits change often, so check Google's current documentation if a model is rejected.

## Deploy

Tessera is a plain Node app, so any host that runs Node works (Render, Railway, Fly.io).

1. Push the repo to GitHub. `.env` is already in `.gitignore`, so keep it out of the repo.
2. Create a Web Service from the repo with build command `npm install` and start command `npm start`.
3. Add `PROVIDER` and `GEMINI_API_KEY` as environment variables on the host. Do not set `PORT`; the host provides it.

Note that visitors share your API quota, and free hosting tiers may sleep when idle.

## 60-second demo

1. Build a map for *Supply and demand*.
2. Open **Explain** on a concept and give a shallow, jargon-heavy answer. Watch Pip ask the question that exposes the gap.
3. Answer again properly, then see the score and the misconception ledger update.
4. Switch to **Apply**, generate a fresh scenario, and solve it.
5. Return to the map: the rings have filled, and the halo points to your next weakest concept.

## Limitations and roadmap

- Progress is stored in the browser (`localStorage`), so it does not sync across devices.
- Grading quality depends on the underlying model, and free models can be less consistent. Retrying usually helps.
- No accounts, and no teacher view yet.

Planned next steps: spaced-repetition scheduling of weak rings, teacher dashboards for spotting class-wide misconceptions, uploading documents as source material, and voice-based teach-back.

## License

MIT
