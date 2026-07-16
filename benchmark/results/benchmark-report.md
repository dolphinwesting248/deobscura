# deob Benchmark Report

## How to Run the Agents

For each scenario, spawn TWO agents with the same analysis goals:

**Agent A (deob):** Read the deob_agent_prompt.txt from the results directory.
**Agent B (raw):** Read the raw_agent_prompt.txt from the results directory.

Both agents should output a JSON object. Compare against ground-truth.json in each scenario folder.

## Obfuscation Levels

| Scenario | Description | Obfuscated Size | Deob Size | Ratio |
|----------|-------------|-----------------|-----------|-------|
| A | API Client | 4.5 KB | 6.4 KB | 140% |
| B | Auth Flow | 14.0 KB | 19.0 KB | 135% |
| C | Data Pipeline | 10.3 KB | 14.6 KB | 141% |
| D | Webpack Bundle | 42.0 KB | 35.1 KB | 84% |
| E | Payment Processing | 63.0 KB | 53.8 KB | 85% |

## Scoring Rubric

| Category | Weight | Method |
|----------|--------|--------|
| Functions identified | 25% | Keyword match between answer and GT purpose |
| API endpoints | 20% | Path component match |
| Security issues | 25% | Keyword match between answer and GT issues |
| Data flow | 15% | Jaccard similarity on keywords |
| Key variables | 15% | Name/value match |

## Scoring Template

Copy this table and fill in scores after running agents:

| Scenario | Agent | Functions (/25) | API (/20) | Security (/25) | DataFlow (/15) | Vars (/15) | **Total** | Time |
|----------|-------|----------------|-----------|----------------|---------------|-----------|----------|------|
| A | **deob** | /25 (6 GT) | /20 (3 GT) | /25 (3 GT) | /15 | /15 |   /100 | s |
| A | **raw** | /25 | /20 | /25 | /15 | /15 |   /100 | s |
| B | **deob** | /25 (10 GT) | /20 (0 GT) | /25 (3 GT) | /15 | /15 |   /100 | s |
| B | **raw** | /25 | /20 | /25 | /15 | /15 |   /100 | s |
| C | **deob** | /25 (5 GT) | /20 (0 GT) | /25 (0 GT) | /15 | /15 |   /100 | s |
| C | **raw** | /25 | /20 | /25 | /15 | /15 |   /100 | s |
| D | **deob** | /25 (5 GT) | /20 (1 GT) | /25 (2 GT) | /15 | /15 |   /100 | s |
| D | **raw** | /25 | /20 | /25 | /15 | /15 |   /100 | s |
| E | **deob** | /25 (4 GT) | /20 (1 GT) | /25 (4 GT) | /15 | /15 |   /100 | s |
| E | **raw** | /25 | /20 | /25 | /15 | /15 |   /100 | s |