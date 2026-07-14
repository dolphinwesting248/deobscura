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

  main({
    input: file, output: outDir, split: opts.split,
    sourceType: opts.parser?.sourceType || "script",
    compact: opts.outputOpts?.compact || false,
  });

  const reports = [];
  if (opts.metrics) runMetrics(file, outDir);
  if (opts.md) reports.push(runStructure(file, outDir, "md", opts.alerts));
  if (opts.json) reports.push(runStructure(file, outDir, "json", opts.alerts));
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
    const stats = indexDirectory(outputDir, opts.indexer?.skipPatterns || []);
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

  main({
    input: inputPath, output: outputDir, split: opts.split,
    sourceType: opts.parser?.sourceType || "script",
    compact: opts.outputOpts?.compact || false,
  });

  if (opts.metrics) runMetrics(inputPath, outputDir);
  if (opts.md) runStructure(inputPath, outputDir, "md", opts.alerts);
  if (opts.json) runStructure(inputPath, outputDir, "json", opts.alerts);

  if (opts.index) {
    console.log("Indexing output directory...");
    const stats = indexDirectory(outputDir, opts.indexer?.skipPatterns || []);
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
    // Parser options
    parser: {
      sourceType: cfg.parser?.sourceType || "script",
    },
    // Output formatting
    outputOpts: {
      compact: !!cfg.outputOpts?.compact,
    },
    // Custom alert patterns (merged with defaults if extend is true)
    alerts: {
      patterns: cfg.alerts?.patterns || [],
      extend: cfg.alerts?.extend !== false, // default: append to built-in
    },
    // Indexer options
    indexer: {
      skipPatterns: cfg.indexer?.skipPatterns || [],
    },
  };
}

// ── init command ─────────────────────────────────────────────────────
const CONFIG_TEMPLATE = `
module.exports = {
  // ── Input / Output ──────────────────────────────────────────────
  // A single file, a directory, or an array of paths.
  // Directory mode processes each .js file and generates a cross-file summary.
  input: "src/main.js",
  // input: ["src/a.js", "src/b.js", "src/sub/"],

  // Output directory (optional — auto-derived from input if omitted)
  // output: "out/",

  // ── Feature Flags ───────────────────────────────────────────────
  split: false,   // per-function file output
  metrics: false, // HTML readability comparison report
  md: true,       // Markdown structure report
  json: false,    // JSON structure report
  index: false,   // SQLite code intelligence index

  // ── Parser Options ──────────────────────────────────────────────
  // parser: {
  //   sourceType: "script",  // "script" (sloppy) | "module" (strict) | "unambiguous"
  // },

  // ── Output Formatting ───────────────────────────────────────────
  // outputOpts: {
  //   compact: false,  // true = smaller output, no extra whitespace
  // },

  // ── String Alerts (structure report) ────────────────────────────
  // alerts: {
  //   extend: true,  // true = add to built-in patterns, false = replace
  //   patterns: [
  //     { label: "MyAPI", regex: "/myapi\\\\.example\\\\.com/gi", severity: "high" },
  //   ],
  // },

  // ── Indexer Options ─────────────────────────────────────────────
  // indexer: {
  //   skipPatterns: ["**/test/**", "**/*.spec.js"],  // globs to skip
  // },
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
const configIdx = args.indexOf("--config");
const hasConfig = configIdx !== -1 && configIdx + 1 < args.length;

// Handle `init` subcommand before anything else
if (args[0] === "init") {
  initConfig(args.includes("--force"));
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log("deob — universal JS deobfuscation pipeline\n");
  console.log("Usage: deob                            # auto-detect deob.config.js");
  console.log("       deob <input> [output-dir] [options]");
  console.log("       deob --config <path>");
  console.log("       deob init [--force]\n");
  console.log("Commands:");
  console.log("  init          generate deob.config.js in current directory");
  console.log("  init --force  overwrite existing config\n");
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

if (hasConfig) {
  runWithConfig(args[configIdx + 1]);
} else if (!hasConfig && args.length === 0 && fs.existsSync("deob.config.js")) {
  // No arguments, auto-detect deob.config.js in cwd
  runWithConfig("deob.config.js");
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
