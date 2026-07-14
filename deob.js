#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const { main } = require("./scripts/pipeline");
const { runMetrics } = require("./scripts/metrics");
const { runStructure, generateCrossSummary } = require("./scripts/structure");
const { indexDirectory } = require("./scripts/indexer");

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

function processOneFile(file, outDir, opts) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Input:  ${file}`);
  console.log(`Output: ${outDir}/`);
  if (opts.split) console.log("        (split mode)");
  console.log("");

  main({ input: file, output: outDir, split: opts.split });

  const reports = [];
  if (opts.metrics) runMetrics(file, outDir);
  if (opts.md) reports.push(runStructure(file, outDir, "md"));
  if (opts.json) reports.push(runStructure(file, outDir, "json"));
  return reports;
}

function processDirectory(inputDir, outputDir, opts) {
  const files = collectJsFiles(inputDir);
  if (files.length === 0) {
    console.log("No .js files found in directory");
    return;
  }

  console.log(`Input:  ${inputDir}/ (${files.length} files)`);
  console.log(`Output: ${outputDir}/`);
  if (opts.split) console.log("        (split mode)");
  if (opts.metrics) console.log("        + metrics report");
  if (opts.md) console.log("        + structure report (.md)");
  if (opts.json) console.log("        + structure report (.json)");
  if (opts.index) console.log("        + code index");

  const allReports = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = path.basename(file, ".js");
    const fileOutDir = path.join(outputDir, name);
    const reports = processOneFile(file, fileOutDir, opts);
    const jsonReport = reports.find((r) => r && r.summary);
    if (jsonReport) allReports.push({ file: name, report: jsonReport });
  }

  // Cross-file summary
  if ((opts.md || opts.json) && allReports.length > 0) {
    console.log(`\nGenerating cross-file summary...`);
    if (opts.md) {
      const summary = generateCrossSummary(allReports, path.basename(outputDir), "md");
      fs.writeFileSync(path.join(outputDir, "summary.md"), summary, "utf-8");
      console.log(`  Summary report: ${path.join(outputDir, "summary.md")}`);
    }
    if (opts.json) {
      const summary = generateCrossSummary(allReports, path.basename(outputDir), "json");
      fs.writeFileSync(path.join(outputDir, "summary.json"), summary, "utf-8");
      console.log(`  Summary report: ${path.join(outputDir, "summary.json")}`);
    }
  }

  // Build combined code index
  if (opts.index) {
    console.log("\nIndexing output directory...");
    const stats = indexDirectory(outputDir);
    if (stats) {
      console.log(`  ${stats.nodes} nodes, ${stats.edges} edges across ${stats.files} files (${stats.durationMs}ms)`);
    }
  }
}

function processSingleFile(inputPath, outputDir, opts) {
  console.log(`Input:  ${inputPath}`);
  console.log(`Output: ${outputDir}/`);
  if (opts.split) console.log("        (split mode)");
  if (opts.metrics) console.log("        + metrics report");
  if (opts.md) console.log("        + structure report (.md)");
  if (opts.json) console.log("        + structure report (.json)");
  if (opts.index) console.log("        + code index");
  console.log("");

  main({ input: inputPath, output: outputDir, split: opts.split });

  if (opts.metrics) runMetrics(inputPath, outputDir);
  if (opts.md) runStructure(inputPath, outputDir, "md");
  if (opts.json) runStructure(inputPath, outputDir, "json");

  if (opts.index) {
    console.log("Indexing output directory...");
    const stats = indexDirectory(outputDir);
    if (stats) {
      console.log(`  ${stats.nodes} nodes, ${stats.edges} edges across ${stats.files} files (${stats.durationMs}ms)`);
    }
  }
}

function defaultOutDir(inputPath) {
  const isDir = fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory();
  return isDir
    ? inputPath.replace(/[\\/]$/, "") + ".deob"
    : inputPath.replace(/\.js$/i, ".deob");
}

function parseConfig(filepath) {
  const absPath = path.resolve(filepath);
  if (!fs.existsSync(absPath)) {
    console.error(`Config file not found: ${absPath}`);
    process.exit(1);
  }
  let cfg;
  try {
    cfg = require(absPath);
  } catch (e) {
    console.error(`Failed to load config: ${e.message}`);
    process.exit(1);
  }
  // Normalize input to array
  const input = Array.isArray(cfg.input) ? cfg.input : [cfg.input || ""];
  if (input.length === 0 || !input[0]) {
    console.error("Config must specify 'input' (file, directory, or array)");
    process.exit(1);
  }
  return {
    input: input.filter(Boolean),
    output: cfg.output || null,
    split: !!cfg.split,
    metrics: !!cfg.metrics,
    md: !!cfg.md,
    json: !!cfg.json,
    index: !!cfg.index,
  };
}

// ── CLI parsing ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const configIdx = args.indexOf("--config");
const hasConfig = configIdx !== -1 && configIdx + 1 < args.length;

if (args.includes("--help") || args.includes("-h")) {
  console.log("deob — universal JS deobfuscation pipeline\n");
  console.log("Usage: deob <input> [output-dir] [options]");
  console.log("       deob --config <path>\n");
  console.log("Options:");
  console.log("  --split      split output into per-function files");
  console.log("  --metrics    generate HTML readability metrics report");
  console.log("  --md         generate Markdown structure report");
  console.log("  --json       generate JSON structure report");
  console.log("  --index      build code index for AI-assisted exploration");
  console.log("  --config     use config file (ignores other flags)\n");
  console.log("Config format:");
  console.log("  module.exports = {");
  console.log("    input: 'main.js',           // file, directory, or array");
  console.log("    output: 'out/',             // optional");
  console.log("    split: true, metrics: true, // flags");
  console.log("    md: true, json: true, index: true");
  console.log("  };\n");
  console.log("Examples:");
  console.log("  deob main.js --split --md");
  console.log("  deob src/ --md --json");
  console.log("  deob --config deob.config.js");
  process.exit(0);
}

// ── run ──────────────────────────────────────────────────────────────

if (hasConfig) {
  const cfg = parseConfig(args[configIdx + 1]);

  console.log(`Config: ${path.resolve(args[configIdx + 1])}`);

  for (const inputPath of cfg.input) {
    const isDir = fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory();
    const outputDir = cfg.output || defaultOutDir(inputPath);

    if (isDir) {
      processDirectory(inputPath, outputDir, cfg);
    } else {
      processSingleFile(inputPath, outputDir, cfg);
    }
  }
} else {
  // CLI mode — parse flags and positional args
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const opts = {
    split: flags.has("--split"),
    metrics: flags.has("--metrics"),
    md: flags.has("--md"),
    json: flags.has("--json"),
    index: flags.has("--index"),
  };
  const filtered = args.filter((a) => !a.startsWith("--"));
  const inputPath = filtered[0];

  if (!inputPath) {
    console.log("No input specified. Use --help for usage.");
    process.exit(0);
  }

  const isDir = fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory();
  const outputDir = filtered[1] || defaultOutDir(inputPath);

  if (isDir) {
    processDirectory(inputPath, outputDir, opts);
  } else {
    processSingleFile(inputPath, outputDir, opts);
  }
}
