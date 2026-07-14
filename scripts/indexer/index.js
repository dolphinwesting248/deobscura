/**
 * Code indexer for deob output directories.
 * Scans .js files, extracts symbols via Babel, stores in SQLite.
 */
const path = require("path");
const fs = require("fs");
const { extractSymbols } = require("./extract");
const {
  openDatabase,
  storeNodes,
  storeEdges,
  storeFile,
  storeSegments,
  storeUnresolvedRefs,
  resolveReferences,
  getStats,
} = require("./store");

function collectJsFiles(dir, skipPatterns) {
  const results = [];
  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === ".index" || e.name === "node_modules") continue;
        walk(full);
      } else if (e.isFile() && e.name.endsWith(".js") && e.name !== "index.js") {
        const rel = path.relative(dir, full);
        const skip = skipPatterns.some((p) => {
          const re = new RegExp(p.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*"));
          return re.test(rel);
        });
        if (!skip) results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

function indexDirectory(outputDir, skipPatterns) {
  skipPatterns = skipPatterns || [];
  const startTime = Date.now();
  const files = collectJsFiles(outputDir, skipPatterns);

  if (files.length === 0) {
    console.log("  No .js files found to index");
    return null;
  }

  const db = openDatabase(outputDir);
  let totalNodes = 0;
  let totalEdges = 0;
  let totalRefs = 0;
  const allNodesByName = new Map(); // name → [nodeId, ...] for cross-file resolution

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const relPath = path.relative(outputDir, filePath);
    const source = fs.readFileSync(filePath, "utf-8");

    const result = extractSymbols(relPath, source);
    if (result.error) {
      storeFile(db, relPath, filePath, source, 0);
      continue;
    }

    // Build name→ID index for resolution (across all files)
    for (const n of result.nodes) {
      if (!allNodesByName.has(n.name)) allNodesByName.set(n.name, []);
      const ids = allNodesByName.get(n.name);
      if (!ids.includes(n.id)) ids.push(n.id);
    }

    storeNodes(db, result.nodes);
    storeEdges(db, result.edges);
    storeFile(db, relPath, filePath, source, result.nodes.length);
    storeSegments(db, result.nameSegments);
    if (result.unresolvedRefs.length > 0) {
      storeUnresolvedRefs(db, result.unresolvedRefs);
    }

    totalNodes += result.nodes.length;
    totalEdges += result.edges.length;
    totalRefs += result.unresolvedRefs.length;
  }

  // Cross-file reference resolution
  resolveReferences(db, allNodesByName);

  // Write metadata
  db.exec(
    `INSERT OR REPLACE INTO project_metadata (key, value, updated_at) VALUES ('index_state', 'complete', ${Date.now()})`
  );
  db.exec(
    `INSERT OR REPLACE INTO project_metadata (key, value, updated_at) VALUES ('index_files_discovered', '${files.length}', ${Date.now()})`
  );
  db.exec(
    `INSERT OR REPLACE INTO project_metadata (key, value, updated_at) VALUES ('indexed_with_version', 'deob', ${Date.now()})`
  );

  const finalStats = getStats(db);
  db.close();

  const duration = Date.now() - startTime;
  return { ...finalStats, files: files.length, durationMs: duration };
}

module.exports = { indexDirectory };
