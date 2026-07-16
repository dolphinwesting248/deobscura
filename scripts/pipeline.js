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
const { sanitizeReservedWords, hoistDeclarations, simplify, normalizeShortCircuit, expandSequences, eliminateDeadCode, inlineReadOnlyProperties, removeUnusedHelpers, simplifyRedundantConditions, inlinePureWrappers, inlineArithmeticWrappers, sortByCallTree, inlineSingleCallerFns, normalizeSyntax, extractInlineFunctions, annotateAlerts, pushDataToBottom, resetInlineNames } = require("./passes");
const { resetNames } = require("./naming");

function main({ input, output, split } = {}) {
  if (!input) throw new Error("main() requires { input: '<path>' }");
  if (!output) throw new Error("main() requires { output: '<path>' }");
  resetNames();
  resetInlineNames();

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

  // ==================== Sanitization ====================
  console.log("Step 0: Sanitizing reserved-word identifiers...");
  sanitizeReservedWords(ast);

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
    const match = sf.id.name.match(/^_S_(.+?)_\d{2}_/);
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

  console.log("Step 6: Normalizing short-circuit to if blocks...");
  const t4 = Date.now();
  normalizeShortCircuit(ast);
  console.log(`  Done in ${Date.now() - t4}ms`);

  console.log("Step 7: Expanding sequence expressions...");
  const t5 = Date.now();
  expandSequences(ast);
  console.log(`  Done in ${Date.now() - t5}ms`);

  console.log("Step 8: Re-normalizing short-circuit after expansion...");
  const t6 = Date.now();
  normalizeShortCircuit(ast);
  console.log(`  Done in ${Date.now() - t6}ms`);

  console.log("Step 9: Eliminating dead code...");
  const t9 = Date.now();
  eliminateDeadCode(ast);
  console.log(`  Done in ${Date.now() - t9}ms`);

  console.log("Step 10: Inlining read-only property access...");
  const t10 = Date.now();
  inlineReadOnlyProperties(ast);
  console.log(`  Done in ${Date.now() - t10}ms`);

  console.log("Step 11: Removing unused helper functions...");
  const t11 = Date.now();
  removeUnusedHelpers(ast);
  console.log(`  Done in ${Date.now() - t11}ms`);

  console.log("Step 12: Simplifying redundant conditions...");
  const t12 = Date.now();
  simplifyRedundantConditions(ast);
  console.log(`  Done in ${Date.now() - t12}ms`);

  console.log("Step 13: Inlining pure wrapper functions...");
  const t13 = Date.now();
  inlinePureWrappers(ast);
  console.log(`  Done in ${Date.now() - t13}ms`);

  // Step 13b: disabled — too slow on large files (142KB+), needs optimization
  // console.log("Step 13b: Inlining arithmetic wrappers...");
  // inlineArithmeticWrappers(ast);

  console.log("Step 14: Sorting functions by call tree...");
  const t14 = Date.now();
  sortByCallTree(ast);
  console.log(`  Done in ${Date.now() - t14}ms`);

  console.log("Step 15: Inlining single-caller functions...");
  const t15 = Date.now();
  inlineSingleCallerFns(ast);
  console.log(`  Done in ${Date.now() - t15}ms`);

  console.log("Step 16: Normalizing syntax patterns...");
  const t16 = Date.now();
  normalizeSyntax(ast);
  console.log(`  Done in ${Date.now() - t16}ms`);

  console.log("Step 17: Re-extracting exposed inline functions...");
  const t17 = Date.now();
  extractInlineFunctions(ast);
  console.log(`  Done in ${Date.now() - t17}ms`);

  console.log("Step 18: Annotating functions with security alerts...");
  const t18 = Date.now();
  annotateAlerts(ast);
  console.log(`  Done in ${Date.now() - t18}ms`);

  // ==================== Final Sanitization ====================
  console.log("Step 19: Sanitizing reserved-word identifiers...");
  sanitizeReservedWords(ast);

  console.log("Step 20: Separating DATA functions...");
  pushDataToBottom(ast);

  // ==================== Output ====================
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

  // Safety: filter out any non-statement nodes from program body
  ast.program.body = ast.program.body.filter((n) => n && typeof n.type === "string" && n.type !== "CommentLine" && n.type !== "CommentBlock");

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

  const finalSize = fs.statSync(mainFile).size;
  const ratio = ((finalSize / code.length) * 100).toFixed(1);
  console.log(`Done! Output: ${(finalSize / 1024 / 1024).toFixed(2)} MB (${ratio}% of original)`);

  const fnCount = fs.readFileSync(mainFile, "utf-8").split("\n").filter((l) => l.includes("function _S_")).length;
  console.log(`_S_ function declarations in output: ${fnCount}`);
  return generated;
}

function writeSplitOutput(ast, output, code) {
  console.log("Splitting into per-function files...");

  // Ensure output directory
  const outDir = output;
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  // Group _S_ functions by parent name
  const groups = new Map();
  const otherStmts = [];

  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id && stmt.id.name.startsWith("_S_")) {
      const match = stmt.id.name.match(/^_S_(.+?)_\d{2}_/);
      const parent = match ? match[1] : "misc";
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(stmt);
    } else {
      otherStmts.push(stmt);
    }
  }

  // --- Phase 1: generate ALL function codes at once ---
  // Write main.js with full combined output (used by reports)
  fs.writeFileSync(path.join(outDir, "main.js"), generate(ast, {
    retainLines: false, retainFunctionParens: false,
    comments: true, compact: false,
  }).code, "utf-8");

  // Generate each function separately but without prettier — batch format at end
  const generatedFns = new Map();

  // Generate each _S_ function
  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id && stmt.id.name.startsWith("_S_")) {
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
        if (name.startsWith("_S_")) {
          const match = name.match(/^_S_(.+?)_\d{2}_/);
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


  console.log(`  Wrote ${totalFiles} files to ${outDir}/ (${groups.size} groups)`);
}

function walkCalls(node, collected) {
  if (!node || typeof node !== "object") return;
  if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name.startsWith("_S_")) {
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

module.exports = { main };
