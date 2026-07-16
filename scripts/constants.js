// Internal constants — not user-facing config.
// User-facing config (DEFAULT_DENOISE) stays in config.js.

// ---- Reserved words that cannot be parameter/identifier names ----
const RESERVED = new Set([
  "break", "case", "catch", "continue", "debugger", "default", "delete",
  "do", "else", "finally", "for", "function", "if", "in", "instanceof",
  "new", "return", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with", "class", "const", "enum", "export", "extends",
  "import", "super", "implements", "interface", "let", "package",
  "private", "protected", "public", "static", "yield", "await", "async",
]);

// ---- Globals not requiring parameter passing ----
const GLOBALS = new Set([
  // Built-in objects
  "Object", "Array", "String", "Number", "Boolean", "Function", "Symbol",
  "Map", "Set", "WeakMap", "WeakSet", "Promise", "Proxy", "Reflect",
  "Math", "Date", "RegExp", "Error", "TypeError", "RangeError",
  "SyntaxError", "ReferenceError", "URIError", "EvalError", "AggregateError",
  "parseInt", "parseFloat", "isNaN", "isFinite",
  "NaN", "Infinity", "undefined", "null", "true", "false",
  // Runtime
  "console", "window", "global", "globalThis", "self", "process", "Buffer",
  "setTimeout", "setInterval", "clearTimeout", "clearInterval",
  "requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask",
  // Encoding
  "decodeURI", "encodeURI", "decodeURIComponent", "encodeURIComponent",
  "atob", "btoa", "TextEncoder", "TextDecoder",
  // Collections & buffers
  "JSON", "Intl", "ArrayBuffer", "DataView", "SharedArrayBuffer",
  "Uint8Array", "Int8Array", "Uint16Array", "Int16Array",
  "Uint32Array", "Int32Array", "Float32Array", "Float64Array",
  "BigInt64Array", "BigUint64Array", "BigInt",
  // Module system
  "eval", "require", "module", "__dirname", "__filename", "exports",
  // Web APIs
  "fetch", "XMLHttpRequest", "WebSocket", "AbortController", "AbortSignal",
  "Headers", "Request", "Response", "URL", "URLSearchParams",
  "document", "location", "navigator", "history", "localStorage", "sessionStorage",
  "indexedDB", "crypto", "SubtleCrypto",
  "Image", "Canvas", "HTMLCanvasElement", "OffscreenCanvas",
  "MutationObserver", "IntersectionObserver", "PerformanceObserver",
  "Worker", "SharedWorker", "ServiceWorker",
  "MessageChannel", "MessagePort", "BroadcastChannel",
  "EventSource", "FormData", "Blob", "File", "FileReader",
  "ReadableStream", "WritableStream", "TransformStream",
  // Node.js specific
  "AbortController", "EventTarget", "Event",
  // Crypto
  "CryptoKey",
]);

// ---- Alert patterns for reverse-engineering ----
const ALERT_PATTERNS = [
  { label: "API Endpoint", regex: /https?:\/\/[^\s"'`,;{}[\]]+/gi, severity: "high" },
  { label: "API Path", regex: /\/(?:api|v\d+|rest|graphql|rpc)\/[^\s"'`,;{}[\]]*/gi, severity: "medium" },
  { label: "Token/Key", regex: /\b(?:token|secret|apikey|api_key|accessKey|privateKey|passwd|password|authorization)\b/gi, severity: "high" },
  { label: "Signature", regex: /\b(?:sign|signature|hmac|md5|sha(?:1|256|384|512)|encrypt|decrypt|encodeURIComponent)\b/gi, severity: "high" },
  { label: "Crypto", regex: /\b(?:aes|des|rsa|xor|cipher|createHash|createCipher|createHmac|pbkdf2|randomBytes|createDecipher|subtle)\b/gi, severity: "high" },
  { label: "Eval/Dynamic", regex: /\b(?:eval|Function\s*\(|new\s+Function)\b/gi, severity: "critical" },
  { label: "Storage", regex: /\b(?:localStorage|sessionStorage|indexedDB|setItem|getItem|removeItem|clear\s*\(\))\b/gi, severity: "medium" },
  { label: "DOM Sink", regex: /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|document\.domain|location\s*=)\b/gi, severity: "medium" },
  { label: "Network", regex: /\b(?:XMLHttpRequest|fetch|axios|WebSocket|EventSource|navigator\.sendBeacon|open\s*\(\s*["'][A-Z]+)\b/gi, severity: "medium" },
  { label: "Config Field", regex: /\b(?:baseURL|baseUrl|timeout|maxRetries|maxSize|maxLength|maxConcurrency|maxConnections)\b/gi, severity: "low" },
  { label: "Cross-Context", regex: /\b(?:postMessage|BroadcastChannel|MessagePort|SharedWorker)\b/gi, severity: "high" },
  { label: "Extension API", regex: /\b(?:chrome\.(?:storage|runtime|tabs|cookies|webRequest|scripting|downloads|notifications|alarms)|browser\.(?:storage|runtime|tabs|scripting))\b/gi, severity: "high" },
  { label: "React XSS", regex: /\b(?:dangerouslySetInnerHTML|__html|createDangerousString)\b/gi, severity: "high" },
  { label: "Prototype Pollute", regex: /\b(?:__proto__|constructor\s*\[|prototype\s*\[|constructor\.prototype)\b/gi, severity: "high" },
  { label: "Fingerprint", regex: /\b(?:toDataURL|getParameter|WEBGL_debug_renderer_info|canvas.*hash|fingerprint|fp_risk|buvid_fp)\b/gi, severity: "high" },
  { label: "Cookie", regex: /\b(?:document\.cookie|\.cookie\b.*=|cookieEnabled|setCookie|getCookie)\b/gi, severity: "medium" },
  { label: "Anti-Tamper", regex: /\bdebugger\b/gi, severity: "high" },
];

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
  // Core constants
  RESERVED,
  GLOBALS,
  ALERT_PATTERNS,
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
