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
  config.js                      Shared constants: parser, t, generate, fs, path,
                                 GLOBALS, RESERVED, ALERT_PATTERNS, DEFAULT_DENOISE
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

### config.js — Shared Constants
**Does**: Expose parser, t, generate, fs, path, GLOBALS, RESERVED, ALERT_PATTERNS, DEFAULT_DENOISE
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

Functions are categorized by `categorizeFn` in structure/analyze.js:

| Category | Detection Method | Example |
|----------|-----------------|---------|
| `data` | heavyHex flag | Large hex string arrays |
| `core` | Not `_S_` prefix | Original function names |
| `framework` | Vue/React/Regenerator patterns | Framework internals |
| `network` | fetch/xhr/axios patterns | HTTP client code |
| `crypto` | sign/encrypt/hash patterns | Cryptographic operations |
| `websocket` | WebSocket patterns | WS connection code |
| `parser` | yaml/parser patterns | Data parsing |
| `i18n` | i18n/translate patterns | Internationalization |
| `polyfill` | core-js/ToPrimitive patterns | ES polyfills |
| `filesystem` | fs/readFile patterns | File operations |
| `timer` | setTimeout/setInterval | Timer callbacks |
| `construct` | factory/construct desc | Factory functions |
| `delegate` | pass-through/returns arg | Forwarding functions |
| `boilerplate` | __esModule/defineProperty | Webpack boilerplate |
| `callback` | `_S_return_*` names | Extracted callbacks |
| `branch` | `_S_*_if/_else/_try/_catch` | Extracted branches |
| `other` | None of the above | Uncategorized |

## Domain Classification

`classifyDomain` in structure/analyze.js detects:

| Domain | Patterns |
|--------|----------|
| rspack/webpack chunk | `self.webpackChunk` |
| webpack bundle | `__webpack_require__` |
| turbopack runtime | `TURBOPACK` |
| CommonJS | `module.exports` + `require()` |
| AMD | `define(` |
| Vue | `__VUE__`, `vue.*reactive` |
| React | `__REACT_DEVTOOLS_GLOBAL_HOOK__` |
| Angular | `__ANGULAR__`, `@NgModule` |
| Svelte | `__svelte` |
| Next.js | `__NEXT_DATA__` |
| Nuxt | `__nuxt` |
| Node.js | `process.` (non-env) |
| DOM manipulation | innerHTML/createElement/querySelector |
| Event-driven | addEventListener (>3 occurrences) |
| Network | fetch+URL or axios |
| Crypto | sign/encrypt/hash |
| Signing | sign/xhsSign patterns |
| API Router | >5 `/api/` paths |
| Protobuf | protobufjs/.encode() (excluding TextEncoder) |
| WebSocket | websocket/socket.io |
| Graphics | WebGL/getContext("2d") |
| Prototype-patched | `prototype.x = ` |
| Polyfill/Core-JS | ToPrimitive/OrdinaryToPrimitive |
| Eval-heavy | >5 eval() calls |

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

## Adding a New Domain Classification

In `structure/analyze.js`, `classifyDomain`:

```js
// Add BEFORE generic checks (framework before "Browser DOM")
if (/\bmyFramework\b/.test(src)) tags.push("MyFramework");
```

Rules:
- Place specific checks before generic ones
- Use multiple patterns for reliability
- Test against multiple sites to avoid overfitting

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
