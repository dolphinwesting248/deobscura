// Benchmark runner: compare LLM analysis with vs without deob
// Runs deob on each obfuscated scenario, then evaluates analysis quality

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const scenarios = ["A", "B", "C", "D", "E"];
const scenarioLabels = {
  A: "API Client", B: "Auth Flow", C: "Data Pipeline",
  D: "Webpack Bundle", E: "Payment Processing"
};
const scenarioDiffs = { A: "easy", B: "medium", C: "medium", D: "hard", E: "hard" };

const basePath = path.join(__dirname, "scenarios");
const resultsDir = path.join(__dirname, "results");
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

// — Phase 1: Run deob on all scenarios —

console.log("=".repeat(60));
console.log("Phase 1: Running deob on all scenarios\n");

const deobStats = {};

for (const sc of scenarios) {
  const inputFile = path.join(basePath, sc, "obfuscated.js");
  const outputDir = path.join(resultsDir, `scenario_${sc}_deob`);

  if (!fs.existsSync(inputFile)) {
    console.log(`  SKIP ${sc}: obfuscated.js not found`);
    continue;
  }

  console.log(`Running deob on scenario ${sc} (${scenarioLabels[sc]})...`);

  try {
    const main = require("../scripts/pipeline").main;
    const report = main({ input: inputFile, output: outputDir });

    // Generate analysis files
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

    console.log(`  Output: ${deobStats[sc].deobSize} KB (${deobStats[sc].ratio}% of ${deobStats[sc].obfuscatedSize} KB obfuscated)`);
  } catch (e) {
    console.log(`  ERROR: ${e.message.split("\n")[0]}`);
    deobStats[sc] = { error: e.message };
  }
}

// — Phase 2: Evaluate deob output quality —

console.log("\n" + "=".repeat(60));
console.log("Phase 2: Evaluating deob output quality\n");

function countFunctions(mainJs) {
  return (mainJs.match(/function\s+_S_/g) || []).length;
}

function countBanners(mainJs) {
  return (mainJs.match(/^\/\/ _S_.+cc=/gm) || []).length;
}

function countAlerts(prompt) {
  const match = prompt.match(/## Alerts \((\d+) significant\)/);
  return match ? parseInt(match[1]) : 0;
}

function countShared(index) {
  const section = index.split("## shared\n")[1] || "";
  return section.split("\n## ")[0].split("\n").filter(l => l.startsWith("_")).length;
}

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
    subFunctions: countFunctions(mainJs),
    banners: countBanners(mainJs),
    alerts: countAlerts(prompt),
    sharedVars: countShared(index),
    hasLegend: index.includes("## Sections") || index.includes("See ../summary.md"),
    domain: (prompt.match(/Domain: \*\*(.+?)\*\*/) || [])[1] || "N/A",
    entryPoint: (prompt.match(/Entry point.*?`(.+?)`/) || [])[1] || "N/A"
  };

  console.log(`${sc}: ${deobQuality[sc].subFunctions} sub-functions, ${deobQuality[sc].banners} banners, ${deobQuality[sc].alerts} alerts, ${deobQuality[sc].sharedVars} shared vars`);
  console.log(`    Domain: ${deobQuality[sc].domain}, Entry: ${deobQuality[sc].entryPoint}`);
}

// — Phase 3: Cross-reference with ground truth —

console.log("\n" + "=".repeat(60));
console.log("Phase 3: Ground truth validation\n");

const formatHeader = "| Scenario | Functions | Banners | Alerts | Shared | Domain |";
const formatSep = "|----------|-----------|---------|--------|--------|--------|";

console.log(formatHeader);
console.log(formatSep);

for (const sc of scenarios) {
  const gtFile = path.join(basePath, sc, "ground-truth.json");
  const quality = deobQuality[sc] || {};
  let gt = { functions: [], securityIssues: [], apiEndpoints: [], keyVariables: {} };

  if (fs.existsSync(gtFile)) {
    try { gt = JSON.parse(fs.readFileSync(gtFile, "utf-8")); } catch (e) {}
  }

  const fnCount = gt.functions ? gt.functions.length : 0;
  const alerts = quality.alerts || 0;
  const shared = quality.sharedVars || 0;
  const domain = quality.domain || "N/A";

  console.log(`| ${sc} (${scenarioDiffs[sc]}) | ${quality.subFunctions || 0}/${fnCount} | ${quality.banners || 0} | ${alerts} | ${shared} | ${domain} |`);
}

// — Phase 4: Generate summary report —

const report = [];
report.push("# deob Benchmark Report");
report.push("");
report.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
report.push("");
report.push("## Obfuscation Levels");
report.push("");
report.push("| Scenario | Description | Obfuscation Techniques | Obfuscated Size | Deob Size | Ratio |");
report.push("|----------|-------------|----------------------|-----------------|-----------|-------|");

for (const sc of scenarios) {
  const label = scenarioLabels[sc];
  const stats = deobStats[sc] || {};
  const techniques = {
    A: "renameGlobals, stringArray (base64), rotateStringArray",
    B: "controlFlowFlattening (75%), deadCode (30%), stringArray (rc4), selfDefending, numbersToExpressions, splitStrings",
    C: "controlFlowFlattening (50%), deadCode (20%), stringArray (base64), debugProtection, splitStrings, transformObjectKeys, numbersToExpressions",
    D: "ALL at 100%: stringArray (rc4), selfDefending, deadCode, controlFlowFlattening, debugProtection, numbersToExpressions, splitStrings, transformObjectKeys, unicodeEscape  (webpack bundle)",
    E: "ALL at MAX: renameProperties, stringArray (rc4), selfDefending, deadCode (40%), controlFlowFlattening (75%), debugProtection, numbersToExpressions, splitStrings (3 char), transformObjectKeys, unicodeEscape, disableConsoleOutput"
  };

  if (stats.error) {
    report.push(`| ${sc} (${label}) | ${scenarioDiffs[sc]} | ERROR: ${stats.error.split("\n")[0]} |`);
  } else {
    report.push(`| ${sc} (${label}) | ${scenarioDiffs[sc]} | ${techniques[sc]} | ${stats.obfuscatedSize} KB | ${stats.deobSize} KB | ${stats.ratio}% |`);
  }
}

report.push("");
report.push("## Deob Output Quality");
report.push("");
report.push("| Scenario | Main.js Lines | Sub-Fns | Banners | Alerts | Shared Vars | Domain | Entry |");
report.push("|----------|--------------|---------|---------|--------|-------------|--------|-------|");

for (const sc of scenarios) {
  const q = deobQuality[sc] || {};
  report.push(`| ${sc} | ${q.mainLines || "N/A"} | ${q.subFunctions || 0} | ${q.banners || 0} | ${q.alerts || 0} | ${q.sharedVars || 0} | ${q.domain || "N/A"} | ${q.entryPoint || "N/A"} |`);
}

report.push("");
report.push("## Ground Truth Comparison");
report.push("");
report.push("| Scenario | Difficulty | GT Functions | Deob Functions | Match Rate | Domain Accuracy |");
report.push("|----------|-----------|--------------|----------------|------------|-----------------|");

for (const sc of scenarios) {
  const gtFile = path.join(basePath, sc, "ground-truth.json");
  let gtFnCount = 0;
  let gtDomain = "";
  if (fs.existsSync(gtFile)) {
    try {
      const gt = JSON.parse(fs.readFileSync(gtFile, "utf-8"));
      gtFnCount = (gt.functions || []).length;
      gtDomain = gt.description || "";
    } catch (e) {}
  }

  const q = deobQuality[sc] || {};
  const matchRate = gtFnCount > 0 ? ((q.subFunctions || 0) / gtFnCount * 100).toFixed(0) + "%" : "N/A";

  report.push(`| ${sc} | ${scenarioDiffs[sc]} | ${gtFnCount} | ${q.subFunctions || 0} | ${matchRate} | ${q.domain || "N/A"} |`);
}

const reportPath = path.join(resultsDir, "benchmark-report.md");
fs.writeFileSync(reportPath, report.join("\n"), "utf-8");
console.log("\n\nReport written to: " + reportPath);
