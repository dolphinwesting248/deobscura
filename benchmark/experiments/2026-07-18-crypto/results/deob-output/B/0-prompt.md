You are analyzing deobfuscated JavaScript from `main.js`. The preprocessor already determined:

## Architecture
- 13 functions (2 original, 11 extracted)
- Domain: **General JS**
- 0 flattened, 0 suspicious patterns, max complexity 8
- Code density: 97% active code, 3% data/other
- **String decoder**: `a0_0x522f` — self-modifying lookup, called by 2 functions. Strings are NOT yet decoded — you will see opaque calls like `_0x13f90f(0x1818)`.
- **Entry point**: `a0_0x2c22` → a0_0x522f, _S_a0_0x2c22_04_if, _S_a0_0x2c22_06_if, _S_a0_0x2c22_06_else
- **Closure captures**: 23 variables captured by 3 functions
- **Shared variables**: _0x47fe44 (9 functions), _0x1849d1 (9 functions), a0_0x2c22 (5 functions), a0_0x522f (2 functions), _0x77e496 (2 functions)

## Alerts (0 significant)
_No significant security alerts detected._


## Start Here (top 5 by interest score)
_Function: name | Ss/Pp | cc=N → callees ⇐ callers | tags — description_
1. `_S__0xb26418_0_fn` | 8S/undefinedP | cc=8 [cc=8] — calls → decodeURIComponent
2. `_S_program_loop_body_l168` | 3S/undefinedP | cc=4 [core] — void, 3S; callback-driven [module-init]
3. `a0_0x2c22` | 9S/undefinedP | cc=3 → a0_0x522f, _S_a0_0x2c22_04_if, _S_a0_0x2c22_06_if, _S_a0_0x2c22_06_else root [core] — returns arg
4. `_S_a0_0x2c22_06_if` | 7S/undefinedP | cc=2 ⇐ a0_0x2c22 [core] — void, 7S; side-effects
5. `_S_return_1_fn` | 5S/undefinedP | cc=2 ⇐ _S_program_declare_fn_l190 [core] — returns arg

## Skip
0 pass-through functions (zero logic). See `2-index.txt` for full function catalog.

## Reading Path
1. **This file** (0-prompt.md) — architecture, alerts, top 5 functions to start with
2. **1-structure.md** — call graph, hotspots, full alert traces, naming convention
3. **2-index.txt** — function catalog with line numbers → jump to `main.js`
