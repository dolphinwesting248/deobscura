# Tiered Output

When feeding deobfuscated code to an LLM, most functions are noise. A vendor.js with 2000 functions might have only 200 that matter for reverse engineering — the rest are polyfills, pure computations, forwarding wrappers, or dead utilities.

`tier` controls **which functions get full code**. `fold` controls **how the rest are compressed**.

## tier

| Value | Behavior |
|-------|----------|
| `3` | All functions, full code. No filtering. |
| `2` | Signal functions + all functions they call (transitive closure). Rest get signatures. |
| `1` | Signal functions only. Rest get signatures. |

### What counts as a "signal function"?

A function is kept if it has any of:

| Signal | Meaning |
|--------|---------|
| **Alert** | Contains strings matching API endpoints, tokens, crypto, eval, etc. |
| **Most-called** | Top 10 functions by incoming call count |
| **Root** | Entry point — not called by anyone, but calls others |
| **Flattening** | Contains `while`/`for` + `switch` (control flow flattening) |
| **High complexity** | Cyclomatic complexity > 10 |
| **Suspicious** | `eval(var)`, `new Function()`, computed keys, `arguments[i]`, `__proto__` |

### Non-signal functions: signature mode

Functions not in the keep set are reduced to their signature + a stub body. The call graph stays intact — every `_0x_xxx(...)` call still resolves to a named function with visible parameters.

```javascript
// Kept (signal function — has API endpoint alert)
function _0x_send(url, token) {
  var xhr = new XMLHttpRequest();
  xhr.open("POST", "https://api.example.com/v2/verify");
  xhr.setRequestHeader("Authorization", "Bearer " + token);
  xhr.send(token);
}

// Reduced (non-signal — keeps signature, drops body)
function _0x_getConfig() { /* L51-56 */ }
```

## fold

When `fold: true`, non-signal functions are scanned for three mechanical patterns. Matches get collapsed to a single comment line instead of keeping the signature.

| Pattern | Detection | Example stub |
|---------|-----------|--------------|
| **Pure forward** | Body is a single `return target(args)` where args exactly match the parameter list | `// [forward] _0x_wrap · L46-48 · → _0x_sign` |
| **Pure computation** | Body contains zero `CallExpression` nodes (no function calls at all) and has ≤5 statements | `// [pure computation] _0x_add_mod · L75-79 · 3 stmts, cc=1` |
| **Self-contained** | All identifiers in body are either parameters, locally declared, or built-in globals | `// [closed] _0x_clamp · L93-97 · self-contained, cc=1` |

These patterns are safe to collapse because the function does not interact with the rest of the codebase — its behavior is fully determined by its parameters.

## Behavior Matrix

| tier | fold | Signal functions | Non-signal, not mechanical | Non-signal, mechanical |
|------|------|-----------------|---------------------------|----------------------|
| 3 | — | Full code | Full code | Full code |
| 2 | false | Full code | Signature | Signature |
| 2 | true | Full code | Signature | `// [type] name · ...` |
| 1 | false | Full code | Signature | Signature |
| 1 | true | Full code | Signature | `// [type] name · ...` |

## Choosing Parameters

### By task

```
Quick recon of an unknown file   →  tier: 1
Trace a specific call chain      →  tier: 2
Cram into a small context window →  tier: 1, fold: true
Full audit, no token concern     →  tier: 3
```

### tier 1 vs tier 2

```
Does the LLM need to see the implementation of
functions called by signal functions?
    │
    ├── Yes → tier: 2 (e.g. tracing a signing algorithm end-to-end)
    │
    └── No  → tier: 1 (e.g. identifying which functions touch the network)
```

In practice, start with `tier: 1`. If the LLM reports that call chains are broken or can't follow the logic, re-run with `tier: 2`.

### When to enable fold

`fold: true` is a safe default. The detection is conservative — it only collapses functions that are provably self-contained. There is no risk of hiding a function that calls into the rest of the codebase.

The only reason to leave it `false` is if you want the LLM to see every function signature for completeness, even for pure computations. This is rare.

## Output Size Comparison

Approximate, based on real vendor.js files (2000+ functions):

| Config | Full functions | Signatures | Folded | Token estimate |
|--------|---------------|------------|--------|---------------|
| `tier: 3` | 2000 | 0 | 0 | 100% |
| `tier: 1` | ~200 | ~1800 | 0 | ~30% |
| `tier: 1, fold: true` | ~200 | ~1400 | ~400 | ~25% |
| `tier: 2` | ~400 | ~1600 | 0 | ~40% |
| `tier: 2, fold: true` | ~400 | ~1200 | ~400 | ~35% |

## Interaction with `md` and `index`

Tier filtering runs *before* report generation. Both `structure.md` and `index.txt` are built from the filtered `main.js`, so they always reflect the same view of the code.

| Config | structure.md / index.txt content |
|--------|----------------------------------|
| `tier: 3, md: true, index: true` | Full analysis — all functions present in both reports |
| `tier: 1, md: true, index: true` | Signal functions analyzed normally; non-signal functions appear as signatures (`{ /* L32-36 */ }`) with no body content |
| `tier: 1, fold: true, md: true, index: true` | Folded mechanical functions appear as comment stubs (`// [pure computation] …`). Call graph edges to them are dangling. **Recommendation: skip index when using fold mode.** |

### Cross-file summaries in directory mode

When input is a directory, tier filtering applies *per-file*. The cross-file `summary.md` aggregates results from all filtered files. Proxy files (re-exports, empty modules) and single-function files are distinguished in the type column.

### Recommendation

| Goal | Config |
|------|--------|
| Full analysis + LLM navigation | `tier: 3, md: true, index: true` |
| Signal-focused with navigation | `tier: 1, md: true, index: true` |
| Signal-focused, minimal token | `tier: 1, fold: true, md: true` (skip index) |
| Single file, code only (no reports) | `tier: 1, fold: true` (or omit md/index) |

## Config Example

```javascript
module.exports = {
  input: "vendor.js",
  tier: 1,         // signals only
  fold: true,      // collapse mechanical functions
  md: true,        // structure report for LLM orientation
  index: false,    // skip index when folding (edges would be incomplete)
};
```
