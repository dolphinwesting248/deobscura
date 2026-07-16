# Alert Denoising

Deob scans string literals for security-relevant patterns (API endpoints, tokens, crypto, eval, etc.). Some matches are false positives — test URLs, documentation links, framework internals. The `denoise` config lets you reclassify these.

## Usage

In `deob.config.js`, add `denoise` rules:

```js
module.exports = {
  input: "src/main.js",
  denoise: [
    { match: "regex-pattern", label: "New Label", severity: "info" },
    { match: "another-pattern",  label: "Renamed" },
  ],
};
```

- `match`: regex tested against the matched string (case-insensitive)
- `label`: new label to replace the original
- `severity`: optional, reclassify severity level

Rules are applied in order. First match wins.

## Default Rules

These rules ship by default if you don't provide a `denoise` array:

```js
const DEFAULT_DENOISE = [
  // ── URLs that aren't real API endpoints ──
  { match: "https?://[a-zA-Z](/|$)",     label: "Test URL",       severity: "low" },
  { match: "github\\.io|mozilla\\.org",   label: "Doc URL",        severity: "low" },
  { match: "localhost|127\\.0\\.0\\.1",   label: "Local URL",      severity: "low" },
  { match: "example\\.com|test\\.com",    label: "Placeholder URL", severity: "low" },
  { match: "w3\\.org/|schema\\.org/|xmlns\\.com/", label: "Namespace URI", severity: "info" },
  { match: "https?://[^/]+/$",           label: "Self-domain URL", severity: "info" },

  // ── Static file extensions, not API endpoint ──
  { match: "\\.(js|css|svg|png|jpg|woff2?|ttf|exe|dmg|zip|map|wasm)([?#]|$)", label: "Static File", severity: "low" },

  // ── Math.sign in polyfill context, not crypto ──
  { match: "Math\\.sign|CreateMethodProperty.*sign", label: "Polyfill", severity: "info" },

  // ── Framework internals (not security concerns) ──
  { match: "dangerouslySetInnerHTML|__html", label: "Framework Internal", severity: "info" },
  { match: "innerHTML|outerHTML",             label: "Framework Internal", severity: "info" },
  { match: "sessionStorage|localStorage",     label: "Framework Internal", severity: "info" },
  { match: "new Function|Function\\(",        label: "Framework Internal", severity: "info" },
];
```

## Disable denoising

Pass an empty array to see all alerts unfiltered:

```js
denoise: []
```

## Severity Levels

| Level | Meaning | When to use |
|-------|---------|-------------|
| `critical` | Immediate concern | eval(), new Function() |
| `high` | Likely security-relevant | API endpoints, crypto, fingerprints |
| `medium` | Potentially interesting | Storage, DOM sinks |
| `low` | Informational | Config fields, test data |
| `info` | No concern | Suppressed in reports |

## Examples

### Custom API hostname

Your project uses `https://myapi.internal/` — deob flags it as an API endpoint with severity `high`. To reclassify it as domain-internal:

```js
denoise: [
  { match: "myapi\\.internal", label: "Internal API", severity: "medium" },
]
```

### Known fingerprint library

Your code includes fingerprintjs (legitimate analytics), flagged as `high` severity fingerprint:

```js
denoise: [
  { match: "fingerprintjs|fp_js", label: "Analytics SDK", severity: "low" },
]
```

### Disable a specific alert pattern entirely

To hide known false positives:

```js
denoise: [
  { match: "your-false-positive-pattern", label: "Ignored", severity: "info" },
]
```

`info` severity alerts are excluded from `0-prompt.md` and `1-structure.md`.
