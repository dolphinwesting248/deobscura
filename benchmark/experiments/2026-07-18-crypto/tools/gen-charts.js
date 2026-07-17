#!/usr/bin/env node
// Generate SVG charts from scores.json
const fs = require("fs");
const path = require("path");

const BASE = path.join(__dirname, "..");
const IMGS = path.join(BASE, "imgs");
const SCORES_PATH = path.join(BASE, "results", "scores", "final-scores.json");

if (!fs.existsSync(SCORES_PATH)) {
  console.log("No scores.json found. Run score.js --all first.");
  process.exit(0);
}

const scores = JSON.parse(fs.readFileSync(SCORES_PATH, "utf-8"));
fs.mkdirSync(IMGS, { recursive: true });

const DIM_KEYS = ["Algorithm", "Key", "Parameters", "PseudoCode", "Result", "token", "time", "entry"];
const DIM_LABELS = ["Algorithm", "Key", "Params", "Pseudo", "Result", "Token", "Time", "Entry"];
const W = 400, H = 300;

// ---- Bar chart: total scores deob vs raw ----
function svgBarChart() {
  const scenarios = Object.keys(scores);
  const barW = 50, gap = 40, left = 80, bottom = H - 50, chartH = bottom - 40;
  const totalW = left + scenarios.length * (barW * 2 + gap) + 40;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${H}">`;
  svg += `<text x="${totalW/2}" y="25" text-anchor="middle" font-size="14" font-weight="bold">Total Score: deob vs raw</text>`;

  scenarios.forEach((s, i) => {
    const x0 = left + i * (barW * 2 + gap);
    const deobH = scores[s].deob.total * chartH;
    const rawH = scores[s].raw.total * chartH;
    svg += `<rect x="${x0}" y="${bottom - deobH}" width="${barW}" height="${deobH}" fill="#4CAF50"/><text x="${x0 + barW/2}" y="${bottom - deobH - 5}" text-anchor="middle" font-size="11">${(scores[s].deob.total*100).toFixed(0)}%</text>`;
    svg += `<rect x="${x0 + barW}" y="${bottom - rawH}" width="${barW}" height="${rawH}" fill="#FF9800"/><text x="${x0 + barW*1.5}" y="${bottom - rawH - 5}" text-anchor="middle" font-size="11">${(scores[s].raw.total*100).toFixed(0)}%</text>`;
    svg += `<text x="${x0 + barW}" y="${bottom + 20}" text-anchor="middle" font-size="12">${s}</text>`;
  });

  svg += `<rect x="${totalW - 160}" y="10" width="12" height="12" fill="#4CAF50"/><text x="${totalW - 142}" y="21" font-size="11">deob</text>`;
  svg += `<rect x="${totalW - 90}" y="10" width="12" height="12" fill="#FF9800"/><text x="${totalW - 72}" y="21" font-size="11">raw</text>`;
  svg += `</svg>`;
  return svg;
}

// ---- Radar chart per scenario ----
function svgRadar(scenario) {
  const s = scores[scenario];
  const cx = W / 2, cy = H / 2, r = Math.min(cx, cy) - 40;
  const dims = DIM_LABELS;
  const n = dims.length;
  const angleStep = (2 * Math.PI) / n;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  svg += `<text x="${W/2}" y="20" text-anchor="middle" font-size="13" font-weight="bold">Scenario ${scenario}</text>`;

  // Grid circles
  for (let level = 0.2; level <= 1; level += 0.2) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + i * angleStep;
      pts.push(`${cx + Math.cos(a) * r * level},${cy + Math.sin(a) * r * level}`);
    }
    svg += `<polygon points="${pts.join(" ")}" fill="none" stroke="#ddd" stroke-width="1"/>`;
  }

  // Deob polygon
  const deobPts = [];
  for (let i = 0; i < n; i++) {
    const dimKey = DIM_KEYS[i];
    const val = s.deob.dimensions[dimKey] || 0;
    const a = -Math.PI / 2 + i * angleStep;
    deobPts.push(`${cx + Math.cos(a) * r * val},${cy + Math.sin(a) * r * val}`);
  }
  svg += `<polygon points="${deobPts.join(" ")}" fill="#4CAF50" fill-opacity="0.3" stroke="#4CAF50" stroke-width="2"/>`;

  // Raw polygon
  const rawPts = [];
  for (let i = 0; i < n; i++) {
    const rk = DIM_KEYS[i];
    const val = s.raw.dimensions[rk] || 0;
    const a = -Math.PI / 2 + i * angleStep;
    rawPts.push(`${cx + Math.cos(a) * r * val},${cy + Math.sin(a) * r * val}`);
  }
  svg += `<polygon points="${rawPts.join(" ")}" fill="#FF9800" fill-opacity="0.3" stroke="#FF9800" stroke-width="2"/>`;

  // Labels
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * angleStep;
    const lx = cx + Math.cos(a) * (r + 18);
    const ly = cy + Math.sin(a) * (r + 18) + 4;
    svg += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="9">${DIM_LABELS[i]}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

// Generate all charts
fs.writeFileSync(path.join(IMGS, "bar-total.svg"), svgBarChart());
console.log("Generated bar-total.svg");

for (const s of Object.keys(scores)) {
  fs.writeFileSync(path.join(IMGS, `radar-${s}.svg`), svgRadar(s));
  console.log(`Generated radar-${s}.svg`);
}
console.log("Done.");
