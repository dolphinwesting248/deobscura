// Parser & generator provided to all modules
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const fs = require("fs");
const path = require("path");

// ---- Globals not requiring parameter passing ----
const GLOBALS = new Set([
  "Object", "Array", "String", "Number", "Boolean", "Function", "Symbol",
  "Map", "Set", "WeakMap", "WeakSet", "Promise", "Proxy", "Reflect",
  "Math", "Date", "RegExp", "Error", "TypeError", "RangeError",
  "SyntaxError", "ReferenceError", "parseInt", "parseFloat", "isNaN", "isFinite",
  "NaN", "Infinity", "undefined", "null", "true", "false",
  "console", "window", "global", "globalThis", "process", "Buffer",
  "setTimeout", "setInterval", "clearTimeout", "clearInterval",
  "decodeURI", "encodeURI", "decodeURIComponent", "encodeURIComponent",
  "JSON", "Intl", "ArrayBuffer", "DataView",
  "Uint8Array", "Int8Array", "Uint16Array", "Int16Array",
  "Uint32Array", "Int32Array", "Float32Array", "Float64Array",
  "eval", "require", "module", "__dirname", "__filename", "exports", "fetch",
  "document", "location", "navigator", "history", "localStorage", "sessionStorage",
]);

// String alert patterns for reverse-engineering (shared with structure.js + passes.js)
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
  // Attack surface extensions
  { label: "Cross-Context", regex: /\b(?:postMessage|BroadcastChannel|MessagePort|SharedWorker)\b/gi, severity: "high" },
  { label: "Extension API", regex: /\b(?:chrome\.(?:storage|runtime|tabs|cookies|webRequest|scripting|downloads|notifications|alarms)|browser\.(?:storage|runtime|tabs|scripting))\b/gi, severity: "high" },
  { label: "React XSS", regex: /\b(?:dangerouslySetInnerHTML|__html|createDangerousString)\b/gi, severity: "high" },
  { label: "Prototype Pollute", regex: /\b(?:__proto__|constructor\s*\[|prototype\s*\[|constructor\.prototype)\b/gi, severity: "high" },
  { label: "Fingerprint", regex: /\b(?:toDataURL|getParameter|WEBGL_debug_renderer_info|canvas.*hash|fingerprint|fp_risk|buvid_fp)\b/gi, severity: "high" },
  { label: "Cookie", regex: /\b(?:document\.cookie|\.cookie\b.*=|cookieEnabled|setCookie|getCookie)\b/gi, severity: "medium" },
  { label: "Anti-Tamper", regex: /\bdebugger\b/gi, severity: "high" },
];

module.exports = { parser, generate, t, fs, path, GLOBALS, ALERT_PATTERNS };
