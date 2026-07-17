#!/usr/bin/env node
// Benchmark runner — runs deob on obfuscated scenarios, collects output metrics
const { main } = require("../../../../scripts/pipeline");
const { runStructure, generatePromptFile, generateIndex } = require("../../../../scripts/structure");
const fs = require("fs");
const path = require("path");

const SCENARIOS = ["A", "B", "C"];
const SCENARIO_DIR = path.join(__dirname, "..", "scenarios");
const OUTPUT_DIR = path.join(__dirname, "..", "results", "deob-output");

if (fs.existsSync(OUTPUT_DIR)) fs.rmSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const results = {};

for (const s of SCENARIOS) {
  const inputFile = path.join(SCENARIO_DIR, s, "obfuscated.js");
  const outDir = path.join(OUTPUT_DIR, s);
  console.log(`\n=== Scenario ${s} ===`);
  console.log(`Input: ${(fs.statSync(inputFile).size / 1024).toFixed(1)} KB`);

  const t0 = Date.now();
  try {
    main({ input: inputFile, output: outDir, split: false });
    const t1 = Date.now();

    const outputSize = fs.statSync(path.join(outDir, "main.js")).size;
    const ratio = (outputSize / fs.statSync(inputFile).size * 100).toFixed(1);

    // Generate structure reports
    try {
      runStructure(inputFile, outDir, { denoise: [] });
      generatePromptFile(outDir);
      generateIndex(outDir, { denoise: [] });
    } catch (e) {
      console.log(`  Structure warning: ${e.message.split("\\n")[0]}`);
    }

    results[s] = {
      inputBytes: fs.statSync(inputFile).size,
      outputBytes: outputSize,
      ratioPercent: parseFloat(ratio),
      timeMs: t1 - t0,
      error: null,
    };
    console.log(`  OK: ${ratio}% in ${t1 - t0}ms`);
  } catch (e) {
    results[s] = { error: e.message.split("\\n")[0] };
    console.log(`  ERROR: ${e.message.split("\\n")[0]}`);
  }
}

// Save results
const resultsPath = path.join(__dirname, "..", "results", "deob-metrics.json");
fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
console.log(`\nMetrics saved to ${resultsPath}`);
