// Benchmark scoring script — compare agent answers to ground truth
const fs = require("fs");
const path = require("path");

function loadAnswer(filepath) {
  const raw = fs.readFileSync(filepath, "utf-8");
  return JSON.parse(raw);
}

function scorePurpose(answer, truth) {
  const ap = (answer.purpose || "").toLowerCase();
  const tp = (truth.description || "").toLowerCase();
  const tpWords = new Set(tp.split(/\W+/).filter(w => w.length > 3));
  const apWords = new Set(ap.split(/\W+/).filter(w => w.length > 3));
  if (tpWords.size === 0) return 0;
  const intersection = new Set([...tpWords].filter(w => apWords.has(w)));
  return intersection.size / tpWords.size;
}

function scoreFunctions(answer, truth) {
  let matched = 0;
  for (const tf of truth.functions) {
    const found = answer.functions.find(f => {
      const ap = (f.purpose || "").toLowerCase();
      const tp = (tf.purpose || "").toLowerCase();
      return (ap.length > 5 && tp.length > 5) && (ap.includes(tp.substring(0, 10)) || tp.includes(ap.substring(0, 10)));
    });
    if (found) matched++;
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
    const found = answer.security.find(s => {
      const ai = (s.issue || "").toLowerCase();
      const ti = (ts.issue || "").toLowerCase();
      return ti.length > 5 && (ai.includes(ti.substring(0, 15)) || ti.includes(ai.substring(0, 15)));
    });
    if (found) matched++;
  }
  return matched / truth.securityIssues.length;
}

function scoreDataFlow(answer, truth) {
  const af = (answer.dataFlow || "").toLowerCase();
  const tf = (truth.dataFlow || []).join(" ").toLowerCase();
  const tWords = new Set(tf.split(/\W+/).filter(w => w.length > 2));
  const aWords = new Set(af.split(/\W+/).filter(w => w.length > 2));
  if (tWords.size === 0) return 0;
  const intersection = new Set([...tWords].filter(w => aWords.has(w)));
  return intersection.size / tWords.size;
}

function scoreVariables(answer, truth) {
  const tvars = Object.entries(truth.keyVariables);
  if (tvars.length === 0) return 1;
  let matched = 0;
  for (const [name, value] of tvars) {
    const found = answer.variables.find(v => {
      const vv = (v.value || v.name || "").toLowerCase();
      const tv = value.toLowerCase();
      return vv.includes(tv.split(" ")[0]) || tv.includes(vv.split(" ")[0]);
    });
    if (found) matched++;
  }
  return matched / tvars.length;
}

function scoreEntry(answer, truth) {
  return answer.entryPoint && answer.entryPoint.length > 3 ? 1 : 0;
}

function computeScores(answer, truth) {
  const scores = {
    purpose: scorePurpose(answer, truth),
    functions: scoreFunctions(answer, truth),
    endpoints: scoreEndpoints(answer, truth),
    security: scoreSecurity(answer, truth),
    dataFlow: scoreDataFlow(answer, truth),
    variables: scoreVariables(answer, truth),
    entry: scoreEntry(answer, truth),
  };
  scores.total =
    scores.purpose * 0.10 + scores.functions * 0.30 + scores.endpoints * 0.15 +
    scores.security * 0.20 + scores.dataFlow * 0.10 + scores.variables * 0.10 +
    scores.entry * 0.05;
  return scores;
}

// Run scoring for a scenario
function scoreScenario(scenario, expDir) {
  const basePath = path.join(expDir, "scenarios", scenario);
  const gtPath = path.join(basePath, "ground-truth.json");
  const resultsDir = path.join(expDir, "results");
  const deobPath = path.join(resultsDir, `scenario_${scenario}_deob.json`);
  const rawPath = path.join(resultsDir, `scenario_${scenario}_raw.json`);

  if (!fs.existsSync(deobPath) || !fs.existsSync(rawPath)) return null;
  const gt = JSON.parse(fs.readFileSync(gtPath, "utf-8"));
  const deobAnswer = loadAnswer(deobPath);
  const rawAnswer = loadAnswer(rawPath);

  return {
    scenario,
    deob: computeScores(deobAnswer, gt),
    raw: computeScores(rawAnswer, gt),
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
console.log("| Scenario | Agent | Purpose | Functions | Endpoints | Security | DataFlow | Vars | Entry | Total |");
console.log("|----------|-------|---------|-----------|-----------|----------|----------|------|-------|-------|");

for (const sc of scenarios) {
  const result = scoreScenario(sc, expDir);
  if (!result) { console.log(`| ${sc} | — | no data | | | | | | | |`); continue; }

  const d = result.deob, r = result.raw;
  console.log(`| ${sc} | deob | ${d.purpose.toFixed(2)} | ${d.functions.toFixed(2)} | ${d.endpoints.toFixed(2)} | ${d.security.toFixed(2)} | ${d.dataFlow.toFixed(2)} | ${d.variables.toFixed(2)} | ${d.entry.toFixed(2)} | ${d.total.toFixed(2)} |`);
  console.log(`| ${sc} | raw  | ${r.purpose.toFixed(2)} | ${r.functions.toFixed(2)} | ${r.endpoints.toFixed(2)} | ${r.security.toFixed(2)} | ${r.dataFlow.toFixed(2)} | ${r.variables.toFixed(2)} | ${r.entry.toFixed(2)} | ${r.total.toFixed(2)} |`);
  const imp = r.total > 0 ? (d.total / r.total).toFixed(1) + "x" : "inf";
  console.log(`| ${sc} | imprv | ${(d.purpose/r.purpose||0).toFixed(1)}x | ${(d.functions/r.functions||0).toFixed(1)}x | ${(d.endpoints/r.endpoints||0).toFixed(1)}x | ${(d.security/r.security||0).toFixed(1)}x | ${(d.dataFlow/r.dataFlow||0).toFixed(1)}x | ${(d.variables/r.variables||0).toFixed(1)}x | — | **${imp}** |`);
}

console.log("\n---");
console.log("Weights: purpose=10%, functions=30%, endpoints=15%, security=20%, dataFlow=10%, vars=10%, entry=5%");
