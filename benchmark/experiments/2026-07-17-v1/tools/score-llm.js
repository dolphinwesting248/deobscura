// LLM-based scoring prompt generator
// Outputs a prompt and JSON schema for an LLM to score all scenarios
const fs = require("fs");
const path = require("path");

const expDir = process.env.BENCH_EXP_DIR || path.join(__dirname, "..");
const scenarios = ["A","B","C","D","E"];
const dims = ["Functions","Security","DataFlow","Variables","Purpose"];

// Build the scoring prompt
let prompt = `You are a benchmark judge. Score agent answers against ground truth.
Return ONLY a JSON object with scores, no reasoning text.

Scoring rules:
- Purpose: Does the one-sentence description capture the main functionality? Consider synonyms (authentication = login, CRUD = fetch+update).
- Functions: How many functions were correctly identified? Match by purpose description, not exact name. Penalize missing functions. Bonus for correct call relationships.
- Security: How many security issues were correctly described? Match by concept, not exact words. "weak hash" = "algorithm is trivially reversible".
- DataFlow: Does the data flow description cover the actual processing steps? Keyword overlap is enough.
- Variables: How many key values were correctly identified? "https://api.example.com" = the API base URL regardless of how it's named.

Score each dimension 0.0-1.0 where 0=nothing correct, 1=perfect.\n\n`;

for (const sc of scenarios) {
  const gt = JSON.parse(fs.readFileSync(path.join(expDir, "scenarios", sc, "ground-truth.json"), "utf-8"));
  const deob = JSON.parse(fs.readFileSync(path.join(expDir, "results", `scenario_${sc}_deob.json`), "utf-8"));
  const raw = JSON.parse(fs.readFileSync(path.join(expDir, "results", `scenario_${sc}_raw.json`), "utf-8"));

  prompt += `=== SCENARIO ${sc} ===\n`;
  prompt += `Ground Truth: ${JSON.stringify({ purpose: gt.description, functions: gt.functions.map(f => ({ name: f.name, purpose: f.purpose, calls: f.calls, calledBy: f.calledBy })), securityIssues: gt.securityIssues, dataFlow: gt.dataFlow, keyVariables: gt.keyVariables })}\n`;
  prompt += `Agent DEOB answer: ${JSON.stringify({ purpose: deob.purpose, functions: deob.functions.slice(0,15), security: deob.security, dataFlow: deob.dataFlow, variables: deob.variables })}\n`;
  prompt += `Agent RAW answer: ${JSON.stringify({ purpose: raw.purpose, functions: raw.functions.slice(0,15), security: raw.security, dataFlow: raw.dataFlow, variables: raw.variables })}\n\n`;
}

prompt += `Return JSON:
{
  "A": { "deob": {"Purpose":0.0,"Functions":0.0,"Security":0.0,"DataFlow":0.0,"Variables":0.0}, "raw": {...} },
  "B": { "deob": {...}, "raw": {...} },
  "C": { "deob": {...}, "raw": {...} },
  "D": { "deob": {...}, "raw": {...} },
  "E": { "deob": {...}, "raw": {...} }
}`;

fs.writeFileSync(path.join(expDir, "results", "llm-score-prompt.txt"), prompt, "utf-8");
console.log("Prompt written to results/llm-score-prompt.txt (" + prompt.length + " chars)");
console.log("Send this prompt to an LLM and save the JSON response as results/llm-scores.json");
