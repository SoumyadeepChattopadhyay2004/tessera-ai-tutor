"use strict";
/**
 * All pedagogy lives here. Each prompt forces structured JSON so the UI can
 * drive a persistent learner model instead of just rendering chat text.
 */

const SYSTEM =
  "You are Tessera, a rigorous but kind learning scientist. You assess genuine " +
  "understanding (mechanism, causality, transfer), never recall. You always reply " +
  "with a single valid JSON object and nothing else: no markdown, no commentary.";

function mapPrompt({ topic, level, notes }) {
  return `Build a concept map for learning: "${topic}".
Learner level: ${level}.
${notes ? `Base the map ONLY on these learner notes:\n"""\n${notes}\n"""\n` : ""}
Return JSON of exactly this shape:
{
  "title": string,
  "nodes": [ { "id": "n0", "name": string (max 3 words),
               "core": string (one sentence giving the WHY / mechanism, not a bare definition),
               "misconception": string (the most common wrong belief about this concept) } ],
  "edges": [ { "a": "n0", "b": "n1", "rel": string (short causal verb phrase such as "drives", "limits", "only works because of") } ]
}
Rules: exactly 7 nodes with ids n0..n6; 9 to 11 edges; the graph must be connected;
no vague relations like "relates to"; nodes should span cause, mechanism and consequence.`;
}

function taskPrompt({ topic, node }) {
  return `Topic: "${topic}". Concept: "${node.name}" (${node.core}).
Invent a vivid, concrete, NOVEL real-world situation in an unusual domain (not a textbook example)
where a person must predict, decide or diagnose something, and where truly understanding this concept
is the key. Do NOT mention the concept's name.
Return JSON: { "scenario": string (3-4 sentences), "question": string }`;
}

function assessPrompt({ topic, node, mode, question, thread, relation }) {
  const persona =
    mode === "e"
      ? "Feynman teach-back. The followUp must be voiced by Pip, a curious 12-year-old who keeps asking 'but why?'."
      : mode === "c"
      ? "Relationship reasoning between linked concepts."
      : "Transfer of the concept to a novel scenario.";
  return `Topic: ${topic}
Concept: ${node.name}
Key idea (hidden from the learner): ${node.core}
Common misconception: ${node.misconception}
Mode: ${persona}
${relation ? `Intended relationship: ${JSON.stringify(relation)}\n` : ""}Challenge shown to learner:
${question}

Conversation so far (oldest first):
${JSON.stringify(thread)}

Judge the learner's LATEST answer in light of the whole conversation.
Reward mechanism, causal chains, original analogies and correct transfer.
Penalise buzzword recitation, circular definitions and misconceptions.
Be specific; do not quote long passages.

Return JSON:
{
  "score": integer 0-100,
  "level": "Recalled" | "Understood" | "Transferred",
  "solid": string (what is genuinely right),
  "gap": string (the single most important missing piece),
  "misconception": string or null (the exact flawed belief the learner showed, else null),
  "followUp": string (ONE probing question aimed at the gap; if score >= 85 pose a harder what-if)
}`;
}

module.exports = { SYSTEM, mapPrompt, taskPrompt, assessPrompt };
