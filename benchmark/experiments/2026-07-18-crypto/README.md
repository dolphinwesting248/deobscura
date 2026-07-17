# Crypto Cracking Benchmark

Tests deobscura's effectiveness at preparing obfuscated JavaScript for LLM-driven client-side encryption analysis.

## Quick Start

```bash
# 1. Run deob on all scenarios
node tools/runner.js

# 2. Have LLM analyze each scenario (deob output vs raw obfuscated)
#    Provide: results/deob-output/<A|B|C>/main.js + 0-prompt.md

# 3. LLM produces answer JSON per scenario → save to results/agent-answers/

# 4. Score results
node tools/score.js results/agent-answers/
```

## Scenarios

| Scenario | Algorithm | Difficulty | Obfuscation | Adapted From |
|----------|-----------|------------|-------------|--------------|
| **A** | MD5 Request Signing | Medium | stringArray + controlFlow + deadCode | sina_ads.js + suning_da.js |
| **B** | AES-128-CBC Encryption | Hard | stringArray + controlFlow + deadCode + selfDefending | weibo_fp.js `We()` function |
| **C** | RC4 + HMAC-SHA256 | Extreme | All options (RC4 string array + selfDefending + debugProtection) | tmall_security.js |

### Scenario A — MD5 Signing

Hidden salt `x7k9m_2025`, separator `|`, sorted params. LLM must find the salt and reproduce the signature.

### Scenario B — AES-CBC Encryption  

Hardcoded 128-bit AES key (`2b7e151628aed2a6...`), random IV, payload format `base64(iv).base64(ciphertext)`. LLM must extract the key and decrypt a provided ciphertext.

### Scenario C — RC4 + HMAC

RC4-encoded string table (20 strings) + HMAC-SHA256 integrity key (`integrity_key_2025`). LLM must decode all strings, find the HMAC key, and verify a test HMAC.

## Expected LLM Answer Format

```json
{
  "scenario": "A",
  "agentType": "deob",
  "algorithm": "MD5",
  "salt": "x7k9m_2025",
  "separator": "|",
  "paramFormat": "sorted key=value pairs joined by &",
  "signStringFormat": "{params}&{separator}{timestamp}{separator}{salt}",
  "pythonSignature": "f35292a6eb1648cd1099d06e9606d6df",
  "_meta": { "timeMs": 45000, "tokensUsed": 3200 }
}
```

## Scoring

| Dimension | Weight | Scenario A | Scenario B | Scenario C |
|-----------|--------|------------|------------|------------|
| Algorithm ID | 20% | MD5 | AES-CBC | RC4 + HMAC |
| Key/Salt Locating | 30% | salt value | AES key hex | RC4 key + HMAC key |
| Parameters | 20% | separator + format | IV + format + padding | string table decode |
| Pseudo/Code | 20% | format description | format + separator | format description |
| Verification | 10% | correct signature | correct plaintext | correct HMAC |

Verification is objective — the scoring script compares LLM output against ground-truth values directly.

## File Structure

```
scenarios/
  A/  original.js  obfuscated.js  ground-truth.json
  B/  original.js  obfuscated.js  ground-truth.json
  C/  original.js  obfuscated.js  ground-truth.json
tools/
  runner.js      — runs deob on all scenarios
  score.js       — scores LLM answers against ground truth
results/
  deob-output/   — deob main.js + prompt + structure + index per scenario
  agent-answers/ — LLM-produced answer JSONs go here
  deob-metrics.json — pipeline metrics
  scores.json    — scoring output
```

## Deob Processing Results

| Scenario | Input | Output | Ratio | Time | Sub-fns |
|----------|-------|--------|-------|------|---------|
| A | 44.7 KB | 31.4 KB | **70.2%** | 290ms | 4 |
| B | 26.4 KB | 25.2 KB | **95.5%** | 214ms | 11 |
| C | 39.5 KB | 35.6 KB | **90.1%** | 232ms | 24 |

All three produced smaller output than input after deob processing.
