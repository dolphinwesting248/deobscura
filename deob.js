#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const { main } = require("./scripts/pipeline");
const { runMetrics } = require("./scripts/metrics");
const { runStructure, generateCrossSummary, applyTierFilter, generateIndex } = require("./scripts/structure");

// ── helpers ──────────────────────────────────────────────────────────

function collectJsFilesRecursive(dir, baseDir) {
  baseDir = baseDir || dir;
  const results = []; // { filepath, relDir }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...collectJsFilesRecursive(full, baseDir));
    } else if (e.isFile() && e.name.endsWith(".js")) {
      results.push({ filepath: full, relDir: path.relative(baseDir, dir) });
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

  if (opts.tier && opts.tier < 3) applyTierFilter(outDir, opts.tier, opts.fold, opts.denoise);

  const reports = [];
  if (opts.metrics) runMetrics(file, outDir);
  if (opts.md) reports.push(runStructure(file, outDir, { brief: true, denoise: opts.denoise }));
  if (opts.index) generateIndex(outDir, { denoise: opts.denoise });
  return reports;
}

function processDirectory(inputDir, outputDir, opts) {
  const fileEntries = collectJsFilesRecursive(inputDir);
  if (fileEntries.length === 0) {
    console.log("No .js files found in directory");
    return;
  }

  // Resolve filename conflicts: if two files have the same basename, prefix with parent dir
  const nameCount = new Map();
  for (const fe of fileEntries) {
    const base = path.basename(fe.filepath, ".js");
    nameCount.set(base, (nameCount.get(base) || 0) + 1);
  }
  function safeName(fe) {
    const base = path.basename(fe.filepath, ".js");
    if (nameCount.get(base) > 1) {
      const parent = path.basename(fe.relDir || path.dirname(fe.filepath));
      return parent + "_" + base;
    }
    return base;
  }

  const subDirs = [...new Set(fileEntries.map((f) => f.relDir))].filter(Boolean);
  console.log(`Input:  ${inputDir}/ (${fileEntries.length} files${subDirs.length > 0 ? ", " + subDirs.length + " subdirs" : ""})`);
  console.log(`Output: ${outputDir}/`);
  if (opts.split) console.log("        (split mode)");
  if (opts.metrics) console.log("        + metrics report");
  if (opts.md) console.log("        + structure report (.md)");
  if (opts.index) console.log("        + compact index");

  const allReports = [];

  for (let i = 0; i < fileEntries.length; i++) {
    const fe = fileEntries[i];
    const name = safeName(fe);
    const fileOutDir = path.join(outputDir, name);
    const reports = processOneFile(fe.filepath, fileOutDir, opts);
    const structReport = reports.find((r) => r && r.summary);
    if (structReport) allReports.push({ file: name, report: structReport, srcPath: fe.relDir ? path.join(fe.relDir, path.basename(fe.filepath)) : path.basename(fe.filepath) });
  }

  // Cross-file summary
  if (opts.md && allReports.length > 0) {
    console.log(`\nGenerating cross-file summary...`);
    const summary = generateCrossSummary(allReports);
    fs.writeFileSync(path.join(outputDir, "summary.md"), summary, "utf-8");
    console.log(`  Summary report: ${path.join(outputDir, "summary.md")}`);
  }

  // Cross-file index
  if (opts.index) {
    generateIndex(outputDir);
  }
}

function processSingleFile(inputPath, outputDir, opts) {
  console.log(`Input:  ${inputPath}`);
  console.log(`Output: ${outputDir}/`);
  if (opts.split) console.log("        (split mode)");
  if (opts.metrics) console.log("        + metrics report");
  if (opts.md) console.log("        + structure report (.md)");
  if (opts.index) console.log("        + compact index");
  if (opts.tier < 3) {
    const s = opts.fold ? " + fold" : "";
    console.log(`        (tier ${opts.tier}${s} output)`);
  }
  console.log("");

  main({ input: inputPath, output: outputDir, split: opts.split });

  if (opts.tier && opts.tier < 3) applyTierFilter(outputDir, opts.tier, opts.fold);

  if (opts.metrics) runMetrics(inputPath, outputDir);
  if (opts.md) runStructure(inputPath, outputDir, { denoise: opts.denoise });
  if (opts.index) generateIndex(outputDir, { denoise: opts.denoise });
}

function defaultOutDir(inputPath) {
  const isDir = fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory();
  return isDir
    ? inputPath.replace(/[\\/]$/, "") + ".deob"
    : inputPath.replace(/\.js$/i, ".deob");
}

// ── Default denoise rules ───────────────────────────────────────────
const DEFAULT_DENOISE = [
  { match: "https?://[a-zA-Z](/|$)",     label: "Test URL",       severity: "low" },
  { match: "github\\.io|mozilla\\.org",   label: "Doc URL",        severity: "low" },
  { match: "localhost|127\\.0\\.0\\.1",   label: "Local URL",      severity: "low" },
  { match: "example\\.com|test\\.com",    label: "Placeholder URL", severity: "low" },
];

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
    index: !!cfg.index,
    tier: cfg.tier != null ? cfg.tier : 3,
    fold: !!cfg.fold,
    denoise: Array.isArray(cfg.denoise) ? cfg.denoise : DEFAULT_DENOISE,
  };
}

// ── init command ─────────────────────────────────────────────────────
const CONFIG_TEMPLATE = `
/// <reference types="deob" />

/** @type {import('deob').DeobConfig} */
module.exports = {
  // Input: a single file, a directory, or an array of paths
  input: "src/main.js",
  // input: ["src/a.js", "src/b.js", "src/sub/"],

  // Output directory (optional — auto-derived from input if omitted)
  // output: "out/",

  // Feature flags
  split: false,  // per-function file output
  metrics: false, // HTML readability comparison report
  md: true,       // Markdown structure report
  index: false,   // compact index.txt for LLM navigation

  // LLM-oriented output tuning
  tier: 3,        // 1=alerts+hotspots only, 2=+callees, 3=all functions
  fold: false,    // collapse mechanical functions (polyfill/pure compute/forward) to comments

  // Alert denoising — downgrade false-positive alerts.
  // Each rule: { match: regex, label: "new label", severity?: "low"|"medium"|... }
  // Set to [] to disable all denoising, or omit to use defaults (shown below).
  denoise: [
    // Single-char hostname → test data (e.g. http://a, https://b/c)
    { match: "https?://[a-zA-Z](/|$)",     label: "Test URL",       severity: "low" },
    // Documentation domains → code comment or reference link
    { match: "github\\\\.io|mozilla\\\\.org", label: "Doc URL",     severity: "low" },
    // Loopback / local dev server
    { match: "localhost|127\\\\.0\\\\.0\\\\.1", label: "Local URL", severity: "low" },
    // Placeholder / example domains
    { match: "example\\\\.com|test\\\\.com",  label: "Placeholder URL", severity: "low" },
  ],
};
`;

function initConfig(force) {
  const target = path.resolve("deob.config.js");
  if (fs.existsSync(target) && !force) {
    console.log(`deob.config.js already exists. Use --force to overwrite.`);
    return;
  }
  fs.writeFileSync(target, CONFIG_TEMPLATE, "utf-8");
  console.log(`Created ${target}`);
}

// ── CLI parsing ──────────────────────────────────────────────────────

const args = process.argv.slice(2);

// Handle `init` subcommand
if (args[0] === "init") {
  initConfig(args.includes("--force"));
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log("deob — universal JS deobfuscation pipeline\n");
  console.log("Usage: deob                       # auto-detect deob.config.js");
  console.log("       deob init [--force]        # generate config file");
  console.log("       deob --config <path>       # use specific config");
  console.log("       deob -c <path>             # shorthand for --config\n");
  console.log("Config format (deob.config.js):");
  console.log("  module.exports = {");
  console.log("    input: 'main.js',             // file, directory, or array");
  console.log("    output: 'out/',               // optional");
  console.log("    split: false, metrics: false,");
  console.log("    md: true, index: false,");
  console.log("    tier: 3, fold: false,");
  console.log("    denoise: [{ match, label, severity }, ...],  // alert denoising rules");

  console.log("  };\n");
  console.log("Examples:");
  console.log("  deob                        # uses deob.config.js in cwd");
  console.log("  deob init                   # create deob.config.js");
  console.log("  deob --config prod.config.js");
  process.exit(0);
}

// ── run ──────────────────────────────────────────────────────────────

function runWithConfig(configPath) {
  const cfg = parseConfig(configPath);
  if (configPath !== "deob.config.js") {
    console.log(`Config: ${path.resolve(configPath)}`);
  }
  for (const inputPath of cfg.input) {
    const isDir = fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory();
    const outputDir = cfg.output || defaultOutDir(inputPath);
    if (isDir) {
      processDirectory(inputPath, outputDir, cfg);
    } else {
      processSingleFile(inputPath, outputDir, cfg);
    }
  }
}

// Determine config path
const ci = args.indexOf("--config");
const ciShort = args.indexOf("-c");
const configIdx = ci !== -1 ? ci : ciShort;
const hasConfig = configIdx !== -1 && configIdx + 1 < args.length;

if (hasConfig) {
  runWithConfig(args[configIdx + 1]);
} else if (args.length === 0 && fs.existsSync("deob.config.js")) {
  runWithConfig("deob.config.js");
} else if (args.length === 0) {
  console.log("No deob.config.js found. Run 'deob init' to create one.");
  process.exit(1);
} else {
  console.log("Unknown arguments. Usage: deob [--config <path>]  or  deob init");
  process.exit(1);
}
