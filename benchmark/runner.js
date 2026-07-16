// Benchmark runner: compare LLM analysis with vs without deob
// Phase 1: Run deob → Phase 2: Spawn 2 agents → Phase 3: Score against ground truth

const fs = require("fs");
const path = require("path");

const scenarios = ["A", "B", "C", "D", "E"];
const scenarioLabels = {
  A: "API Client", B: "Auth Flow", C: "Data Pipeline",
  D: "Webpack Bundle", E: "Payment Processing"
};
const scenarioDiffs = { A: "easy", B: "medium", C: "medium", D: "hard", E: "hard" };

const basePath = path.join(__dirname, "scenarios");
const resultsDir = path.join(__dirname, "results");
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

// ── Analysis Questions (same for both agents) ──

const QUESTIONS = {
  description: "What is the primary function of this code? (1 sentence)",
  functions: "List all functions with their purpose and what they call",
  apiEndpoints: "List all API endpoints (method, path, purpose)",
  securityIssues: "List all security issues (severity, issue, location)",
  dataFlow: "Describe the data flow from input to output",
  keyVariables: "List key variables/constants and their values",
  entryPoint: "What is the entry point of this code?",
};

// ── Scoring functions ──

function jaccard(a, b) {
  const sa = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const sb = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const intersection = new Set([...sa].filter(x => sb.has(x)));
  const union = new Set([...sa, ...sb]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function scoreFunctions(answer, gt) {
  if (!gt || !gt.functions || gt.functions.length === 0) return { score: 1, detail: "N/A" };
  const answerText = answer.functions || JSON.stringify(answer);
  let matched = 0;
  for (const fn of gt.functions) {
    // Check if function purpose is mentioned in answer
    const keywords = fn.purpose.split(/\W+/).filter(w => w.length > 3).slice(0, 3).join(" ");
    if (answerText.toLowerCase().includes(keywords.toLowerCase())) matched++;
    else if (fn.security && fn.security.length > 0) {
      // Check security-related keywords
      const secKw = fn.security[0].split(/\W+/).filter(w => w.length > 3).slice(0, 2).join(" ");
      if (answerText.toLowerCase().includes(secKw.toLowerCase())) matched++;
    }
  }
  const recall = matched / gt.functions.length;
  const precision = Math.min(1, matched / Math.max(1, (answerText.match(/function[:\s]/g) || []).length));
  const f1 = recall + precision === 0 ? 0 : 2 * recall * precision / (recall + precision);
  return { score: f1, detail: `${matched}/${gt.functions.length}` };
}

function scoreApiEndpoints(answer, gt) {
  if (!gt || !gt.apiEndpoints || gt.apiEndpoints.length === 0) return { score: 1, detail: "N/A" };
  const answerText = answer.apiEndpoints || JSON.stringify(answer);
  let matched = 0;
  for (const ep of gt.apiEndpoints) {
    const pathParts = ep.path.split("/").filter(Boolean);
    const allFound = pathParts.every(p => answerText.includes(p));
    if (allFound) matched++;
  }
  return { score: matched / gt.apiEndpoints.length, detail: `${matched}/${gt.apiEndpoints.length}` };
}

function scoreSecurityIssues(answer, gt) {
  if (!gt || !gt.securityIssues || gt.securityIssues.length === 0) return { score: 1, detail: "N/A" };
  const answerText = answer.securityIssues || JSON.stringify(answer);
  let matched = 0;
  for (const si of gt.securityIssues) {
    const keywords = si.issue.split(/\W+/).filter(w => w.length > 3).slice(0, 3).join(" ");
    if (answerText.toLowerCase().includes(keywords.toLowerCase())) matched++;
  }
  return { score: matched / gt.securityIssues.length, detail: `${matched}/${gt.securityIssues.length}` };
}

function scoreDataFlow(answer, gt) {
  if (!gt || !gt.dataFlow || gt.dataFlow.length === 0) return { score: 1, detail: "N/A" };
  const answerText = answer.dataFlow || JSON.stringify(answer);
  let totalSim = 0;
  for (const flow of gt.dataFlow) {
    totalSim += jaccard(flow, answerText);
  }
  return { score: totalSim / gt.dataFlow.length, detail: "" };
}

function scoreKeyVariables(answer, gt) {
  if (!gt || !gt.keyVariables || Object.keys(gt.keyVariables).length === 0) return { score: 1, detail: "N/A" };
  const answerText = answer.keyVariables || JSON.stringify(answer);
  const entries = Object.entries(gt.keyVariables);
  let matched = 0;
  for (const [name, value] of entries) {
    if (answerText.includes(name) || answerText.includes(value)) matched++;
  }
  return { score: matched / entries.length, detail: `${matched}/${entries.length}` };
}

// ── Generate agent prompts ──

function generateDeobAgentPrompt(scenario, outputDir) {
  return `You are a JavaScript reverse engineer. Analyze deobfuscated code from the file system.

The original obfuscated JS has been preprocessed by deob. Read the following files in order:

1. Read: ${outputDir}/0-prompt.md  (architecture overview, alerts, top functions)
2. Read: ${outputDir}/2-index.txt  (function catalog with call info, closures, shared vars)
3. Read: ${outputDir}/1-structure.md  (call graph, alert traces, hotspots)
4. Read: ${outputDir}/main.js  (deobfuscated code — focus on functions with banner comments)

Answer these questions in JSON format:
{
  "description": "One sentence describing the primary function of this code",
  "functions": "List each function with its name, purpose, and what functions it calls",
  "apiEndpoints": "List each API endpoint: method, path, purpose",
  "securityIssues": "List each security issue: severity (critical/high/medium/low), issue description, location",
  "dataFlow": "Describe the data flow from input to output as steps",
  "keyVariables": "List important variables/constants and their values",
  "entryPoint": "Name of the entry point function"
}

Return ONLY the JSON object, no other text.`;
}

function generateRawAgentPrompt(scenario, obfuscatedFile) {
  return `You are a JavaScript reverse engineer. Analyze obfuscated JavaScript code.

The code is obfuscated with: variable renaming, string encoding, control flow flattening,
dead code injection, and self-defending techniques.

Read the obfuscated file: ${obfuscatedFile}

First, try to understand the structure:
- Find the string decoding function (look for a function called early that returns array elements)
- Identify entry points (look for immediate function calls at the end)
- Trace the control flow by following function calls

Answer these questions in JSON format:
{
  "description": "One sentence describing the primary function of this code",
  "functions": "List each function with its name (if you can identify it), purpose, and what functions it calls",
  "apiEndpoints": "List each API endpoint: method, path, purpose",
  "securityIssues": "List each security issue: severity (critical/high/medium/low), issue description, location",
  "dataFlow": "Describe the data flow from input to output as steps",
  "keyVariables": "List important variables/constants and their values",
  "entryPoint": "Name of the entry point function (if identifiable)"
}

Return ONLY the JSON object, no other text.`;
}

// ── Phase 1: Run deob on all scenarios ──

console.log("=".repeat(60));
console.log("Phase 1: Running deob on all scenarios\n");

const deobStats = {};

for (const sc of scenarios) {
  const inputFile = path.join(basePath, sc, "obfuscated.js");
  const outputDir = path.join(resultsDir, `scenario_${sc}_deob`);

  console.log(`Running deob on scenario ${sc}...`);

  try {
    const main = require("../scripts/pipeline").main;
    main({ input: inputFile, output: outputDir });

    const { runStructure, generateIndex, generatePromptFile, clearAnalysisCache } = require("../scripts/structure");
    if (clearAnalysisCache) clearAnalysisCache();
    runStructure(inputFile, outputDir, { brief: false, denoise: [] });
    generatePromptFile(outputDir);
    generateIndex(outputDir, { denoise: [] });

    const mainFile = path.join(outputDir, "main.js");
    const mainSize = fs.existsSync(mainFile) ? fs.statSync(mainFile).size : 0;
    const obfuscatedSize = fs.statSync(inputFile).size;

    deobStats[sc] = {
      obfuscatedSize: (obfuscatedSize / 1024).toFixed(1),
      deobSize: (mainSize / 1024).toFixed(1),
      ratio: ((mainSize / obfuscatedSize) * 100).toFixed(0)
    };
    console.log(`  OK: ${deobStats[sc].deobSize} KB (${deobStats[sc].ratio}%)`);
  } catch (e) {
    console.log(`  ERROR: ${e.message.split("\n")[0]}`);
    deobStats[sc] = { error: e.message };
  }
}

// ── Phase 2: Generate agent prompts for each scenario ──

console.log("\n" + "=".repeat(60));
console.log("Phase 2: Generating agent prompts\n");

const agentPrompts = {};

for (const sc of scenarios) {
  const inputFile = path.join(basePath, sc, "obfuscated.js");
  const outputDir = path.join(resultsDir, `scenario_${sc}_deob`);

  const deobPrompt = generateDeobAgentPrompt(sc, outputDir);
  const rawPrompt = generateRawAgentPrompt(sc, inputFile);

  agentPrompts[sc] = { deob: deobPrompt, raw: rawPrompt };

  // Write prompts to files for agents to read
  fs.writeFileSync(path.join(resultsDir, `scenario_${sc}_deob_agent_prompt.txt`), deobPrompt, "utf-8");
  fs.writeFileSync(path.join(resultsDir, `scenario_${sc}_raw_agent_prompt.txt`), rawPrompt, "utf-8");

  console.log(`  ${sc}: deob prompt = ${deobPrompt.length} chars, raw prompt = ${rawPrompt.length} chars`);
}

// ── Phase 3: Generate scoring summary ──

console.log("\n" + "=".repeat(60));
console.log("Phase 3: Generate report\n");

// Collect deob output quality metrics
const deobQuality = {};

for (const sc of scenarios) {
  const outputDir = path.join(resultsDir, `scenario_${sc}_deob`);
  const mainFile = path.join(outputDir, "main.js");
  const promptFile = path.join(outputDir, "0-prompt.md");
  const indexFile = path.join(outputDir, "2-index.txt");

  if (!fs.existsSync(mainFile)) continue;

  const mainJs = fs.readFileSync(mainFile, "utf-8");
  const prompt = fs.existsSync(promptFile) ? fs.readFileSync(promptFile, "utf-8") : "";
  const index = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, "utf-8") : "";

  deobQuality[sc] = {
    mainLines: mainJs.split("\n").length,
    subFunctions: (mainJs.match(/function\s+_S_/g) || []).length,
    banners: (mainJs.match(/^\/\/ _S_.+cc=/gm) || []).length,
    alerts: (prompt.match(/## Alerts \((\d+) significant\)/) || [])[1] || "0",
    sharedVars: (index.split("## shared\n")[1] || "").split("\n## ")[0].split("\n").filter(l => l.startsWith("_")).length,
    domain: (prompt.match(/Domain: \*\*(.+?)\*\*/) || [])[1] || "N/A",
    entryPoint: (prompt.match(/Entry point.*?\`(.+?)\`/) || [])[1] || "N/A",
    closureCount: (prompt.match(/Closure captures: (\d+)/) || [])[1] || "0",
  };
}

// ── Phase 4: Write scoring template for manual/automated scoring ──

const report = [];
report.push("# deob Benchmark Report");
report.push("");
report.push("## How to Run the Agents");
report.push("");
report.push("For each scenario, spawn TWO agents with the same analysis goals:");
report.push("");
report.push("**Agent A (deob):** Read the deob\_agent\_prompt.txt from the results directory.");
report.push("**Agent B (raw):** Read the raw\_agent\_prompt.txt from the results directory.");
report.push("");
report.push("Both agents should output a JSON object. Compare against ground-truth.json in each scenario folder.");
report.push("");
report.push("## Obfuscation Levels");
report.push("");
report.push("| Scenario | Description | Obfuscated Size | Deob Size | Ratio |");
report.push("|----------|-------------|-----------------|-----------|-------|");
for (const sc of scenarios) {
  const stats = deobStats[sc] || {};
  if (stats.error) report.push(`| ${sc} | ${scenarioLabels[sc]} | ERROR | - | - |`);
  else report.push(`| ${sc} | ${scenarioLabels[sc]} | ${stats.obfuscatedSize} KB | ${stats.deobSize} KB | ${stats.ratio}% |`);
}

report.push("");
report.push("## Scoring Rubric");
report.push("");
report.push("| Category | Weight | Method |");
report.push("|----------|--------|--------|");
report.push("| Functions identified | 25% | Keyword match between answer and GT purpose |");
report.push("| API endpoints | 20% | Path component match |");
report.push("| Security issues | 25% | Keyword match between answer and GT issues |");
report.push("| Data flow | 15% | Jaccard similarity on keywords |");
report.push("| Key variables | 15% | Name/value match |");

report.push("");
report.push("## Scoring Template");
report.push("");
report.push("Copy this table and fill in scores after running agents:");
report.push("");
report.push("| Scenario | Agent | Functions (/25) | API (/20) | Security (/25) | DataFlow (/15) | Vars (/15) | **Total** | Time |");
report.push("|----------|-------|----------------|-----------|----------------|---------------|-----------|----------|------|");
for (const sc of scenarios) {
  const gtFile = path.join(basePath, sc, "ground-truth.json");
  let gt = null;
  try { gt = JSON.parse(fs.readFileSync(gtFile, "utf-8")); } catch (e) {}
  const gtFns = gt ? gt.functions.length : "?";
  const gtEp = gt ? (gt.apiEndpoints || []).length : "?";
  const gtSec = gt ? (gt.securityIssues || []).length : "?";
  report.push(`| ${sc} | **deob** | /25 (${gtFns} GT) | /20 (${gtEp} GT) | /25 (${gtSec} GT) | /15 | /15 |   /100 | s |`);
  report.push(`| ${sc} | **raw** | /25 | /20 | /25 | /15 | /15 |   /100 | s |`);
}

const reportPath = path.join(resultsDir, "benchmark-report.md");
fs.writeFileSync(reportPath, report.join("\n"), "utf-8");
console.log("Report written to: " + reportPath);

// ── Print summary for user ──
console.log("\n" + "=".repeat(60));
console.log("Summary: Agent Prompts Ready\n");
console.log("To run the benchmark:");
console.log("1. Read the prompt files in benchmark/results/");
console.log("2. For each scenario, spawn Agent A (deob) and Agent B (raw)");
console.log("3. Collect their JSON responses");
console.log("4. Compare against ground-truth.json in each scenario folder");
console.log("5. Fill in the scoring template in benchmark-report.md");
console.log("\nPrompt files generated:");
console.log("  benchmark/results/scenario_*_deob_agent_prompt.txt");
console.log("  benchmark/results/scenario_*_raw_agent_prompt.txt");
