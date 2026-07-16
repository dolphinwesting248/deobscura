// Benchmark scoring script — compare agent answers to ground truth
const fs = require("fs");
const path = require("path");

function loadAnswer(filepath) {
  const raw = fs.readFileSync(filepath, "utf-8");
  return JSON.parse(raw);
}

// Extract significant keywords from text (filter stopwords, min length)
function keywords(text, minLen) {
  const STOP = new Set(["this","that","with","from","into","each","then","also","here","very","just","over","been","some","such","have","were","does","will","when","what","used","part","they","them","this","than","well","more"]);
  return [...new Set((text || "").toLowerCase().split(/\W+/).filter(w => w.length >= minLen && !STOP.has(w)))];
}

// Semantic overlap score (Jaccard-like with bonus for longer matches)
function semanticOverlap(answerText, truthText, minLen) {
  const aw = keywords(answerText, minLen || 3);
  const tw = keywords(truthText, minLen || 3);
  if (tw.length === 0) return 1;
  let score = 0;
  for (const awi of aw) {
    for (const twi of tw) {
      // Exact match
      if (awi === twi) { score += 1; break; }
      // Short word containment
      else if (awi.length >= 5 && twi.length >= 5 && (awi.includes(twi) || twi.includes(awi))) { score += 0.5; break; }
    }
  }
  return Math.min(1, score / tw.length);
}

function scorePurpose(answer, truth) {
  return semanticOverlap(answer.purpose || "", truth.description || "", 4);
}

function scoreFunctions(answer, truth) {
  if (truth.functions.length === 0) return 1;
  let matched = 0;
  for (const tf of truth.functions) {
    const truthText = (tf.purpose || "") + " " + (tf.name || "");
    let bestMatch = 0;
    for (const af of answer.functions) {
      const answerText = (af.purpose || "") + " " + (af.name || "");
      const sim = semanticOverlap(answerText, truthText, 3);
      if (sim > bestMatch) bestMatch = sim;
    }
    if (bestMatch > 0.3) matched += bestMatch;
  }
  const precision = answer.functions.length > 0 ? matched / answer.functions.length : 0;
  const recall = truth.functions.length > 0 ? matched / truth.functions.length : 0;
  return (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
}

function scoreEndpoints(answer, truth) {
  if (truth.apiEndpoints.length === 0) return 1;
  let matched = 0;
  for (const te of truth.apiEndpoints) {
    const found = answer.endpoints.find(e => {
      if (e.method !== te.method) return false;
      const ep = (e.path || "").replace(/[{}]/g, "").replace(/:id|:username/g, "id");
      const tp = (te.path || "").replace(/[{}]/g, "").replace(/:id|:username/g, "id");
      return ep.includes(tp) || tp.includes(ep);
    });
    if (found) matched++;
  }
  return matched / truth.apiEndpoints.length;
}

function scoreSecurity(answer, truth) {
  if (truth.securityIssues.length === 0) return 1;
  let matched = 0;
  for (const ts of truth.securityIssues) {
    const truthText = (ts.issue || "") + " " + (ts.location || "");
    let bestMatch = 0;
    for (const as of answer.security) {
      const answerText = (as.issue || "");
      const sim = semanticOverlap(answerText, truthText, 3);
      if (sim > bestMatch) bestMatch = sim;
    }
    if (bestMatch > 0.25) matched += bestMatch;
  }
  return Math.min(1, matched / Math.max(1, truth.securityIssues.length));
}

function scoreDataFlow(answer, truth) {
  const af = (answer.dataFlow || "").toLowerCase();
  const tf = (truth.dataFlow || []).join(" ").toLowerCase();
  return semanticOverlap(af, tf, 3);
}

function scoreVariables(answer, truth) {
  const tvars = Object.entries(truth.keyVariables);
  if (tvars.length === 0) return 1;
  let matched = 0;
  for (const [name, value] of tvars) {
    const found = answer.variables.find(v => {
      const vv = (v.value || v.name || "").toLowerCase();
      const tv = value.toLowerCase();
      return tv.length > 2 && vv.length > 2 && (vv.includes(tv.substring(0, 8)) || tv.includes(vv.substring(0, 8)));
    });
    if (found) matched++;
  }
  return matched / tvars.length;
}

function scoreEntry(answer, truth) {
  return answer.entryPoint && answer.entryPoint.length > 3 ? 1 : 0;
}

// Bidirectional normalization: faster/cheaper = higher score
// Uses agent_value / (deob_value + raw_value), so deob and raw get different scores
function scoreTime(agentTime, deobTime, rawTime) {
  const total = (deobTime || 0) + (rawTime || 0);
  if (total <= 0 || !agentTime) return 0.5;
  return 1 - (agentTime / total);
}

function scoreToken(agentTokens, deobTokens, rawTokens) {
  const total = (deobTokens || 0) + (rawTokens || 0);
  if (total <= 0 || !agentTokens) return 0.5;
  return 1 - (agentTokens / total);
}

function computeScores(answer, truth, meta, agentType, llmScores) {
  const isDeob = agentType === "deob";
  const deobT = meta.deobTime || 0, rawT = meta.rawTime || 0;
  const deobK = meta.deobTokens || 0, rawK = meta.rawTokens || 0;

  // Use LLM scores for qualitative dimensions, fall back to keyword-based
  const scores = {
    purpose:   llmScores ? (llmScores.Purpose || scorePurpose(answer, truth)) : scorePurpose(answer, truth),
    functions: llmScores ? (llmScores.Functions || scoreFunctions(answer, truth)) : scoreFunctions(answer, truth),
    endpoints: scoreEndpoints(answer, truth),
    security:  llmScores ? (llmScores.Security || scoreSecurity(answer, truth)) : scoreSecurity(answer, truth),
    dataFlow:  llmScores ? (llmScores.DataFlow || scoreDataFlow(answer, truth)) : scoreDataFlow(answer, truth),
    variables: llmScores ? (llmScores.Variables || scoreVariables(answer, truth)) : scoreVariables(answer, truth),
    entry: scoreEntry(answer, truth),
    time: scoreTime(isDeob ? deobT : rawT, deobT, rawT),
    token: scoreToken(isDeob ? deobK : rawK, deobK, rawK),
  };
  scores.total =
    scores.purpose * 0.05 + scores.functions * 0.30 + scores.endpoints * 0.15 +
    scores.security * 0.20 + scores.dataFlow * 0.10 + scores.variables * 0.10 +
    scores.time * 0.05 + scores.entry * 0.025 + scores.token * 0.025;
  return scores;
}

// Run scoring for a scenario
function scoreScenario(scenario, expDir) {
  const basePath = path.join(expDir, "scenarios", scenario);
  const gtPath = path.join(basePath, "ground-truth.json");
  const resultsDir = path.join(expDir, "results");
  const deobPath = path.join(resultsDir, `scenario_${scenario}_deob.json`);
  const rawPath = path.join(resultsDir, `scenario_${scenario}_raw.json`);
  const tokenPath = path.join(resultsDir, "tokens.json");

  if (!fs.existsSync(deobPath) || !fs.existsSync(rawPath)) return null;
  const gt = JSON.parse(fs.readFileSync(gtPath, "utf-8"));
  const deobAnswer = loadAnswer(deobPath);
  const rawAnswer = loadAnswer(rawPath);

  // Load LLM-judged scores (qualitative dimensions)
  const llmScoresPath = path.join(resultsDir, "llm-scores.json");
  let llmData = null;
  if (fs.existsSync(llmScoresPath)) {
    const allLlm = JSON.parse(fs.readFileSync(llmScoresPath, "utf-8"));
    if (allLlm[scenario]) llmData = allLlm[scenario];
  }

  // Read token/time from _meta embedded in answer JSONs
  const deobMeta = deobAnswer._meta || {};
  const rawMeta = rawAnswer._meta || {};

  const meta = {
    deobTokens: deobMeta.tokens || 0,
    rawTokens: rawMeta.tokens || 0,
    deobTime: deobMeta.time || 0,
    rawTime: rawMeta.time || 0,
  };

  return {
    scenario,
    deob: computeScores(deobAnswer, gt, meta, "deob", llmData ? llmData.deob : null),
    raw: computeScores(rawAnswer, gt, meta, "raw", llmData ? llmData.raw : null),
    tokens: meta,
  };
}

// Print report
// Self-contained experiment: tools/ lives under experiment dir
const expDir = process.env.BENCH_EXP_DIR || path.join(__dirname, "..");
const scenarios = process.argv.includes("--all") ? ["A","B","C","D","E"] : process.argv.slice(2).filter(a => a.match(/^[A-E]$/));

if (scenarios.length === 0) {
  console.log("Usage: node benchmark/tools/score.js [scenario] [--all]");
  console.log("  Set BENCH_EXP_DIR env var to override experiment dir");
  process.exit(0);
}

console.log("=== Benchmark Score Report ===\n");
console.log("| Scenario | Agent | Purpose | Functions | Endpoints | Security | DataFlow | Vars | Time | Entry | Token | Total |");
console.log("|----------|-------|---------|-----------|-----------|----------|----------|------|------|-------|-------|-------|");

for (const sc of scenarios) {
  const result = scoreScenario(sc, expDir);
  if (!result) { console.log(`| ${sc} | — | no data | | | | | | | | | | | |`); continue; }

  const d = result.deob, r = result.raw, m = result.tokens;
  console.log(`| ${sc} | deob | ${d.purpose.toFixed(2)} | ${d.functions.toFixed(2)} | ${d.endpoints.toFixed(2)} | ${d.security.toFixed(2)} | ${d.dataFlow.toFixed(2)} | ${d.variables.toFixed(2)} | ${d.time.toFixed(2)} | ${d.entry.toFixed(2)} | ${d.token.toFixed(2)} | ${d.total.toFixed(2)} |`);
  console.log(`| ${sc} | raw  | ${r.purpose.toFixed(2)} | ${r.functions.toFixed(2)} | ${r.endpoints.toFixed(2)} | ${r.security.toFixed(2)} | ${r.dataFlow.toFixed(2)} | ${r.variables.toFixed(2)} | ${r.time.toFixed(2)} | ${r.entry.toFixed(2)} | ${r.token.toFixed(2)} | ${r.total.toFixed(2)} |`);
  const ratioT = m.rawTokens > 0 ? (m.rawTokens / m.deobTokens).toFixed(1) + "x" : "—";
  const ratioM = m.rawTime > 0 ? (m.rawTime / m.deobTime).toFixed(1) + "x" : "—";
  console.log(`| ${sc} | meta | time: ${ratioM} (${m.rawTime}s/${m.deobTime}s), tokens: ${ratioT} (${m.rawTokens}/${m.deobTokens}) |`);
  const imp = r.total > 0 ? (d.total / r.total).toFixed(1) + "x" : "inf";
  console.log(`| ${sc} | imprv | ${(d.purpose/r.purpose||0).toFixed(1)}x | ${(d.functions/r.functions||0).toFixed(1)}x | ${(d.endpoints/r.endpoints||0).toFixed(1)}x | ${(d.security/r.security||0).toFixed(1)}x | ${(d.dataFlow/r.dataFlow||0).toFixed(1)}x | ${(d.variables/r.variables||0).toFixed(1)}x | — | — | — | **${imp}** |`);
}

console.log("\n---");
console.log("Weights: purpose=10%, functions=30%, endpoints=15%, security=20%, dataFlow=10%, vars=10%, entry=5%");
