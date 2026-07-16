
/// <reference types="deob" />

/** @type {import('deob').DeobConfig} */
module.exports = {
  // Input: a single file, a directory, or an array of paths
  input: "src/main.js",
  // input: ["src/a.js", "src/b.js", "src/sub/"],

  // Output directory (optional — auto-derived from input if omitted)
  // output: "out/",

  // Feature flags
  split: false,  // per-function file output
  metrics: false, // HTML readability comparison report
  md: true,       // Markdown structure report
  index: true,   // compact index.txt for LLM navigation

  // LLM-oriented output tuning
  tier: 3,        // 1=alerts+hotspots only, 2=+callees, 3=all functions
  fold: false,    // collapse mechanical functions (polyfill/pure compute/forward) to comments

  // Alert denoising — downgrade false-positive alerts.
  // Each rule: { match: regex, label: "new label", severity?: "low"|"medium"|... }
  // Set to [] to disable all denoising, or omit to use defaults (shown below).
  denoise: [
    // Single-char hostname → test data (e.g. http://a, https://b/c)
    { match: "https?://[a-zA-Z](/|$)",     label: "Test URL",       severity: "low" },
    // Documentation domains → code comment or reference link
    { match: "github\\.io|mozilla\\.org", label: "Doc URL",     severity: "low" },
    // Loopback / local dev server
    { match: "localhost|127\\.0\\.0\\.1", label: "Local URL", severity: "low" },
    // Placeholder / example domains
    { match: "example\\.com|test\\.com",  label: "Placeholder URL", severity: "low" },
    // XML/schema namespace URIs — not real API endpoints
    { match: "w3\\.org/|schema\\.org/|xmlns\\.com/", label: "Namespace URI", severity: "info" },
    // Static file URLs (.js/.css/.exe...) → CDN resources, not API endpoints
    { match: "\\.(js|css|svg|png|jpg|woff2?|ttf|exe|dmg|zip|map|wasm)([?#]|$)", label: "Static File", severity: "low" },
    // Math.sign in polyfill context → not crypto signing
    { match: "Math\\.sign|CreateMethodProperty.*sign", label: "Polyfill", severity: "info" },
  ],
};
