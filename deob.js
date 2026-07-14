#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const { main } = require("./scripts/pipeline");
const { runMetrics } = require("./scripts/metrics");
const { runStructure, generateCrossSummary } = require("./scripts/structure");
const { indexDirectory } = require("./scripts/indexer");

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const splitFlag = flags.has("--split");
const metricsFlag = flags.has("--metrics");
const mdFlag = flags.has("--md");
const jsonFlag = flags.has("--json");
const indexFlag = flags.has("--index");
const filtered = args.filter((a) => !a.startsWith("--"));
const inputPath = filtered[0];

if (!inputPath || flags.has("--help") || flags.has("-h")) {
  console.log("deob — universal JS deobfuscation pipeline\n");
  console.log("Usage: deob <input> [output-dir] [options]\n");
  console.log("  --split      split output into per-function files");
  console.log("  --metrics    generate HTML readability metrics report");
  console.log("  --md         generate Markdown structure report");
  console.log("  --json       generate JSON structure report");
  console.log("  --index      build code index for AI-assisted exploration\n");
  console.log("Examples:");
  console.log("  deob main.js                    → main.deob/");
  console.log("  deob main.js --split            → main.deob/ (per-function files)");
  console.log("  deob src/ --md --json           → src.deob/ (cross-file summary)");
  process.exit(0);
}

// ── helpers ──────────────────────────────────────────────────────────

function collectJsFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isFile() && e.name.endsWith(".js") && !e.name.startsWith(".")) {
      results.push(path.join(dir, e.name));
    }
  }
  return results;
}

function processFile(file, outDir) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Input:  ${file}`);
  console.log(`Output: ${outDir}/`);
  if (splitFlag) console.log("        (split mode)");
  console.log("");

  main({ input: file, output: outDir, split: splitFlag });

  const reports = [];
  if (metricsFlag) runMetrics(file, outDir);
  if (mdFlag) reports.push(runStructure(file, outDir, "md"));
  if (jsonFlag) reports.push(runStructure(file, outDir, "json"));
  return reports;
}

// ── main ─────────────────────────────────────────────────────────────

const isDir = fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory();
const defaultOut = isDir
  ? inputPath.replace(/[\\/]$/, "") + ".deob"
  : inputPath.replace(/\.js$/i, ".deob");
const outputDir = filtered[1] || defaultOut;

if (!isDir) {
  // Single file mode
  console.log(`Input:  ${inputPath}`);
  console.log(`Output: ${outputDir}/`);
  if (splitFlag) console.log("        (split mode)");
  if (metricsFlag) console.log("        + metrics report");
  if (mdFlag) console.log("        + structure report (.md)");
  if (jsonFlag) console.log("        + structure report (.json)");
  if (indexFlag) console.log("        + code index");
  console.log("");

  main({ input: inputPath, output: outputDir, split: splitFlag });

  if (metricsFlag) runMetrics(inputPath, outputDir);
  if (mdFlag) runStructure(inputPath, outputDir, "md");
  if (jsonFlag) runStructure(inputPath, outputDir, "json");

  if (indexFlag) {
    console.log("Indexing output directory...");
    const stats = indexDirectory(outputDir);
    if (stats) {
      console.log(`  ${stats.nodes} nodes, ${stats.edges} edges across ${stats.files} files (${stats.durationMs}ms)`);
    }
  }
} else {
  // Directory mode: process each .js file independently
  const files = collectJsFiles(inputPath);
  if (files.length === 0) {
    console.log("No .js files found in directory");
    process.exit(0);
  }

  console.log(`Input:  ${inputPath}/ (${files.length} files)`);
  console.log(`Output: ${outputDir}/`);
  if (splitFlag) console.log("        (split mode)");
  if (metricsFlag) console.log("        + metrics report");
  if (mdFlag) console.log("        + structure report (.md)");
  if (jsonFlag) console.log("        + structure report (.json)");
  if (indexFlag) console.log("        + code index");

  const allReports = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = path.basename(file, ".js");
    const fileOutDir = path.join(outputDir, name);
    const reports = processFile(file, fileOutDir);
    // Collect JSON report for cross-file summary
    const jsonReport = reports.find((r) => r && r.summary);
    if (jsonReport) allReports.push({ file: name, report: jsonReport });
  }

  // Cross-file summary
  if ((mdFlag || jsonFlag) && allReports.length > 0) {
    console.log(`\nGenerating cross-file summary...`);
    if (mdFlag) {
      const summary = generateCrossSummary(allReports, path.basename(outputDir), "md");
      fs.writeFileSync(path.join(outputDir, "summary.md"), summary, "utf-8");
      console.log(`  Summary report: ${path.join(outputDir, "summary.md")}`);
    }
    if (jsonFlag) {
      const summary = generateCrossSummary(allReports, path.basename(outputDir), "json");
      fs.writeFileSync(path.join(outputDir, "summary.json"), summary, "utf-8");
      console.log(`  Summary report: ${path.join(outputDir, "summary.json")}`);
    }
  }

  // Build combined code index
  if (indexFlag) {
    console.log("\nIndexing output directory...");
    const stats = indexDirectory(outputDir);
    if (stats) {
      console.log(`  ${stats.nodes} nodes, ${stats.edges} edges across ${stats.files} files (${stats.durationMs}ms)`);
    }
  }
}
