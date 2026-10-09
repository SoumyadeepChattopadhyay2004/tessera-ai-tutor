# Tessera. Learn to understand, not memorise

An AI learning companion that tests *understanding*, *connections* and *transfer* instead of recall.

## The problem
Learners can recite definitions but cannot explain why something works, link it to other ideas, or use it in a new situation. A normal chatbot hands over the answer, which encourages passive reading.

## What Tessera does differently
1. **Concept map from any topic or your own notes.** Each concept stores its mechanism and its most common misconception, both hidden from the learner.
2. **Three rings per concept:**
   - **Explain:** teach it to *Pip*, a curious 12-year-old. Pip asks follow-ups aimed at the gap in your answer (multi-turn Feynman dialogue).
   - **Connect:** explain how two linked concepts affect each other.
   - **Apply:** solve a freshly invented real-world scenario that is not in any textbook.
3. **Reasoning is graded, not recall.** Structured JSON output gives a score, a level (Recalled, Understood or Transferred), what is right, the key gap, and the exact misconception.
4. **Persistent learner model.** Mastery per concept per skill is blended over time and stored in the browser. A misconception ledger tracks flawed beliefs until you fix them, and the map suggests your weakest concept as the next step.

## Architecture
- `server.js`: zero-dependency Node server. It serves `public/`, validates input, rate-limits, calls the Anthropic Messages API and parses JSON robustly. Your API key never reaches the browser.
- `prompts.js`: all pedagogy as prompts (map design, scenario generation, assessment rubric).
- `public/`: vanilla JS frontend (SVG concept map, learner model, dialogue panel).

Endpoints: `POST /api/map`, `POST /api/task`, `POST /api/assess`.

## Run it
Requires Node 18 or newer and an Anthropic API key.

```bash
cp .env.example .env     # then put your key in .env
npm start
# open http://localhost:3000
```

## Demo script (60 seconds)
Map "Supply and demand", give a shallow explanation to Pip and watch it expose the gap, fix the misconception in the ledger, then solve a new scenario in Apply mode.

## Limitations and next steps
Progress lives in the browser (`localStorage`) only. Next steps: accounts, spaced-repetition scheduling of weak rings, teacher dashboards, and offline model support.
