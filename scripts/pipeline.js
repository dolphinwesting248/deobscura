// Main transformation pipeline
// Usage:
//   const { main } = require('./scripts/pipeline');
//   main({ input: 'obfuscated.js', output: 'clean.js' });
//
// Adding a new pass:
//   1. Create your pass function in a module
//   2. Require it here
//   3. Add a step in main() that calls it

const { parser, generate, t, fs } = require("./config");
const path = require("path");
const { processAllFunctions } = require("./traverse");
const { extractTopLevelIIFEs } = require("./wrapper");
const { hoistDeclarations, simplify, expandSequences, eliminateDeadCode, inlineReadOnlyProperties, removeUnusedHelpers, simplifyRedundantConditions, inlinePureWrappers, sortByCallTree, inlineSingleCallerFns, normalizeSyntax, extractInlineFunctions } = require("./passes");

function main({ input, output, split } = {}) {
  if (!input) throw new Error("main() requires { input: '<path>' }");
  if (!output) throw new Error("main() requires { output: '<path>' }");

  console.log("Reading file...");
  const code = fs.readFileSync(input, "utf-8");
  console.log(`Size: ${(code.length / 1024 / 1024).toFixed(2)} MB`);

  console.log("Parsing AST...");
  const ast = parser.parse(code, {
    sourceType: "script",
    allowReturnOutsideFunction: true,
    allowUndeclaredExports: true,
    errorRecovery: true,
  });

  // ==================== Extraction Passes ====================
  console.log("Step 1: Processing all function bodies...");
  const t0 = Date.now();
  const subFns1 = processAllFunctions(ast);
  console.log(`  ${subFns1.length} sub-functions generated in ${Date.now() - t0}ms`);

  console.log("Step 2: Extracting top-level IIFEs from comma chain...");
  const t1 = Date.now();
  const subFns2 = extractTopLevelIIFEs(ast);
  console.log(`  ${subFns2.length} top-level sub-functions generated in ${Date.now() - t1}ms`);

  // ==================== Append & Organize ====================
  const allSubFns = [...subFns1, ...subFns2];
  console.log(`Total sub-functions: ${allSubFns.length}`);

  const groups = new Map();
  for (const sf of allSubFns) {
    if (!sf.id) continue;
    const match = sf.id.name.match(/^_sub_(.+?)_\d{2}_/);
    const parent = match ? match[1] : "misc";
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(sf);
  }
  for (const g of [...groups.keys()].sort()) {
    for (const sf of groups.get(g)) ast.program.body.push(sf);
  }

  // ==================== Post-Processing Passes ====================
  console.log("Step 3: Hoisting helper function declarations...");
  const t2 = Date.now();
  hoistDeclarations(ast);
  console.log(`  Done in ${Date.now() - t2}ms`);

  console.log("Step 4: Extracting inline function expressions...");
  const t3b = Date.now();
  extractInlineFunctions(ast);
  console.log(`  Done in ${Date.now() - t3b}ms`);

  console.log("Step 5: Simplifying expressions (fold+boolean+strings)...");
  const t3 = Date.now();
  simplify(ast);
  console.log(`  Done in ${Date.now() - t3}ms`);

  console.log("Step 6: Expanding sequence expressions...");
  const t4 = Date.now();
  expandSequences(ast);
  console.log(`  Done in ${Date.now() - t4}ms`);

  console.log("Step 8: Eliminating dead code...");
  const t7 = Date.now();
  eliminateDeadCode(ast);
  console.log(`  Done in ${Date.now() - t7}ms`);

  console.log("Step 9: Inlining read-only property access...");
  const t8 = Date.now();
  inlineReadOnlyProperties(ast);
  console.log(`  Done in ${Date.now() - t8}ms`);

  console.log("Step 10: Removing unused helper functions...");
  const t9 = Date.now();
  removeUnusedHelpers(ast);
  console.log(`  Done in ${Date.now() - t9}ms`);

  console.log("Step 11: Simplifying redundant conditions...");
  const t10 = Date.now();
  simplifyRedundantConditions(ast);
  console.log(`  Done in ${Date.now() - t10}ms`);

  console.log("Step 12: Inlining pure wrapper functions...");
  const t11 = Date.now();
  inlinePureWrappers(ast);
  console.log(`  Done in ${Date.now() - t11}ms`);

  console.log("Step 13: Sorting functions by call tree...");
  const t12 = Date.now();
  sortByCallTree(ast);
  console.log(`  Done in ${Date.now() - t12}ms`);

  console.log("Step 14: Inlining single-caller functions...");
  const t13 = Date.now();
  inlineSingleCallerFns(ast);
  console.log(`  Done in ${Date.now() - t13}ms`);

  console.log("Step 15: Normalizing syntax patterns...");
  const t14 = Date.now();
  normalizeSyntax(ast);
  console.log(`  Done in ${Date.now() - t14}ms`);

  // ==================== Output ====================
  const { t } = require("./config");
  const path = require("path");

  if (split) {
    writeSplitOutput(ast, output, code);
    return null;
  } else {
    return writeSingleOutput(ast, output, code);
  }
}

function writeSingleOutput(ast, output, code) {
  // output is always a directory; write deobfuscated code as main.js inside it
  const outDir = output;
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  console.log("Generating output...");
  const g0 = Date.now();
  const generated = generate(ast, {
    retainLines: false, retainFunctionParens: false,
    comments: true, compact: false,
  }).code;
  console.log(`Generated in ${Date.now() - g0}ms`);

  const mainFile = path.join(outDir, "main.js");
  console.log("Writing output...");
  fs.writeFileSync(mainFile, generated, "utf-8");

  formatFile(mainFile);

  const finalSize = fs.statSync(mainFile).size;
  const ratio = ((finalSize / code.length) * 100).toFixed(1);
  console.log(`Done! Output: ${(finalSize / 1024 / 1024).toFixed(2)} MB (${ratio}% of original)`);

  const fnCount = fs.readFileSync(mainFile, "utf-8").split("\n").filter((l) => l.includes("function _sub_")).length;
  console.log(`_sub_ function declarations in output: ${fnCount}`);
  return generated;
}

function writeSplitOutput(ast, output, code) {
  const path = require("path");
  console.log("Splitting into per-function files...");

  // Ensure output directory
  const outDir = output;
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  // Group _sub_ functions by parent name
  const groups = new Map();
  const otherStmts = [];

  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id && stmt.id.name.startsWith("_sub_")) {
      const match = stmt.id.name.match(/^_sub_(.+?)_\d{2}_/);
      const parent = match ? match[1] : "misc";
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(stmt);
    } else {
      otherStmts.push(stmt);
    }
  }

  // --- Phase 1: generate ALL function codes at once ---
  // Build one big AST with all functions, generate once, then split by regex
  // Write _all.js (full combined code for reports to analyze)
  fs.writeFileSync(path.join(outDir, "_all.js"), generate(ast, {
    retainLines: false, retainFunctionParens: false,
    comments: true, compact: false,
  }).code, "utf-8");

  // Generate each function separately but without prettier — batch format at end
  const generatedFns = new Map();

  // Write main.js (original functions)
  const mainAst = { ...ast, program: { ...ast.program, body: otherStmts } };
  fs.writeFileSync(path.join(outDir, "main.js"), generate(mainAst, {
    retainLines: false, retainFunctionParens: false,
    comments: true, compact: false,
  }).code, "utf-8");

  // Generate each _sub_ function
  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id && stmt.id.name.startsWith("_sub_")) {
      const fnAst = { ...ast, program: { ...ast.program, body: [stmt] } };
      generatedFns.set(stmt, generate(fnAst, {
        retainLines: false, retainFunctionParens: false,
        comments: true, compact: false,
      }).code);
    }
  }

  // --- Phase 2: write files ---
  let totalFiles = 1; // main.js
  let processed = 0;
  const groupEntries = [...groups.entries()];
  const barWidth = 30;

  for (const [parentName, fns] of groupEntries) {
    const dir = path.join(outDir, parentName);
    fs.mkdirSync(dir, { recursive: true });

    const exports = fns.map((fn) => `  "${fn.id.name}": require("./${fn.id.name}"),`).join("\n");
    fs.writeFileSync(path.join(dir, "index.js"), `// Group: ${parentName} (${fns.length} functions)\nmodule.exports = {\n${exports}\n};\n`, "utf-8");
    totalFiles++;

    for (const fn of fns) {
      let fnCode = generatedFns.get(fn) || "";

      // Add require() calls for external sub-function references
      const imports = new Set();
      walkCalls(fn.body, imports);
      const importLines = [];
      for (const name of imports) {
        if (name.startsWith("_sub_")) {
          const match = name.match(/^_sub_(.+?)_\d{2}_/);
          const parent = match ? match[1] : "misc";
          importLines.push(`const ${name} = require("../${parent}/${name}");`);
        }
      }
      if (importLines.length > 0) fnCode = importLines.join("\n") + "\n\n" + fnCode;

      fs.writeFileSync(path.join(dir, `${fn.id.name}.js`), fnCode, "utf-8");
      totalFiles++;
    }

    processed++;
    const pct = Math.round((processed / groupEntries.length) * 100);
    const filled = Math.round((processed / groupEntries.length) * barWidth);
    process.stdout.write(`\r  [${"█".repeat(filled)}${"░".repeat(barWidth - filled)}] ${pct}%  ${processed}/${groupEntries.length} groups`);
  }
  process.stdout.write("\n");

  // Assembly index
  const rootEntries = [...groups.keys()].map((g) => `  "${g}": require("./${g}"),`).join("\n");
  fs.writeFileSync(path.join(outDir, "index.js"), `// Assembly\nmodule.exports = {\n${rootEntries}\n};\n`, "utf-8");

  // --- Phase 3: format entire directory once ---
  console.log("  Formatting...");
  formatDirectory(outDir);

  console.log(`  Wrote ${totalFiles} files to ${outDir}/ (${groups.size} groups)`);
}

function walkCalls(node, collected) {
  if (!node || typeof node !== "object") return;
  if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name.startsWith("_sub_")) {
    collected.add(node.callee.name);
  }
  for (const k of Object.keys(node)) {
    if (k === "start" || k === "end" || k === "loc" ||
        k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
    const val = node[k];
    if (Array.isArray(val)) { for (const v of val) walkCalls(v, collected); }
    else if (val && typeof val.type === "string") walkCalls(val, collected);
  }
}

function formatFile(filepath) {
  // Used only for single-file output
  const { execSync } = require("child_process");
  try {
    execSync(`npx --yes prettier --write "${filepath}"`, { stdio: "pipe", timeout: 120000 });
  } catch (_) { /* prettier not available */ }
}

function formatDirectory(dir) {
  // Format an entire directory once instead of per-file (245 process spawns → 1)
  const { execSync } = require("child_process");
  try {
    execSync(`npx --yes prettier --write "${dir}/**/*.js"`, { stdio: "pipe", timeout: 120000 });
  } catch (_) { /* prettier not available */ }
}

module.exports = { main };
