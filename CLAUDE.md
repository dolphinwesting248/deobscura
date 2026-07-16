# deob — Universal JS Deobfuscation Pipeline

## Quick Start

```bash
deob init                        # create deob.config.js
deob                             # auto-detect deob.config.js
deob -c path/to/config.js        # explicit config
```

## Configuration

`deob.config.js` format:

```js
module.exports = {
  input: "src/main.js",           // file, directory, or array of paths
  output: "out/",                 // optional — auto-derived from input if omitted
  split: false,                   // per-function file output
  metrics: false,                 // HTML readability comparison report
  md: true,                       // 0-prompt.md + 1-structure.md
  index: true,                    // 2-index.txt
  tier: 3,                        // 1=alerts+hotspots, 2=+callees, 3=all functions
  fold: false,                    // collapse mechanical functions to comments
  denoise: [                      // alert denoising rules (optional)
    { match: "regex-source", label: "Label", severity: "low" },
  ],
};
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `input` | `string \| string[]` | required | JS file(s) or directory |
| `output` | `string` | auto | Output directory |
| `split` | `boolean` | `false` | Write each function to separate file |
| `metrics` | `boolean` | `false` | Generate HTML before/after report |
| `md` | `boolean` | `true` | Generate 0-prompt.md + 1-structure.md |
| `index` | `boolean` | `true` | Generate 2-index.txt |
| `tier` | `1 \| 2 \| 3` | `3` | Output filtering level |
| `fold` | `boolean` | `false` | Collapse mechanical functions to comments |
| `denoise` | `DenoiseRule[]` | defaults | Alert denoising rules |

## Output Files

```
output.deob/
  0-prompt.md       ← LLM analysis entry (architecture, alerts, top 5, reading path)
  1-structure.md    ← call graph, hotspots, alert traces, naming convention
  2-index.txt       ← function catalog with line numbers
  main.js           ← deobfuscated code (DATA functions at bottom)
  summary.md        ← (directory mode) cross-file keyword index
```

### 0-prompt.md Structure

```
## Architecture         — function count, domain, complexity, code density
## Alerts               — security-relevant patterns found
## Start Here (top 5)   — most interesting functions by interest score
## Skip                 — pass-through functions (zero logic)
## Reading Path         — prompt → structure → index → main.js
```

### 1-structure.md Structure

```
## Domain               — framework/bundler/crypto classification
## Function Types       — core/branch/callback/data/network/... breakdown
## Hot Spots            — most-called functions, entry points, leaves
## Alerts               — security patterns with severity, function, line
## Call Graph           — Mermaid diagram of cross-function calls
## Naming Convention    — _S_<parent>_<seq>_<hint> format explanation
```

### 2-index.txt Structure

```
# main.js · Function Index · N functions

## entry                — entry point functions
## hot                  — most-called functions
## lookup               — keyword → function mapping
## trace                — longest call path
## fn/<category>        — functions grouped by category
```

## Project Structure

```
deob.js                          CLI entry, config parsing, directory recursion
scripts/
  config.js                      User-facing config: parser, t, generate, fs, path, DEFAULT_DENOISE
  constants.js                   Internal constants: RESERVED, GLOBALS, ALERT_PATTERNS, SKIP_KEYS,
                                 SUB_FN_*, OUTPUT_FILES, THRESHOLDS, CATEGORIES, SEVERITY, NAMING_*,
                                 DOMAIN_RULES, CATEGORY_RULES, FRAMEWORK_PATTERNS
  ast-utils.js                   Generic AST walkers, pattern detectors, clone
  scope.js                       Variable scope analysis, external reference collection
  naming.js                      Sub-function naming (_S_ prefix, collision detection)
  emit.js                        Sub-function AST node creation, safeParam
  extract.js                     Syntactic extraction (IIFE, try/catch, loop, if/else, switch, callbacks)
  traverse.js                    Innermost-first function collection and body processing
  wrapper.js                     Top-level IIFE extraction from comma chains
  pipeline.js                    20-step pipeline orchestration, output writing
  passes/
    simplify.js                  Constant folding, boolean, string, short-circuit, syntax normalization
    dead-code.js                 Dead code elimination, unused helper removal, DATA separation
    inline.js                    Property inlining, wrapper inlining, single-caller inlining
    declarations.js              Hoisting, reserved-word sanitization, alert annotation, call-tree sorting
    index.js                     Re-exports all pass modules
  structure/
    analyze.js                   AST analysis, domain classification, function categorization, caching
    report.js                    Markdown/prompt generation, reading guide
    index-gen.js                 Compact index.txt generation
    tier.js                      Tier filtering (1=alerts, 2=+callees, 3=all)
    cross-file.js                Multi-file summary and cross-readme
    index.js                     Re-exports all structure modules
  types/                         TypeScript declarations (.d.ts) — no runtime code
    index.d.ts                   Entry point, re-exports all types
    config.d.ts                  DeobConfig, DenoiseRule, Severity
    analysis.d.ts                FunctionMeta, Alert, StructureReport, Summary
    ast.d.ts                     ASTNode, ExtractResult, PassFunction, BodyHint
    constants.d.ts               AlertPattern, Thresholds, OutputFiles, Category
    passes.d.ts                  All 18 pass function signatures
  metrics.js                     Before/after readability metrics, HTML report
  index.js                       Public API re-export
```

## Pipeline Steps

| Step | Pass | Module | Description |
|------|------|--------|-------------|
| 0 | `sanitizeReservedWords` | declarations.js | Rename reserved-word identifiers (let, default, delete…) |
| 1 | `processAllFunctions` | traverse.js | Collect all function nodes, process innermost-first |
| 2 | `extractTopLevelIIFEs` | wrapper.js | Extract top-level IIFEs from comma chains |
| 3 | `hoistDeclarations` | declarations.js | Import→top, export→bottom; var/let/const/fn to top of scope |
| 4 | `extractInlineFunctions` | inline.js | Lift embedded function expressions to top level |
| 5 | `simplify` | simplify.js | Constant folding + boolean + string + hex normalization |
| 6 | `normalizeShortCircuit` | simplify.js | Convert `A \|\| B` to `if (!A) { B }` |
| 7 | `expandSequences` | simplify.js | Break comma chains `(a, b, c)` into independent statements |
| 8 | `normalizeShortCircuit` | simplify.js | Re-normalize after expansion |
| 9 | `eliminateDeadCode` | dead-code.js | Remove unreachable statements, `if(false)` branches |
| 10 | `inlineReadOnlyProperties` | inline.js | Replace `cfg.PROP` with its literal value |
| 10b | `inlineConstObjects` | simplify.js | Replace `cfg.timeout` with `5000` when cfg is const object |
| 11 | `removeUnusedHelpers` | dead-code.js | Delete function declarations that are never referenced |
| 12 | `simplifyRedundantConditions` | simplify.js | `if(a) return true; return false` → `return !!a` |
| 13 | `inlinePureWrappers` | inline.js | Remove functions that are just `return call(args)` |
| 14 | `sortByCallTree` | declarations.js | Topological sort: callees before callers |
| 15 | `inlineSingleCallerFns` | inline.js | Inline functions called from exactly one place |
| 16 | `normalizeSyntax` | simplify.js | `~arr.indexOf` → `arr.includes`, `~~x` → `Math.trunc` |
| 17 | `extractInlineFunctions` | inline.js | Re-extract exposed inline functions after transforms |
| 18 | `annotateAlerts` | declarations.js | Inject `[Label]` comments for security-relevant patterns |
| 19 | `sanitizeReservedWords` | declarations.js | Re-sanitize (pipeline may have introduced new reserved words) |
| 20 | `pushDataToBottom` | dead-code.js | Move DATA-heavy functions to end of file with separator |

## Data Flow

```
input.js
  │
  ├─ parser.parse(code)           → AST (Babel)
  │
  ├─ processAllFunctions(ast)     → extract sub-functions from nested scopes
  ├─ extractTopLevelIIFEs(ast)    → extract top-level IIFE wrappers
  │
  ├─ 18 transformation passes     → mutate AST in place
  │
  ├─ generate(ast)                → output code string
  ├─ write main.js
  │
  ├─ analyzeStructure(main.js)    → re-parse, build function metadata
  │   ├─ complexity, call edges, alerts, semantic tags
  │   ├─ domain classification
  │   └─ function categorization
  │
  ├─ generatePromptFile()         → 0-prompt.md
  ├─ generateMarkdown()           → 1-structure.md
  └─ generateIndex()              → 2-index.txt
```

## Module Responsibilities

### config.js — User-Facing Config
**Does**: Expose parser, t, generate, fs, path, DEFAULT_DENOISE
**Does not**: Contain internal constants (those are in constants.js)

### constants.js — Internal Constants
**Does**: Expose RESERVED, GLOBALS, ALERT_PATTERNS, SKIP_KEYS, SUB_FN_PREFIX, SUB_FN_NAME_RE, isSubFn, DEFAULT_PARSER_OPTS, JSX_PARSER_OPTS, DEFAULT_GENERATE_OPTS, OUTPUT_FILES, THRESHOLDS, CATEGORIES, SEVERITY, NAMING_*, DOMAIN_RULES, CATEGORY_RULES, FRAMEWORK_PATTERNS
**Does not**: Contain any logic or transformation code

### ast-utils.js — Generic AST Helpers
**Does**: walkAST, walkASTDeep, walkStmtLists, isIIFE, describeBody, clone, hasBail, hasReturn, containsAwait, containsYield
**Does not**: Transform AST, know about _S_ naming, contain pass logic

### scope.js — Variable Scope Analysis
**Does**: collectDefined, collectBindingNames, getExternalRefs
**Does not**: Modify AST, know about extraction or naming

### naming.js — Sub-function Naming
**Does**: subName (with collision detection), getFnName, cleanName, resetNames
**Does not**: Create AST nodes, walk AST

### emit.js — AST Node Creation
**Does**: createSubFn, addLineComment, safeParam
**Does not**: Walk AST, make pass decisions

### extract.js — Syntactic Extraction
**Does**: processBody, tryExtract (IIFE/try/catch/loop/if/else/switch/callbacks), processNestedInStmt, tryExtractVarIIFE
**Does not**: Simplify expressions, inline functions, sort output

### traverse.js — Function Collection
**Does**: processAllFunctions (innermost-first collection and body processing)
**Does not**: Contain extraction logic directly

### wrapper.js — Top-level IIFE Extraction
**Does**: extractTopLevelIIFEs (from comma chains)
**Does not**: Handle nested IIFEs, simplify expressions

### pipeline.js — Orchestration
**Does**: 20-step pipeline sequencing, output writing, split output
**Does not**: Contain any transformation logic itself

### passes/simplify.js — Expression Simplification
**Does**: simplify (fold+bool+string+hex), normalizeShortCircuit, expandSequences, simplifyRedundantConditions, normalizeSyntax, inlineConstObjects
**Does not**: Inline functions, sort output, annotate alerts

### passes/dead-code.js — Dead Code Removal
**Does**: eliminateDeadCode, removeUnusedHelpers, pushDataToBottom
**Does not**: Simplify expressions, inline anything

### passes/inline.js — Function Inlining

**Does**: inlineReadOnlyProperties, inlinePureWrappers, inlineArithmeticWrappers, inlineSingleCallerFns, extractInlineFunctions
**Does not**: Sort output, annotate alerts

### passes/declarations.js — Declaration Management
**Does**: hoistDeclarations, sanitizeReservedWords, annotateAlerts, sortByCallTree
**Does not**: Inline functions, simplify expressions

### structure/analyze.js — Core Analysis
**Does**: analyzeStructure, classifyDomain, categorizeFn, detectMechanical, detectParamRoles, detectSemanticTags, describeFn, computeAlertTraces, computeDensity, generateTLDR
**Does not**: Generate output files, modify AST

### structure/report.js — Report Generation
**Does**: generateMarkdown, generatePromptFile, generateReadingGuide, runStructure
**Does not**: Analyze AST, classify functions

### structure/index-gen.js — Index Generation
**Does**: generateIndex (compact text-based function catalog)
**Does not**: Generate Markdown, analyze AST independently

### structure/tier.js — Tier Filtering
**Does**: applyTierFilter (1=alerts, 2=+callees, 3=all)
**Does not**: Analyze AST, generate reports

### structure/cross-file.js — Multi-file Reports
**Does**: generateCrossSummary, writeCrossReadme, classifyFileType
**Does not**: Analyze individual files

## Code Conventions

### Naming

| Kind | Convention | Example |
|------|-----------|---------|
| Functions | `camelCase`, verb-first | `walkAST`, `inlinePureWrappers` |
| Constants | `UPPER_SNAKE_CASE` | `RESERVED`, `ALERT_PATTERNS` |
| Variables | `camelCase`, concise | `fns`, `stmts`, `count`, `i` |
| Private state | `_` prefix | `_analysisCache`, `_inlineUsedNames` |
| AST sentinels | `$$` prefix | `$$refW` |
| Booleans | `is/has/can` prefix | `isData`, `hasReturn`, `canInline` |

Function naming patterns:
```
detectX(body)         ← detect pattern, return boolean
collectX(node)        ← walk AST, collect into array
inlineX(ast)          ← transform AST in place
generateX(report)     ← produce output string
classifyX(filepath)   ← categorize, return label
computeX(data)        ← calculate numeric value
```

### Module Structure

Every file follows this order:
1. Imports (`const { x } = require("../module")` at top)
2. Section headers (`// ---- Title ----`)
3. Function definitions
4. Single `module.exports = { ... }` at bottom

Index files use spread re-export:
```js
const sub = require("./sub");
module.exports = { ...sub };
```

### AST Walking

Standard walk (read-only):
```js
function walk(node) {
  if (!node || typeof node !== "object") return;
  // ... process node ...
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const val = node[key];
    if (Array.isArray(val)) { for (const v of val) walk(v); }
    else if (val && typeof val.type === "string") walk(v);
  }
}
```

Transform walk (replaces nodes):
```js
function walk(node) {
  if (!node || typeof node !== "object") return node;
  // ... pattern checks returning replacement nodes ...
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) val[i] = walk(val[i]);
    } else if (val && typeof val.type === "string") {
      node[key] = walk(val);
    }
  }
  return node;
}
```

### Error Handling

| Context | Strategy |
|---------|----------|
| Parse errors | try/catch → fallback to JSX, then regex analysis |
| File errors (batch) | try/catch → log SKIPPED, continue |
| File errors (single) | try/catch → log ERROR, exit(1) |
| Invalid config | `console.error` + `process.exit(1)` |
| Invalid regex in denoise | silently skip |

### Comments

```js
// ---- Section Title ----              ← top-level section divider
// --- Pattern Description ---           ← inline pattern label within a walk
// ==================== Phase Name ===   ← pipeline phase divider
// Reason for disabling                  ← commented-out code with reason
```

### Logging

Pass results: `console.log("  Verb count noun")` — 2-space indent
Pipeline steps: `console.log("Step N: Description...")` — numbered
Timing: `const t = Date.now(); ... console.log("  Done in ${Date.now()-t}ms")`

### Performance

- Use `Map` and `Set` for lookups, not `Array.includes()` or `Array.find()`
- Cache expensive computations (e.g., `analyzeStructure` result)
- Use iterative walks for large files (>100KB) to avoid stack overflow
- Profile with `Date.now()` timing in pipeline steps

## Alert System

### Three Detection Layers

1. **String-based** (ALERT_PATTERNS in config.js): regex scan of string literals in function bodies
2. **AST-based** (annotateAlerts / analyzeStructure): detect debugger, eval(), new Function() via AST node types
3. **Denoise** (DEFAULT_DENOISE / user config): downgrade false-positive alerts by regex matching

### Flow

```
annotateAlerts (step 18)
  ├─ scanStringLiterals: ALERT_PATTERNS regex → matches[]
  ├─ scanAST: DebuggerStatement, eval(), new Function() → matches[]
  └─ add leadingComments to function node

analyzeStructure (post-pipeline)
  ├─ scanStringLiterals: same ALERT_PATTERNS → alerts[]
  ├─ scanAST: same patterns → alerts[]
  ├─ denoise: DEFAULT_DENOISE rules → downgrade severity/label
  └─ alerts[] → prompt, structure, index
```

### Adding a New Alert Pattern

1. Add to `ALERT_PATTERNS` in `config.js`:
   ```js
   { label: "My Pattern", regex: /\b(?:keyword1|keyword2)\b/gi, severity: "high" }
   ```
2. Both `annotateAlerts` and `analyzeStructure` will pick it up automatically
3. Add denoise rule if it produces false positives:
   ```js
   { match: "context-pattern", label: "False Positive Label", severity: "info" }
   ```

### Severity Levels

| Level | Meaning | Example |
|-------|---------|---------|
| `critical` | Immediate security concern | eval(), new Function() |
| `high` | Likely security-relevant | API endpoints, crypto, fingerprints |
| `medium` | Potentially interesting | Storage, DOM sinks, network |
| `low` | Informational | Config fields |
| `info` | No concern, denoised | Namespace URIs, static files |

## Function Categories

Functions are categorized by `categorizeFn` in structure/analyze.js, using `CATEGORY_RULES` and `FRAMEWORK_PATTERNS` from constants.js:

| Category | Source | Example |
|----------|--------|---------|
| `data` | heavyHex flag | Large hex string arrays |
| `core` | Not `_S_` prefix | Original function names |
| `framework` | `FRAMEWORK_PATTERNS` | Vue/React/Regenerator internals |
| `network` | `CATEGORY_RULES` | fetch/xhr/axios patterns |
| `crypto` | `CATEGORY_RULES` | sign/encrypt/hash patterns |
| `websocket` | `CATEGORY_RULES` | WebSocket patterns |
| `parser` | `CATEGORY_RULES` | yaml/parser patterns |
| `i18n` | `CATEGORY_RULES` | i18n/translate patterns |
| `polyfill` | `CATEGORY_RULES` | core-js/ToPrimitive patterns |
| `filesystem` | `CATEGORY_RULES` | fs/readFile patterns |
| `boilerplate` | `CATEGORY_RULES` | __esModule/defineProperty |
| `timer` | Behavioral desc | setTimeout/setInterval |
| `construct` | Behavioral desc | factory/construct |
| `delegate` | Behavioral desc | pass-through/returns arg |
| `callback` | Name pattern | `_S_return_*` |
| `branch` | Name pattern | `_S_*_if/_else/_try/_catch` |
| `other` | Fallback | Uncategorized |

## Domain Classification

`classifyDomain` in structure/analyze.js uses `DOMAIN_RULES` from constants.js. Each rule is `{ tag, regex, exclusive?, extra?, exclude?, minCount? }`.

Simple rules are applied via a loop. Compound rules (Network, API Router, Eval-heavy) have special logic.

### Adding a New Domain Rule

In `constants.js`, add to `DOMAIN_RULES`:

```js
{ tag: "MyDomain", regex: /\bmyPattern\b/ },
```

Modifiers:
- `exclusive: true` — skip if another rule already matched (e.g., webpack chunk vs bundle)
- `extra: /regex/` — only match if this additional regex also matches (e.g., CommonJS needs `require()`)
- `exclude: /regex/` — skip if this regex matches (e.g., Protobuf excludes TextEncoder)
- `minCount: N` — only match if regex matches more than N times (e.g., Event-driven needs >3)

### Adding a New Function Category Rule

In `constants.js`, add to `CATEGORY_RULES`:

```js
{ category: "mycategory", regex: /\b(keyword1|keyword2)\b/i },
```

For framework-specific detection, add to `FRAMEWORK_PATTERNS`:

```js
/\b(MyFramework\b.*\binternal|__MY_FRAMEWORK__)\b/,
```

## Adding a New Pass — Complete Example

### 1. Write the pass function

In `scripts/passes/simplify.js`:

```js
// ---- inlineConstObjects: replace obj.prop with literal value ----
function inlineConstObjects(ast) {
  let count = 0;
  // Phase 1: find const object declarations
  // Phase 2: check no mutations
  // Phase 3: replace references
  // ... implementation ...
  console.log(`  Inlined ${count} const object properties`);
}

module.exports = {
  // ... existing exports ...
  inlineConstObjects,
};
```

### 2. Register in pipeline.js

```js
// Import
const { ..., inlineConstObjects } = require("./passes");

// Add step (between existing steps)
console.log("Step 10b: Inlining const object properties...");
const t10b = Date.now();
inlineConstObjects(ast);
console.log(`  Done in ${Date.now() - t10b}ms`);
```

### 3. Test

```bash
echo 'var cfg={timeout:5000}; function f(){return cfg.timeout}' > test.js
deob -c test.config.js
# Verify: cfg.timeout → 5000 in output
```

### 4. Commit

```bash
git add -A && git commit -m "feat: inlineConstObjects — replace obj.prop with literal value"
```

## Debugging

### Pass not working as expected

1. Add `console.log` inside the pass to inspect AST state
2. Run with a minimal test file that triggers the pattern
3. Check `main.js` output to see if the transform applied

### Pipeline crash

1. Check the error message — it shows which step failed
2. The error is in the pass function, not pipeline.js
3. Use `try/catch` in the pass to get better error messages

### Output differs between runs

1. Check for global mutable state (`_inlineUsedNames`, `_analysisCache`)
2. Ensure `resetNames()` and `resetInlineNames()` are called per file
3. Check regex `lastIndex` state on shared `ALERT_PATTERNS`

### Alert not showing up

1. Check if the pattern matches a **string literal** (not identifier)
2. For AST-based alerts, check if the node type matches
3. Check if denoise rules are downgrading it to `info`

## Common Pitfalls

| Pitfall | Cause | Solution |
|---------|-------|----------|
| Stack overflow on large files | Recursive AST walk | Use iterative walk (stack-based) |
| Name collisions | Global counter reset | Use `_S_` + line number + collision detection |
| Regex state bugs | `ALERT_PATTERNS` with `g` flag | Always reset `lastIndex` after use |
| Triple re-parse | `analyzeStructure` called 3x | Use `_analysisCache` (already implemented) |
| Reserved words in output | Pipeline introduces new ones | Step 19 re-sanitizes |
| `!![]` not simplified | Boolean pass runs before expansion | Step 8 re-normalizes after expansion |
| Comments crash generator | CommentLine in program body | Filter non-statements before generate |

## Anti-Overfitting Rules

1. Every optimization must be **general-purpose**, not tailored to one test file
2. Test against **all** existing samples after each change
3. Prefer **regex patterns** over hardcoded values
4. Prefer **AST patterns** over string matching
5. Document the **why** behind each pattern
6. Never optimize for a single test file
7. If a fix only helps one file, it's not worth merging
