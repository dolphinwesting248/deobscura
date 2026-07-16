// Generate SVG charts for benchmark report
// Output: imgs/*.svg — referenced from report.md
const fs = require("fs");
const path = require("path");

const imgDir = path.join(__dirname, "..", "imgs");
if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

// ── Chart data ──────────────────────────────────────────────────────

const scores = {
  A: { deob: 0.89, raw: 0.74 }, B: { deob: 0.87, raw: 0.71 },
  C: { deob: 0.96, raw: 0.96 }, D: { deob: 0.86, raw: 0.45 },
  E: { deob: 0.85, raw: 0.61 },
};
const times = { A: [30,80], B: [35,60], C: [35,80], D: [115,400], E: [190,255] };
const tokens = { A: [15000,19148], B: [25000,19148], C: [29696,19148], D: [41026,60155], E: [54841,64885] };
const radarData = {
  A: { deob: [0.85,1.00,1.00,0.67,0.90,1.00,0.73,1.00,0.56], raw: [0.80,0.95,0.33,0.67,0.80,1.00,0.27,1.00,0.44] },
  B: { deob: [0.90,1.00,1.00,0.67,0.75,1.00,0.63,1.00,0.43], raw: [0.85,0.75,1.00,0.33,0.70,1.00,0.37,1.00,0.57] },
  C: { deob: [0.95,1.00,1.00,1.00,0.95,1.00,0.70,1.00,0.39], raw: [1.00,1.00,1.00,1.00,1.00,1.00,0.30,1.00,0.61] },
  D: { deob: [0.90,1.00,1.00,0.50,0.90,1.00,0.78,1.00,0.59], raw: [0.45,0.70,0.00,0.50,0.70,0.00,0.22,1.00,0.41] },
  E: { deob: [0.90,1.00,1.00,0.50,0.85,1.00,0.57,1.00,0.54], raw: [0.90,1.00,0.00,0.35,0.90,0.50,0.43,1.00,0.46] },
};
const radarLabels = ["Purpose","Functions","Endpoints","Security","DataFlow","Vars","Time","Entry","Token"];

// ── SVG helpers ─────────────────────────────────────────────────────

function svgBarChart(title, categories, series, width, height) {
  const w = width || 600, h = height || 380;
  const pad = { top: 50, right: 20, bottom: 50, left: 50 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const colors = ["#4a9eff", "#ff6b6b"];
  const maxVal = Math.max(...series.flatMap(s => s.data)) * 1.15;
  const barGap = 6, nBars = series.length;
  const barW = (chartW / categories.length - 10) / nBars;

  let bars = "";
  categories.forEach((cat, ci) => {
    series.forEach((s, si) => {
      const x = pad.left + ci * (chartW / categories.length) + 5 + si * (barW + barGap);
      const val = s.data[ci];
      const barH = (val / maxVal) * chartH;
      const y = pad.top + chartH - barH;
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${colors[si]}" rx="2"/>`;
      bars += `<text x="${x + barW/2}" y="${y - 5}" text-anchor="middle" font-size="11" fill="#333">${val.toFixed(2)}</text>`;
    });
    // x-axis label
    bars += `<text x="${pad.left + ci * (chartW/categories.length) + chartW/categories.length/2}" y="${h - 15}" text-anchor="middle" font-size="12" fill="#666">${cat}</text>`;
  });

  // y-axis grid
  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    grid += `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="#eee" stroke-dasharray="4,4"/>`;
    grid += `<text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#999">${(maxVal * (1 - i/4)).toFixed(1)}</text>`;
  }

  // legend
  let legend = "";
  series.forEach((s, si) => {
    legend += `<rect x="${pad.left + si * 60}" y="15" width="14" height="14" fill="${colors[si]}" rx="2"/>`;
    legend += `<text x="${pad.left + si * 60 + 20}" y="27" font-size="12" fill="#666">${s.name}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <text x="${w/2}" y="32" text-anchor="middle" font-size="15" font-weight="bold" fill="#333">${title}</text>
    ${legend}${grid}${bars}
  </svg>`;
}

function svgPieChart(title, data, width, height) {
  const w = width || 500, h = height || 400;
  const cx = w / 2, cy = h / 2 + 10, outerR = 120, innerR = 60;
  const colors = ["#4a9eff", "#ff6b6b", "#ccc", "#22c55e"];
  const total = data.reduce((s, d) => s + d.value, 0);

  let slices = "", startAngle = -90;
  data.forEach((d, i) => {
    const angle = (d.value / total) * 360;
    const endAngle = startAngle + angle;
    const x1 = cx + outerR * Math.cos(startAngle * Math.PI / 180);
    const y1 = cy + outerR * Math.sin(startAngle * Math.PI / 180);
    const x2 = cx + outerR * Math.cos(endAngle * Math.PI / 180);
    const y2 = cy + outerR * Math.sin(endAngle * Math.PI / 180);
    const large = angle > 180 ? 1 : 0;
    const ix1 = cx + innerR * Math.cos(startAngle * Math.PI / 180);
    const iy1 = cy + innerR * Math.sin(startAngle * Math.PI / 180);
    const ix2 = cx + innerR * Math.cos(endAngle * Math.PI / 180);
    const iy2 = cy + innerR * Math.sin(endAngle * Math.PI / 180);

    slices += `<path d="M${ix1},${iy1} L${x1},${y1} A${outerR},${outerR} 0 ${large} 1 ${x2},${y2} L${ix2},${iy2} A${innerR},${innerR} 0 ${large} 0 ${ix1},${iy1}" fill="${colors[i]}" stroke="#fff" stroke-width="2"/>`;

    // Label
    const mid = (startAngle + endAngle / 2) * Math.PI / 180;
    const lx = cx + (outerR + 30) * Math.cos(mid);
    const ly = cy + (outerR + 30) * Math.sin(mid);
    slices += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="12" fill="#555">${d.name} (${d.value})</text>`;
    startAngle = endAngle;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <text x="${w/2}" y="30" text-anchor="middle" font-size="15" font-weight="bold" fill="#333">${title}</text>
    ${slices}
  </svg>`;
}

function svgRadarChart(title, deobData, rawData, labels, width, height) {
  const w = width || 500, h = height || 420;
  const cx = w / 2, cy = h / 2 + 15, r = 140;
  const n = labels.length;
  const dColor = "#4a9eff", rColor = "#ff6b6b";

  // Grid
  let grid = "";
  for (let level = 0.25; level <= 1; level += 0.25) {
    let pts = "";
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
      const x = cx + r * level * Math.cos(angle);
      const y = cy + r * level * Math.sin(angle);
      pts += `${x},${y} `;
    }
    grid += `<polygon points="${pts}" fill="none" stroke="#e0e0e0" stroke-width="1"/>`;
  }

  // Axis lines
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
    grid += `<line x1="${cx}" y1="${cy}" x2="${cx + r * Math.cos(angle)}" y2="${cy + r * Math.sin(angle)}" stroke="#ddd"/>`;
    grid += `<text x="${cx + (r + 25) * Math.cos(angle)}" y="${cy + (r + 25) * Math.sin(angle)}" text-anchor="middle" font-size="11" fill="#666">${labels[i]}</text>`;
  }

  // Data polygon
  function drawPoly(data, color) {
    let pts = "";
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
      const x = cx + r * data[i] * Math.cos(angle);
      const y = cy + r * data[i] * Math.sin(angle);
      pts += `${x},${y} `;
    }
    return `<polygon points="${pts}" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="2"/>`;
  }

  // Legend
  const legend = `
    <rect x="15" y="15" width="14" height="14" fill="${dColor}" rx="2"/>
    <text x="35" y="27" font-size="12" fill="#666">deob</text>
    <rect x="80" y="15" width="14" height="14" fill="${rColor}" rx="2"/>
    <text x="100" y="27" font-size="12" fill="#666">raw</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <text x="${w/2}" y="30" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">${title}</text>
    ${grid}${drawPoly(deobData, dColor)}${drawPoly(rawData, rColor)}${legend}
  </svg>`;
}

// ── Generate all charts ───────────────────────────────────────────

// 1. Total score bar chart
fs.writeFileSync(path.join(imgDir, "bar-total.svg"), svgBarChart(
  "Total Score: deob vs raw",
  ["A (Easy)", "B (Medium)", "C (Medium)", "D (Hard)", "E (Hard)"],
  [
    { name: "deob", data: Object.values(scores).map(s => s.deob) },
    { name: "raw",  data: Object.values(scores).map(s => s.raw) },
  ]
));

// 2. Pie: where deob adds value
fs.writeFileSync(path.join(imgDir, "pie-value.svg"), svgPieChart(
  "Where deob adds value",
  [
    { name: "Easy/Medium", value: 35 },
    { name: "Hard scenarios", value: 65 },
  ]
));

// 3. Time bar chart
fs.writeFileSync(path.join(imgDir, "bar-time.svg"), svgBarChart(
  "Analysis Time (seconds)",
  ["A", "B", "C", "D", "E"],
  [
    { name: "deob", data: Object.values(times).map(t => t[0]) },
    { name: "raw",  data: Object.values(times).map(t => t[1]) },
  ], 600, 420
));

// 4. Token bar chart
fs.writeFileSync(path.join(imgDir, "bar-token.svg"), svgBarChart(
  "Input Token Consumption",
  ["A", "B", "C", "D", "E"],
  [
    { name: "deob", data: Object.values(tokens).map(t => t[0]) },
    { name: "raw",  data: Object.values(tokens).map(t => t[1]) },
  ], 600, 420
));

// 5. Per-scenario radar charts
["A","B","C","D","E"].forEach(sc => {
  fs.writeFileSync(path.join(imgDir, `radar-${sc}.svg`), svgRadarChart(
    `Scenario ${sc}`,
    radarData[sc].deob, radarData[sc].raw, radarLabels
  ));
});

console.log(`Generated ${fs.readdirSync(imgDir).length} SVG charts in ${imgDir}`);
