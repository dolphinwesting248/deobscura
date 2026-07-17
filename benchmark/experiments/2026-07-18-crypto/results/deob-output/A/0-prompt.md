You are analyzing deobfuscated JavaScript from `main.js`. The preprocessor already determined:

## Architecture
- 6 functions (2 original, 4 extracted)
- Domain: **General JS**
- 0 flattened, 0 suspicious patterns, max complexity 6
- Code density: 99% active code, 1% data/other
- **String decoder**: `a0_0x4bc7` — self-modifying lookup, called by 2 functions. Strings are NOT yet decoded — you will see opaque calls like `_0x13f90f(0x1818)`.
- **Entry point**: `a0_0x2cbd` → a0_0x4bc7, _S_a0_0x2cbd_04_if
- **Closure captures**: 20 variables captured by 2 functions
- **Shared variables**: a0_0x2cbd (11 functions), _0x2c41d4 (9 functions), _0x136049 (5 functions), _0x3179c9 (5 functions), _0x56adb6 (5 functions)

## Alerts (0 significant)
_No significant security alerts detected._


## Start Here (top 5 by interest score)
_Function: name | Ss/Pp | cc=N → callees ⇐ callers | tags — description_
1. `_S__0x56a3ce_0_fn` | 5S/undefinedP | cc=6 [cc=6] — calls → decodeURIComponent
2. `_S_program_loop_body_l116` | 3S/undefinedP | cc=4 [core] — void, 3S; callback-driven [module-init]
3. `a0_0x2cbd` | 9S/undefinedP | cc=3 → a0_0x4bc7, _S_a0_0x2cbd_04_if root [core] — returns arg
4. `a0_0x4bc7` | 3S/undefinedP | cc=1 → a0_0x4bc7 ⇐ a0_0x2cbd, a0_0x4bc7 [core] — calls → a0_0x4bc7 [self-modifying, table-init]
5. `_S_a0_0x2cbd_04_if` | 4S/undefinedP | cc=1 ⇐ a0_0x2cbd [core] — void, 4S; side-effects

## Skip
0 pass-through functions (zero logic). See `2-index.txt` for full function catalog.

## Reading Path
1. **This file** (0-prompt.md) — architecture, alerts, top 5 functions to start with
2. **1-structure.md** — call graph, hotspots, full alert traces, naming convention
3. **2-index.txt** — function catalog with line numbers → jump to `main.js`
