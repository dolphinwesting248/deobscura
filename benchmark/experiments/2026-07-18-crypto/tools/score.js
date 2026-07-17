#!/usr/bin/env node
// Scoring script for crypto benchmark
// Reads agent answers and compares against ground truth
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SCENARIOS = ["A", "B", "C"];
const RESULTS_DIR = path.join(__dirname, "..", "results");
const SCENARIO_DIR = path.join(__dirname, "..", "scenarios");

// ---- Scenario A scoring: MD5 signature ----
function scoreA(answer) {
  const truth = JSON.parse(fs.readFileSync(
    path.join(SCENARIO_DIR, "A", "ground-truth.json"), "utf8"
  ));
  const scores = {};

  // Algorithm identification
  scores.algorithm = answer.algorithm && answer.algorithm.toLowerCase().includes("md5") ? 1.0 : 0.0;

  // Salt location
  scores.salt = answer.salt === truth.encryption.salt ? 1.0 :
    (answer.salt && answer.salt.length > 0 ? 0.5 : 0.0);

  // Separator
  scores.separator = answer.separator === truth.encryption.separator ? 1.0 : 0.0;

  // Format description
  const formatCorrect = answer.signStringFormat &&
    answer.signStringFormat.includes("param") &&
    answer.signStringFormat.includes("timestamp") &&
    answer.signStringFormat.includes("salt");
  scores.format = formatCorrect ? 1.0 : 0.5;

  // Signature verification (objective)
  if (answer.pythonSignature) {
    const expected = truth.verification.expectedSignature;
    scores.verification = answer.pythonSignature === expected ? 1.0 : 0.0;
  } else {
    scores.verification = 0.0;
  }

  const weights = { algorithm: 0.20, salt: 0.30, separator: 0.20, format: 0.20, verification: 0.10 };
  scores.total = Object.entries(weights).reduce((s, [k, w]) => s + (scores[k] || 0) * w, 0);

  return { dimensionScores: scores, weights };
}

// ---- Scenario B scoring: AES-CBC decryption ----
function scoreB(answer) {
  const truth = JSON.parse(fs.readFileSync(
    path.join(SCENARIO_DIR, "B", "ground-truth.json"), "utf8"
  ));
  const scores = {};

  // Algorithm identification
  const algo = (answer.algorithm || "").toLowerCase();
  scores.algorithm = algo.includes("aes") && algo.includes("cbc") ? 1.0 :
    (algo.includes("aes") ? 0.5 : 0.0);

  // Key extraction
  const key = (answer.keyHex || answer.key || "").toLowerCase().replace(/\s/g, "");
  scores.key = key === truth.encryption.keyHex ? 1.0 :
    (key.length >= 16 ? 0.3 : 0.0);

  // IV and format
  scores.format = answer.payloadFormat &&
    answer.payloadFormat.includes("iv") &&
    answer.payloadFormat.includes("base64") ? 1.0 : 0.3;

  // Separator
  scores.separator = answer.separator === truth.encryption.separator ? 1.0 : 0.0;

  // Decryption verification (objective)
  if (answer.decryptedPlaintext) {
    const expected = JSON.stringify(truth.verification.expectedPlaintext);
    scores.verification = JSON.stringify(answer.decryptedPlaintext) === expected ? 1.0 : 0.0;
  } else {
    scores.verification = 0.0;
  }

  const weights = { algorithm: 0.20, key: 0.30, format: 0.20, separator: 0.20, verification: 0.10 };
  scores.total = Object.entries(weights).reduce((s, [k, w]) => s + (scores[k] || 0) * w, 0);

  return { dimensionScores: scores, weights };
}

// ---- Scenario C scoring: RC4 + HMAC ----
function scoreC(answer) {
  const truth = JSON.parse(fs.readFileSync(
    path.join(SCENARIO_DIR, "C", "ground-truth.json"), "utf8"
  ));
  const scores = {};

  // Algorithm identification
  const algo = (answer.algorithm || "").toLowerCase();
  scores.algorithm = (algo.includes("rc4") && algo.includes("hmac")) ? 1.0 :
    (algo.includes("rc4") || algo.includes("hmac") ? 0.5 : 0.0);

  // RC4 key
  const rc4Key = (answer.rc4Key || answer.rc4KeyHex || "").toLowerCase().replace(/\s/g, "");
  scores.rc4Key = rc4Key === truth.encryption.rc4.keyHex ? 1.0 :
    (rc4Key.length >= 8 ? 0.3 : 0.0);

  // HMAC key
  scores.hmacKey = answer.hmacKey === truth.encryption.hmac.key ? 1.0 :
    (answer.hmacKey && answer.hmacKey.length > 0 ? 0.5 : 0.0);

  // String table decoding (check first 5)
  if (answer.decodedStrings) {
    const expected = truth.encryption.stringTable.decoded;
    let matchCount = 0;
    for (const [k, v] of Object.entries(expected)) {
      if (answer.decodedStrings[k] === v) matchCount++;
    }
    scores.strings = matchCount / Object.keys(expected).length;
  } else {
    scores.strings = 0.0;
  }

  // HMAC verification
  if (answer.pythonHmac) {
    scores.verification = answer.pythonHmac === truth.verification.expectedHmac ? 1.0 : 0.0;
  } else {
    scores.verification = 0.0;
  }

  const weights = { algorithm: 0.20, rc4Key: 0.30, hmacKey: 0.20, strings: 0.20, verification: 0.10 };
  scores.total = Object.entries(weights).reduce((s, [k, w]) => s + (scores[k] || 0) * w, 0);

  return { dimensionScores: scores, weights };
}

// ---- Main ----
const scorers = { A: scoreA, B: scoreB, C: scoreC };

function scoreAll(answersDir) {
  const allScores = {};
  for (const s of SCENARIOS) {
    const answerFile = path.join(answersDir, `scenario_${s}_answer.json`);
    if (!fs.existsSync(answerFile)) {
      console.log(`Scenario ${s}: NO ANSWER FILE`);
      continue;
    }
    const answer = JSON.parse(fs.readFileSync(answerFile, "utf8"));
    const result = scorers[s](answer);
    allScores[s] = result;
    console.log(`Scenario ${s}: ${(result.dimensionScores.total * 100).toFixed(0)}%`);
  }
  return allScores;
}

// CLI
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log("Usage: node score.js <answers-dir>");
  console.log("  answers-dir: directory containing scenario_A_answer.json etc.");
  process.exit(1);
}

const scores = scoreAll(args[0]);
const outPath = path.join(RESULTS_DIR, "scores.json");
fs.writeFileSync(outPath, JSON.stringify(scores, null, 2));
console.log(`\nScores saved to ${outPath}`);
