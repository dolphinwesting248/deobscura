// Internal constants — not user-facing config.
// User-facing config (ALERT_PATTERNS, DEFAULT_DENOISE, GLOBALS, RESERVED) stays in config.js.

// ---- AST Walking ----
const SKIP_KEYS = new Set([
  "start", "end", "loc",
  "leadingComments", "trailingComments", "innerComments",
]);
const SKIP_KEYS_LIST = ["start", "end", "loc", "leadingComments", "trailingComments", "innerComments"];

// ---- Sub-function Naming ----
const SUB_FN_PREFIX = "_S_";
const SUB_FN_NAME_RE = /^_S_(.+?)_\d{2}_/;
const isSubFn = (name) => name.startsWith(SUB_FN_PREFIX);

// ---- Parser & Generator ----
const DEFAULT_PARSER_OPTS = {
  sourceType: "script",
  allowReturnOutsideFunction: true,
  allowUndeclaredExports: true,
  errorRecovery: true,
};
const JSX_PARSER_OPTS = {
  ...DEFAULT_PARSER_OPTS,
  plugins: ["jsx", "typescript"],
};
const DEFAULT_GENERATE_OPTS = {
  retainLines: false,
  retainFunctionParens: false,
  comments: true,
  compact: false,
};

// ---- Output Files ----
const OUTPUT_FILES = {
  MAIN: "main.js",
  PROMPT: "0-prompt.md",
  STRUCTURE: "1-structure.md",
  INDEX: "2-index.txt",
  METRICS: "metrics.html",
  SUMMARY: "summary.md",
};

// ---- Thresholds ----
const THRESHOLDS = {
  // DATA detection
  DATA_STRING_LEN: 400,
  BIG_COLLECTION: 20,
  HEX_DENSITY: 0.2,
  HUGE_LINE_LEN: 2000,
  HUGE_LINE_DENSITY: 0.1,
  // Complexity
  COMPLEXITY_HIGH: 10,
  // Display
  DISPLAY_LIMIT: 5,
  ALERT_DISPLAY_LIMIT: 10,
  // Naming
  MAX_NAME_LEN: 40,
  SEQ_PAD_WIDTH: 2,
  // Hex normalization
  HEX_NORM_MAX: 65536,
  // Semantic tag detection
  PROP_SETTER_THRESHOLD: 5,
  BUILD_COUNT_THRESHOLD: 2,
  EVENT_LISTENER_THRESHOLD: 3,
  EVAL_THRESHOLD: 5,
  // Inline wrappers
  ARITH_WRAPPER_MAX_IDENTS: 6,
  ARITH_WRAPPER_MAX_PARAMS: 3,
  // Dead code
  DEAD_CODE_PASSES: 5,
  SIMPLIFY_PASSES: 10,
  // Interest score
  ALERT_SCORE_MULTIPLIER: 3,
  // Hot function
  HOT_THRESHOLD: 10,
  // Lookup
  LOOKUP_WORD_CAP: 80,
  // Comment proximity
  COMMENT_PROXIMITY: 200,
};

// ---- Categories ----
const CATEGORIES = [
  "data", "core", "framework", "network", "websocket", "crypto",
  "parser", "i18n", "polyfill", "filesystem", "timer", "construct",
  "delegate", "varargs", "boilerplate", "callback", "branch", "dynamic", "other",
];

// ---- Category Display Labels ----
const CATEGORY_LABELS = {
  data: "Data Tables",
  core: "Core Functions",
  framework: "Framework Internals",
  network: "Network / HTTP",
  websocket: "WebSocket",
  crypto: "Crypto / Signing",
  parser: "Parser / Decoder",
  i18n: "Internationalization",
  polyfill: "Polyfills",
  filesystem: "File System",
  timer: "Timers",
  construct: "Factories",
  delegate: "Delegates",
  varargs: "Varargs",
  boilerplate: "Boilerplate",
  callback: "Callbacks",
  branch: "Branches",
  dynamic: "Dynamic Eval",
  other: "Other",
};

// ---- Severity ----
const SEVERITY = ["critical", "high", "medium", "low", "info"];

// ---- Naming Convention ----
const NAMING_FORMAT = "_S_<parent>_<seq>_<hint>";
const NAMING_COLLISION = "_S_<parent>_L<line>_<seq>_<hint>";
const NAMING_EXAMPLES = [
  { name: "_S_0x28bed7_01_try", meaning: "Extracted from function 0x28bed7, seq 01, try body" },
  { name: "_S_constructor_07_if", meaning: "Extracted from method 'constructor', seq 07, if branch" },
  { name: "_S_l100877_03_try", meaning: "Anonymous parent at line 100877, seq 03, try body" },
  { name: "_S_return_1_fn", meaning: "Inline function lifted from a return statement" },
  { name: "_S_l251_L1364_01_try", meaning: "Collision: same parent+seq+hint, disambiguated by source line" },
];
const NAMING_HINTS = {
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
  fn: "inline function",
};

module.exports = {
  // AST
  SKIP_KEYS,
  SKIP_KEYS_LIST,
  // Naming
  SUB_FN_PREFIX,
  SUB_FN_NAME_RE,
  isSubFn,
  // Parser/Generator
  DEFAULT_PARSER_OPTS,
  JSX_PARSER_OPTS,
  DEFAULT_GENERATE_OPTS,
  // Output
  OUTPUT_FILES,
  // Thresholds
  THRESHOLDS,
  // Categories
  CATEGORIES,
  CATEGORY_LABELS,
  // Severity
  SEVERITY,
  // Naming docs
  NAMING_FORMAT,
  NAMING_COLLISION,
  NAMING_EXAMPLES,
  NAMING_HINTS,
};
