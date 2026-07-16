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
  { label: "DOM Sink", regex: /\b(?:innerHTML\s*\+?=|outerHTML|insertAdjacentHTML|document\.write|document\.domain|location\s*=)\b/gi, severity: "high" },
  { label: "Network", regex: /\b(?:XMLHttpRequest|fetch|axios|WebSocket|EventSource|navigator\.sendBeacon|open\s*\(\s*["'][A-Z]+)\b/gi, severity: "medium" },
  { label: "Anti-Debug", regex: /\b(?:console\.(?:clear|log|warn|error)|debugger|setInterval|setTimeout)\b/gi, severity: "low" },
  { label: "Obfuscation", regex: /\b(?:btoa\s*\(|atob\s*\(|unescape|escape|decodeURIComponent\s*\(|rc4|base64|Function\s*\(\s*['\"]return)\b/gi, severity: "low" },
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
  "delegate", "handler", "sideeffect", "varargs", "boilerplate", "callback", "branch", "dynamic", "other",
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
  handler: "Callback Handlers",
  sideeffect: "Side Effects",
  varargs: "Varargs",
  boilerplate: "Boilerplate",
  callback: "Callbacks",
  branch: "Branches",
  dynamic: "Dynamic Eval",
  obfuscation: "Obfuscation Artifacts",
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

// ---- Domain Classification Rules ----
// Simple regex → tag rules for classifyDomain(). Order matters: specific before generic.
const DOMAIN_RULES = [
  // Bundlers
  { tag: "rspack/webpack chunk", regex: /\bself\.(rspack|webpack)(Chunk|_require_)/ },
  { tag: "webpack bundle", regex: /\b__webpack_require__\b|\b__webpack_modules__\b/, exclusive: true },
  { tag: "turbopack runtime", regex: /\bTURBOPACK\b|\bturbopack\b/ },
  { tag: "CommonJS", regex: /\bmodule\.exports\b|\bexports\[/, extra: /\brequire\s*\(/ },
  { tag: "AMD", regex: /\bdefine\s*\(\s*(['"]|function)/ },
  // Frameworks (framework: true = higher weight in domain scoring)
  { tag: "Vue", regex: /\b__VUE__\b|\bvue\b.*\breactive\b|\bVue\b.*\bcomponent\b/i, framework: true },
  { tag: "React", regex: /\b__REACT_DEVTOOLS_GLOBAL_HOOK__\b|\bReactDOM\b/, framework: true },
  { tag: "Angular", regex: /\b__ANGULAR__\b|\bNgModule\b|\bzone\.js\b/, framework: true },
  { tag: "Svelte", regex: /\b__svelte\b|\bSvelte\b.*\bcompile\b/i, framework: true },
  { tag: "Next.js", regex: /\b__NEXT_DATA__\b|\b__next\b/, framework: true },
  { tag: "Nuxt", regex: /\b__nuxt\b|\bNuxt\b/, framework: true },
  // Module runtimes
  { tag: "Worker runtime", regex: /\bimportScripts\b|\bWorker\b.*\bimport\b/i },
  { tag: "Node.js", regex: /\bprocess\.(?!env)/ },
  // DOM & Events
  { tag: "DOM manipulation", regex: /\binnerHTML\b|\bcreateElement\b|\bappendChild\b|\bquerySelector\b|\bgetElementById\b/ },
  { tag: "Event-driven", regex: /\baddEventListener\b/, minCount: 3 },
  // Security-relevant
  { tag: "Crypto", regex: /\b(crypto|encrypt|decrypt|hmac|md5|sha\d+)\b/i, exclude: /\b(crypto\.subtle|crypto\.getRandomValues|window\.crypto|globalThis\.crypto)\b/ },
  { tag: "Signing", regex: /\b(sign\w*(?:V2|Init|Request)?\s*\(|xhsSign|_sign\b|signKey)\b/i },
  { tag: "Protobuf", regex: /\b(protobuf|protobufjs|\.(?:encode|decode|verify|fromObject|toObject)\s*\()/, exclude: /\b(Text(?:Encoder|Decoder)|encodeURI(?:Component)?|decodeURI(?:Component)?)\b/ },
  { tag: "WebSocket", regex: /\b(websocket|ws\b\.|gateway|socket\.io|Reconnect)|WebSocket\b/i, exclude: /\b(ReadableStream|WritableStream|TransformStream)\b/ },
  { tag: "Graphics", regex: /\bWebGL\b|\bgetContext\s*\(\s*['"]2d['"]\s*\)|drawImage\b|createTexture\b/i },
  // Polyfills
  { tag: "Prototype-patched", regex: /\bprototype\s*\.\s*\w+\s*=/ },
  { tag: "Polyfill/Core-JS", regex: /\b(ToPrimitive|OrdinaryToPrimitive|IsCallable|GetMethod|SpeciesConstructor|CreateMethodProperty|__core-js_shared__)\b/ },
  // Application-level domains
  { tag: "Auth Handler", regex: /\b(?:login|authenticate|password|credential|token|session|hashPassword|mfaVerify|OTP|2FA)\b/i, minCount: 3 },
  { tag: "Data Pipeline", regex: /\b(?:JSON\.parse|Array\.isArray|\.filter\s*\(|\.map\s*\(|\.forEach\s*\(|\.sort\s*\(|\.group\s*\(|transform|aggregate|statistics)\b/ },
  { tag: "CRUD API", regex: /\b(?:POST|GET|PUT|DELETE)\b.*\b(?:fetch|axios|xhr|sendRequest)\b|\b(?:fetch|axios)\b.*\b(?:POST|GET|PUT)\b/ },
];

// ---- Function Category Rules (for categorizeFn) ----
// Simple regex → category rules. Checked in order; first match wins.
const CATEGORY_RULES = [
  { category: "network", regex: /\b(axios|fetch|xhr\b|XMLHttpRequest|User-Agent|responseType|rateLimit|FormData|x-www-form)\b/i },
  { category: "websocket", regex: /\b(websocket|ws\.|readyState|WebSocket|handshake|close code|terminate|ping\b|pong\b|subprotocol|permessage-deflate|_socket\b)\b/i },
  { category: "crypto", regex: /\b(crypto|sha512|sha256|hmac|md5|encrypt|decrypt|sign\b|cipher\b|hash\b|randomBytes|pbkdf2)\b/i },
  { category: "parser", regex: /\b(yaml|parser|scalar|blockMap|blockSeq|flowSeq|resolved\b|YAML\b)\b/i },
  { category: "i18n", regex: /\b(i18n|i18next|translat|lng\b|interpolat|plural|namespace|resStore|ns\b)\b/i },
  { category: "polyfill", regex: /\b(core-js|polyfill|prototype\.\w+\s*=\s*function|__core-js_shared__|ToPrimitive|OrdinaryToPrimitive|IsCallable|GetMethod|SpeciesConstructor)\b/i },
  { category: "filesystem", regex: /\b(fs\.|fse\.|chmod|chown|statSync|mkdir|readFile|writeFile|copyFile|unlink|Buffer\.|glob\b|readdir|rmSync)\b/i },
  { category: "boilerplate", regex: /\b(__esModule|Object\.defineProperty|d\s*\(\s*exports|exports\s*\[)\b/ },
  { category: "obfuscation", regex: /\b(?:Function\s*\(\s*['\"]return|constructor\s*\(\s*['\"]return|\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|_0x[0-9a-fA-F]{4,6}|setInterval\s*\(\s*function.*toString|selfDefending|debugProtection)\b/ },
];

// ---- Behavioral description patterns (for categorizeFn fallback) ----
const DESC_PATTERNS = [
  { category: "handler", desc: "callback-driven" },
  { category: "handler", desc: "side-effects" },
  { category: "handler", desc: "callback-driven, side-effects" },
];

// ---- Framework Detection Patterns (for categorizeFn, checked BEFORE CATEGORY_RULES) ----
const FRAMEWORK_PATTERNS = [
  /\b(Vue\b.*\bcomponent|\$__vue__|__vue__|Vue\.util|Observer|Dep\.prototype|Watcher\b.*\bvm)\b/,
  /\b(ReactDOM\b|__REACT_DEVTOOLS|ReactCurrentOwner|enqueueSetState|scheduleWork)\b/,
  /\b(regeneratorRuntime\b|asyncToGenerator|_asyncToGenerator)\b/,
  /\b(VueRouter\b|HashHistory|HTML5History|AbstractHistory|createRoute)\b/,
];

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
  // Domain & Category rules
  DOMAIN_RULES,
  CATEGORY_RULES,
  FRAMEWORK_PATTERNS,
};
