// Benchmark scoring: compare agent outputs against ground truth
// Usage: node benchmark/scoring.js [--scenario A]
// Reads agent JSON responses from benchmark/results/

const fs = require("fs");
const path = require("path");

const scenarios = ["A", "B", "C", "D", "E"];
const scenarioLabels = { A: "API Client", B: "Auth Flow", C: "Data Pipeline", D: "Webpack Bundle", E: "Payment Processing" };
const basePath = path.join(__dirname, "scenarios");
const resultsDir = path.join(__dirname, "results");

// ── Scoring functions ──

function keywordMatch(text, keywords) {
  const kw = keywords.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const txt = text.toLowerCase();
  return kw.filter(w => txt.includes(w)).length / Math.max(1, kw.length);
}

function scoreFunctions(answerJson, gt) {
  if (!gt.functions || gt.functions.length === 0) return { score: 1, detail: "N/A" };
  const answerText = JSON.stringify(answerJson).toLowerCase();
  let matched = 0;
  for (const fn of gt.functions) {
    const purposeWords = fn.purpose.split(/\W+/).filter(w => w.length > 3);
    const matchedWords = purposeWords.filter(w => answerText.includes(w.toLowerCase())).length;
    if (matchedWords >= 2) matched++;
  }
  const recall = matched / gt.functions.length;
  const precision = Math.min(1, matched / Math.max(1, gt.functions.length));
  return {
    score: recall + precision === 0 ? 0 : 2 * recall * precision / (recall + precision),
    detail: `${matched}/${gt.functions.length}`,
    maxScore: 25
  };
}

function scoreApiEndpoints(answerJson, gt) {
  if (!gt.apiEndpoints || gt.apiEndpoints.length === 0) return { score: 1, detail: "N/A", maxScore: 20 };
  const answerText = JSON.stringify(answerJson).toLowerCase();
  let matched = 0;
  for (const ep of gt.apiEndpoints) {
    const pathParts = ep.path.split("/").filter(Boolean);
    if (pathParts.every(p => answerText.includes(p.toLowerCase()))) matched++;
    else if (answerText.includes(ep.method.toLowerCase()) && answerText.includes(ep.purpose.toLowerCase().split(" ")[0])) matched += 0.5;
  }
  return { score: matched / gt.apiEndpoints.length, detail: `${matched}/${gt.apiEndpoints.length}`, maxScore: 20 };
}

function scoreSecurity(answerJson, gt) {
  if (!gt.securityIssues || gt.securityIssues.length === 0) return { score: 1, detail: "N/A", maxScore: 25 };
  const answerText = JSON.stringify(answerJson).toLowerCase();
  let matched = 0;
  for (const si of gt.securityIssues) {
    const keywords = si.issue.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const matchCount = keywords.filter(w => answerText.includes(w)).length;
    if (matchCount >= keywords.length * 0.5) matched++;
  }
  return { score: matched / gt.securityIssues.length, detail: `${matched}/${gt.securityIssues.length}`, maxScore: 25 };
}

function scoreDataFlow(answerJson, gt) {
  if (!gt.dataFlow || gt.dataFlow.length === 0) return { score: 1, detail: "N/A", maxScore: 15 };
  const answerText = JSON.stringify(answerJson).toLowerCase();
  let totalSim = 0;
  for (const flow of gt.dataFlow) {
    const keywords = flow.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const matched = keywords.filter(w => answerText.includes(w)).length;
    totalSim += matched / Math.max(1, keywords.length);
  }
  return { score: totalSim / gt.dataFlow.length, detail: "", maxScore: 15 };
}

function scoreKeyVars(answerJson, gt) {
  if (!gt.keyVariables || Object.keys(gt.keyVariables).length === 0) return { score: 1, detail: "N/A", maxScore: 15 };
  const answerText = JSON.stringify(answerJson).toLowerCase();
  const entries = Object.entries(gt.keyVariables);
  let matched = 0;
  for (const [name, value] of entries) {
    if (answerText.includes(value.toLowerCase())) matched++;
  }
  return { score: matched / entries.length, detail: `${matched}/${entries.length}`, maxScore: 15 };
}

function scoreEfficiency(tokens, durationMs, baseline) {
  // Normalize against baseline: fewer tokens + less time = higher score
  const tokenScore = Math.min(1, baseline.tokens / Math.max(1, tokens));
  const timeScore = Math.min(1, baseline.timeMs / Math.max(1, durationMs));
  return { tokenScore, timeScore, tokens, durationMs };
}

// ── Manual agent results storage (from agent runs) ──
// Fill these in after running agents

const agentResults = {
  A: {
    deob: JSON.parse(`{"description":"An obfuscated API client that logs into a remote service with hardcoded credentials (admin/<password>), stores a Bearer session token in localStorage, and then fetches the authenticated user's profile.","functions":[{"name":"_0x_0x4613","purpose":"Self-modifying string table","calls":[]},{"name":"_0x_0x11ac","purpose":"String decoder","calls":[]},{"name":"_0x_0x40c1ce","purpose":"Weak string hasher (djb2 variant)","calls":[]},{"name":"_0x_0x55d5c1","purpose":"Auth header factory","calls":[]},{"name":"_0x_0xbf9ba1","purpose":"Core authenticated HTTP request","calls":["_0x_0x55d5c1"]},{"name":"_0x_0x598566","purpose":"Login - hashes password, POSTs credentials, stores token in localStorage","calls":["_0x_0x40c1ce","_0x_0xbf9ba1"]},{"name":"_0x_0x141588","purpose":"Get user profile - reads token from localStorage, makes authenticated GET request","calls":["_0x_0xbf9ba1"]},{"name":"_0x_0x4f87af","purpose":"Update user data - reads token from localStorage, makes authenticated PUT request","calls":["_0x_0xbf9ba1"]}],"apiEndpoints":[{"method":"POST","path":"/auth/login","purpose":"authenticate user"},{"method":"GET","path":"/users/:id","purpose":"fetch user profile"},{"method":"PUT","path":"/users/:id","purpose":"update user profile"}],"securityIssues":[{"severity":"high","issue":"Weak password hashing - djb2 hash with no salt","location":"_0x_0x40c1ce"},{"severity":"high","issue":"Session token stored in localStorage (vulnerable to XSS)","location":"_0x_0x598566"},{"severity":"medium","issue":"Hardcoded credentials","location":"entry point"}],"dataFlow":["login: hash password → POST to auth endpoint → store token in localStorage","profile: read token from localStorage → GET/PUT to users endpoint with Bearer auth"],"keyVariables":[{"name":"API_BASE_URL","value":"https://api.example.com"},{"name":"AUTH_TOKEN_KEY","value":"session_token"}],"entryPoint":"_0x_0x598566"}`),
    deobTokens: 26953,
    deobTime: 121153,
    raw: JSON.parse(`{"description":"A client-side authentication and profile management script that interacts with a REST API at https://api.example.com.","functions":[{"name":"_0x_0x11ac","purpose":"String decoder","calls":[]},{"name":"_0x_0x40c1ce","purpose":"djb2 hash variant","calls":[]},{"name":"_0x_0x55d5c1","purpose":"HTTP request headers builder","calls":[]},{"name":"_0x_0xbf9ba1","purpose":"Generic async fetch wrapper","calls":["_0x_0x55d5c1"]},{"name":"_0x_0x598566","purpose":"Login - hashes password, POSTs credentials, saves token to localStorage","calls":["_0x_0x40c1ce","_0x_0xbf9ba1"]},{"name":"_0x_0x141588","purpose":"Get user profile - GETs profile using stored token","calls":["_0x_0xbf9ba1"]},{"name":"_0x_0x4f87af","purpose":"Update user profile - PUTs data using stored token","calls":["_0x_0xbf9ba1"]}],"apiEndpoints":[{"method":"POST","path":"/login","purpose":"authenticate user"},{"method":"GET","path":"/profile/:id","purpose":"fetch user profile"},{"method":"PUT","path":"/profile/:id","purpose":"update user profile"}],"securityIssues":[{"severity":"high","issue":"djb2 hash - non-cryptographic, trivial to reverse","location":"_0x_0x40c1ce"},{"severity":"high","issue":"Session token stored in localStorage without encryption","location":"_0x_0x598566"}],"dataFlow":["login: hash password → POST /login → store token → localStorage","profile: token from localStorage → GET /profile → log result"],"keyVariables":[{"name":"_0x_0x25eb6b","value":"https://api.example.com"},{"name":"_0x_0x18670f","value":"session_token"}],"entryPoint":"_0x_0x598566"}`),
    rawTokens: 24232,
    rawTime: 227909,
  }
};

// ── Score all scenarios ──

console.log("=".repeat(75));
console.log("deob Benchmark Scoring Report");
console.log("=".repeat(75));

for (const sc of scenarios) {
  if (!agentResults[sc]) continue;

  const gtFile = path.join(basePath, sc, "ground-truth.json");
  let gt = null;
  try { gt = JSON.parse(fs.readFileSync(gtFile, "utf-8")); } catch (e) { console.log(`  SKIP ${sc}: ground-truth.json error`); continue; }

  const deobAnswer = agentResults[sc].deob;
  const rawAnswer = agentResults[sc].raw;

  console.log(`\n## Scenario ${sc}: ${scenarioLabels[sc]}\n`);

  // Score deob agent
  const dFn = scoreFunctions(deobAnswer, gt);
  const dApi = scoreApiEndpoints(deobAnswer, gt);
  const dSec = scoreSecurity(deobAnswer, gt);
  const dFlow = scoreDataFlow(deobAnswer, gt);
  const dVars = scoreKeyVars(deobAnswer, gt);
  const dFnWeighted = dFn.score * 0.25 * 100;
  const dApiWeighted = dApi.score * 0.20 * 100;
  const dSecWeighted = dSec.score * 0.25 * 100;
  const dFlowWeighted = dFlow.score * 0.15 * 100;
  const dVarsWeighted = dVars.score * 0.15 * 100;

  // Score raw agent
  const rFn = scoreFunctions(rawAnswer, gt);
  const rApi = scoreApiEndpoints(rawAnswer, gt);
  const rSec = scoreSecurity(rawAnswer, gt);
  const rFlow = scoreDataFlow(rawAnswer, gt);
  const rVars = scoreKeyVars(rawAnswer, gt);
  const rFnWeighted = rFn.score * 0.25 * 100;
  const rApiWeighted = rApi.score * 0.20 * 100;
  const rSecWeighted = rSec.score * 0.25 * 100;
  const rFlowWeighted = rFlow.score * 0.15 * 100;
  const rVarsWeighted = rVars.score * 0.15 * 100;

  // Efficiency
  const dEff = scoreEfficiency(agentResults[sc].deobTokens, agentResults[sc].deobTime, { tokens: 30000, timeMs: 240000 });
  const rEff = scoreEfficiency(agentResults[sc].rawTokens, agentResults[sc].rawTime, { tokens: 30000, timeMs: 240000 });

  console.log("| Category | Weight | deob Score | raw Score | Improvement |");
  console.log("|----------|--------|-----------|----------|-------------|");
  console.log(`| Functions | 25% | ${(dFn.score * 100).toFixed(0)}% (${dFn.detail}) | ${(rFn.score * 100).toFixed(0)}% (${rFn.detail}) | ${(dFn.score / Math.max(0.01, rFn.score)).toFixed(1)}x |`);
  console.log(`| API Endpoints | 20% | ${(dApi.score * 100).toFixed(0)}% (${dApi.detail}) | ${(rApi.score * 100).toFixed(0)}% (${rApi.detail}) | ${(dApi.score / Math.max(0.01, rApi.score)).toFixed(1)}x |`);
  console.log(`| Security Issues | 25% | ${(dSec.score * 100).toFixed(0)}% (${dSec.detail}) | ${(rSec.score * 100).toFixed(0)}% (${rSec.detail}) | ${(dSec.score / Math.max(0.01, rSec.score)).toFixed(1)}x |`);
  console.log(`| Data Flow | 15% | ${(dFlow.score * 100).toFixed(0)}% | ${(rFlow.score * 100).toFixed(0)}% | ${(dFlow.score / Math.max(0.01, rFlow.score)).toFixed(1)}x |`);
  console.log(`| Key Variables | 15% | ${(dVars.score * 100).toFixed(0)}% (${dVars.detail}) | ${(rVars.score * 100).toFixed(0)}% (${rVars.detail}) | ${(dVars.score / Math.max(0.01, rVars.score)).toFixed(1)}x |`);

  const dTotal = dFnWeighted + dApiWeighted + dSecWeighted + dFlowWeighted + dVarsWeighted;
  const rTotal = rFnWeighted + rApiWeighted + rSecWeighted + rFlowWeighted + rVarsWeighted;

  console.log(`| **Total** | 100% | **${dTotal.toFixed(0)}** | **${rTotal.toFixed(0)}** | **${(dTotal / Math.max(1, rTotal)).toFixed(1)}x** |`);
  console.log("");
  console.log(`| Metric | deob | raw | Advantage |`);
  console.log(`|--------|------|-----|-----------|`);
  console.log(`| Tokens Used | ${agentResults[sc].deobTokens.toLocaleString()} | ${agentResults[sc].rawTokens.toLocaleString()} | ${agentResults[sc].deobTokens < agentResults[sc].rawTokens ? 'deob saves ' + ((1 - agentResults[sc].deobTokens / agentResults[sc].rawTokens) * 100).toFixed(0) + '%' : 'raw uses ' + ((1 - agentResults[sc].rawTokens / agentResults[sc].deobTokens) * 100).toFixed(0) + '% less'} |`);
  console.log(`| Duration (ms) | ${(agentResults[sc].deobTime/1000).toFixed(1)}s | ${(agentResults[sc].rawTime/1000).toFixed(1)}s | ${agentResults[sc].deobTime < agentResults[sc].rawTime ? 'deob ' + (agentResults[sc].rawTime/agentResults[sc].deobTime).toFixed(1) + 'x faster' : 'raw ' + (agentResults[sc].deobTime/agentResults[sc].rawTime).toFixed(1) + 'x faster'} |`);
  console.log(`| Value per token | ${(dTotal / agentResults[sc].deobTokens * 100000).toFixed(1)} | ${(rTotal / agentResults[sc].rawTokens * 100000).toFixed(1)} | ${dTotal / agentResults[sc].deobTokens > rTotal / agentResults[sc].rawTokens ? 'deob more efficient' : 'raw more efficient'} |`);
}

console.log("\n" + "=".repeat(75));
