// Parser & generator provided to all modules
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const fs = require("fs");
const path = require("path");

// ── Default denoise rules (user-configurable via deob.config.js) ───
const DEFAULT_DENOISE = [
  { match: "https?://[a-zA-Z](/|$)",     label: "Test URL",       severity: "low" },
  { match: "github\\.io|mozilla\\.org",   label: "Doc URL",        severity: "low" },
  { match: "localhost|127\\.0\\.0\\.1",   label: "Local URL",      severity: "low" },
  { match: "example\\.com|test\\.com",    label: "Placeholder URL", severity: "low" },
  { match: "w3\\.org/|schema\\.org/|xmlns\\.com/", label: "Namespace URI", severity: "info" },
  { match: "\\.(js|css|svg|png|jpg|woff2?|ttf|exe|dmg|zip|map|wasm)([?#]|$)", label: "Static File", severity: "low" },
  { match: "Math\\.sign|CreateMethodProperty.*sign", label: "Polyfill", severity: "info" },
  { match: "https?://[^/]+/$",           label: "Self-domain URL", severity: "info" },
];

module.exports = { parser, generate, t, fs, path, DEFAULT_DENOISE };
