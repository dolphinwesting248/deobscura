// Re-export all structure module functions
const analyze = require("./analyze");
const report = require("./report");
const indexGen = require("./index-gen");
const tier = require("./tier");
const crossFile = require("./cross-file");

module.exports = {
  ...analyze,
  ...report,
  ...indexGen,
  ...tier,
  ...crossFile,
};
