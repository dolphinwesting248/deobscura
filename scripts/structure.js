// Structure report: Markdown or JSON output of function inventory + call graph
const { parser, t, fs, path } = require("./config");

function analyzeStructure(filepath) {
  const code = fs.readFileSync(filepath, "utf-8");
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: "script", allowReturnOutsideFunction: true,
      allowUndeclaredExports: true, errorRecovery: true,
    });
  } catch (e) {
    // Fallback for files with sloppy-mode reserved words
    return {
      file: path.basename(filepath),
      error: "Parse failed (sloppy-mode reserved words like let/if as variable names)",
      summary: { totalFunctions: 0, subFunctions: 0, originalFunctions: 0, byType: {}, maxDepth: 0 },
      naming: {},
      functions: [],
    };
  }

  const fns = []; // {name, lines, params, calls:[], calledBy:[], comment}
  const nameMap = new Map();

  // Phase 1: collect all _sub_ function declarations
  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) {
      const name = stmt.id.name;
      const lines = stmt.loc ? [stmt.loc.start.line, stmt.loc.end.line] : [0, 0];
      const params = stmt.params.length;
      const bl = t.isBlockStatement(stmt.body) ? stmt.body.body.length : 1;
      const comment = (stmt.leadingComments && stmt.leadingComments.length > 0)
        ? stmt.leadingComments[0].value.trim() : "";
      fns.push({ name, lines, params, bodyLen: bl, calls: [], calledBy: [], comment });
      nameMap.set(name, fns.length - 1);
    }
  }

  // Phase 2: collect call edges
  function walk(node, callerName) {
    if (!node || typeof node !== "object") return;
    if (t.isCallExpression(node) && t.isIdentifier(node.callee) && nameMap.has(node.callee.name)) {
      const calleeIdx = nameMap.get(node.callee.name);
      const callerIdx = nameMap.get(callerName);
      if (callerIdx !== undefined && !fns[callerIdx].calls.includes(node.callee.name)) {
        fns[callerIdx].calls.push(node.callee.name);
      }
      fns[calleeIdx].calledBy.push(callerName);
    }
    for (const k of Object.keys(node)) {
      if (k === "start" || k === "end" || k === "loc" ||
          k.startsWith("lead") || k.startsWith("trail") || k.startsWith("inner")) continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const x of v) walk(x, callerName); }
      else if (v && typeof v.type === "string") walk(v, callerName);
    }
  }
  for (const stmt of ast.program.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) walk(stmt.body, stmt.id.name);
  }

  // Phase 3: summary
  const subFns = fns.filter((f) => f.name.startsWith("_sub_"));
  const origins = fns.filter((f) => !f.name.startsWith("_sub_"));
  const types = {};
  for (const f of subFns) {
    const n = f.name;
    if (n.match(/_try$/)) types.tryCatch = (types.tryCatch || 0) + 1;
    else if (n.match(/_if$/) || n.match(/_else$/)) types.ifElse = (types.ifElse || 0) + 1;
    else if (n.includes("_iife") || n.includes("_init_")) types.iife = (types.iife || 0) + 1;
    else if (n.includes("_case")) types.switch = (types.switch || 0) + 1;
    else if (n.startsWith("_sub_return_fn")) types.inlineFn = (types.inlineFn || 0) + 1;
    else if (n.startsWith("_sub_program")) types.program = (types.program || 0) + 1;
    else types.other = (types.other || 0) + 1;
  }

  return {
    file: path.basename(filepath),
    summary: {
      totalFunctions: fns.length,
      subFunctions: subFns.length,
      originalFunctions: origins.length,
      byType: types,
      maxDepth: Math.max(...subFns.map((f) => (f.name.match(/_/g) || []).length), 0),
    },
    naming: {
      format: "_sub_<parent>_<seq>_<description>",
      examples: [
        { name: "_sub_0x28bed7_01_try", meaning: "Extracted from function 0x28bed7, sequence 01, try body" },
        { name: "_sub_constructor_07_if", meaning: "Extracted from method 'constructor', sequence 07, if branch" },
        { name: "_sub_ln100877_07_else", meaning: "Extracted from anonymous function at line 100877, sequence 07, else branch" },
        { name: "_sub_program_init_vars_ln1149", meaning: "Top-level program IIFE at line 1149, variable initialization" },
        { name: "_sub_return_fn1", meaning: "Inline function expression lifted from a return statement" },
      ],
      hints: {
        try: "try block body",
        catch: "catch handler",
        if: "if branch",
        else: "else branch",
        case: "switch case body",
        iife_body: "IIFE body",
        init_vars: "variable initialization",
        declare_fn: "function declarations",
        return_val: "return value expression",
        body: "loop body or block",
        block: "general code block",
      },
    },
    functions: fns,
  };
}

function generateMarkdown(report) {
  if (report.error) return `# Structure Report · ${report.file}\n\n> **${report.error}**\n`;
  const { file, summary, naming, functions } = report;
  const typeTable = Object.entries(summary.byType).map(([k, v]) => `| ${k} | ${v} |`).join("\n");

  return `# Structure Report · ${file}

## Summary

| Metric | Value |
|--------|-------|
| Total functions | ${summary.totalFunctions} |
| Sub-functions | ${summary.subFunctions} |
| Original functions | ${summary.originalFunctions} |
| Max nesting depth | ${summary.maxDepth} |

### By Extraction Type

| Type | Count |
|------|-------|
${typeTable}

## Naming Convention

All sub-functions follow the format: \`_sub_<parent>_<seq>_<description>\`

| Component | Meaning |
|-----------|---------|
| \`_sub_\` | Prefix indicating an extracted sub-function |
| \`<parent>\` | The parent function name, object method name, or line number (\`lnXXXX\`) for anonymous functions |
| \`<seq>\` | Two-digit sequence number indicating extraction order within the parent |
| \`<description>\` | Short hint about the extracted code structure |

### Examples

| Name | Meaning |
|------|---------|
${naming.examples.map((e) => `| \`${e.name}\` | ${e.meaning} |`).join("\n")}

### Hint Descriptions

| Hint | Meaning |
|------|---------|
${Object.entries(naming.hints).map(([k, v]) => `| \`${k}\` | ${v} |`).join("\n")}

## Call Graph

\`\`\`mermaid
graph TD
${functions.filter((f) => f.calls.length > 0).map((f) =>
    f.calls.map((c) => `  ${f.name} --> ${c}`).join("\n")
  ).join("\n")}
\`\`\`

## Function Inventory

| # | Name | Lines | Params | Calls | Called By |
|---|------|-------|--------|-------|-----------|
${functions.map((f, i) => {
    const lines = f.lines[0] ? `${f.lines[0]}-${f.lines[1]}` : "-";
    const calls = f.calls.length > 0 ? f.calls.join(", ") : "—";
    const calledBy = f.calledBy.length > 0 ? f.calledBy.join(", ") : "root";
    return `| ${i + 1} | \`${f.name}\` | ${lines} | ${f.params} | ${calls} | ${calledBy} |`;
  }).join("\n")}

---
Generated by deob · ${new Date().toISOString().slice(0, 10)}
`;
}

function generateJSON(report) {
  return JSON.stringify(report, null, 2);
}

function runStructure(input, outputDir, format) {
  // Analyze the full combined output (_all.js in split mode, main.js otherwise)
  const allPath = path.join(outputDir, "_all.js");
  const mainPath = path.join(outputDir, "main.js");
  const afterPath = fs.existsSync(allPath) ? allPath : mainPath;
  if (!fs.existsSync(afterPath)) {
    console.log("  Structure report skipped: no output file found");
    return null;
  }
  const report = analyzeStructure(afterPath);
  const ext = format === "md" ? ".md" : ".json";
  const outPath = path.join(outputDir, "structure" + ext);
  const content = format === "md" ? generateMarkdown(report) : generateJSON(report);
  fs.writeFileSync(outPath, content, "utf-8");
  console.log(`  Structure report: ${outPath}`);
  return report;
}

module.exports = { analyzeStructure, generateMarkdown, generateJSON, runStructure };
